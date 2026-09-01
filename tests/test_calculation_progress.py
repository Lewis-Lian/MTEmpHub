"""账套计算真实进度：进度持久化、独立于业务事务、行级/人员级回调、轮询接口。

设计要点（被这些测试锁定）：
- 进度按 (account_set_id, mode) 唯一记录，计算过程中反复覆盖更新；
- 进度写入绝不经过业务 session：业务未提交数据不能被进度顺带提交，
  进度也不能跟随业务回滚消失（计算事务长时间持 sqlite 写锁，进度走
  独立存储——文件——才能实时可读）；
- 导入行循环与管理人员逐人循环向回调报告 (done, total)，供上层换算整体百分比；
- 轮询接口在无记录时返回 idle，计算结束后返回 finished/100。
"""

import os
import tempfile
import unittest
from datetime import timedelta
from io import BytesIO

import openpyxl
from flask import Flask

from models import db
from models.account_set import AccountSet
from models.department import Department
from models.employee import Employee
from models.shift import Shift
from models.user import User
from routes import register_routes
from routes.auth_helpers import issue_slider_verified_token
from services.calculation_progress_service import get_calc_progress, update_calc_progress
from services.import_service import ImportService
from services.manager_attendance_service import ManagerAttendanceOptions, build_manager_rows
from tests.csrf_helper import attach_origin


class CalculationProgressTestBase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/calc-progress.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_NAME="account_set_access_token",
            SESSION_COOKIE_SAMESITE="None",
            SESSION_COOKIE_SECURE=False,
            UPLOAD_FOLDER=os.path.join(self.tmpdir.name, "uploads"),
            CALC_PROGRESS_DIR=os.path.join(self.tmpdir.name, "calc-progress"),
        )
        os.makedirs(self.app.config["UPLOAD_FOLDER"], exist_ok=True)
        os.makedirs(self.app.config["CALC_PROGRESS_DIR"], exist_ok=True)
        db.init_app(self.app)
        register_routes(self.app)

        with self.app.app_context():
            db.create_all()
            admin = User(username="admin", role="admin")
            admin.set_password("admin123")
            dept = Department(dept_no="D001", dept_name="行政部")
            shift = Shift(
                shift_no="S001",
                shift_name="白班",
                time_slots=[{"start": "08:00", "end": "17:00"}],
                is_cross_day=False,
            )
            db.session.add_all([admin, dept, shift])
            db.session.flush()
            db.session.add(
                Employee(emp_no="E001", name="员工甲", dept_id=dept.id, is_manager=False)
            )
            db.session.add(AccountSet(month="2026-06", name="2026-06", is_active=True, is_locked=False))
            db.session.commit()

        self.client = attach_origin(self.app.test_client())

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def _login(self) -> None:
        with self.app.app_context():
            captcha_token = issue_slider_verified_token()
        self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "admin123", "captcha_token": captcha_token},
        )

    @staticmethod
    def _leave_xlsx(filename: str = "庆元 - 请假单查询 (51).xlsx") -> BytesIO:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["请假单号", "工号", "请假人", "请假类型", "开始时间", "结束时间", "时长"])
        ws.append(["L001", "E001", "员工甲", "事假", "2026-06-01 08:00", "2026-06-01 12:00", 4])
        ws.append(["L002", "E001", "员工甲", "事假", "2026-06-02 08:00", "2026-06-02 12:00", 4])
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        output.name = filename
        return output


class CalcProgressServiceTests(CalculationProgressTestBase):
    def test_update_calc_progress_upserts_by_account_and_mode(self) -> None:
        """同一 (账套, 模式) 重复上报只保留一条记录并覆盖进度；不同模式各一条。"""
        with self.app.app_context():
            update_calc_progress(1, "employee", 0, "开始计算...")
            update_calc_progress(1, "employee", 40, "正在导入文件（1/2）")

            progress = get_calc_progress(1, "employee")
            self.assertIsNotNone(progress)
            self.assertEqual(progress["percent"], 40)
            self.assertEqual(progress["status"], "running")
            self.assertEqual(progress["stage"], "正在导入文件（1/2）")

            update_calc_progress(1, "manager", 10, "正在汇总管理人员考勤...")
            self.assertIsNone(get_calc_progress(1, "all"))

    def test_update_calc_progress_is_independent_of_business_session(self) -> None:
        """进度写入不经过业务 session：业务未提交数据不被顺带提交，进度也不随业务回滚消失。"""
        with self.app.app_context():
            account_set = db.session.get(AccountSet, 1)
            account_set.name = "未提交的脏修改"
            try:
                update_calc_progress(1, "employee", 50, "正在导入")
            finally:
                db.session.rollback()

            # 脏修改必须没有被进度写入顺带提交
            self.assertEqual(db.session.get(AccountSet, 1).name, "2026-06")
            # 进度必须独立持久化
            progress = get_calc_progress(1, "employee")
            self.assertIsNotNone(progress)
            self.assertEqual(progress["percent"], 50)


class CalcProgressCallbackTests(CalculationProgressTestBase):
    def test_import_leave_reports_row_progress(self) -> None:
        """请假单导入的行循环按 (已处理行数, 总行数) 回调。"""
        rows = [
            ["请假单号", "工号", "请假人", "请假类型", "开始时间", "结束时间", "时长"],
            ["L001", "E001", "员工甲", "事假", "2026-06-01 08:00", "2026-06-01 12:00", 4],
            ["L002", "E001", "员工甲", "事假", "2026-06-02 08:00", "2026-06-02 12:00", 4],
        ]
        calls: list[tuple[int, int]] = []
        with self.app.app_context():
            ImportService._import_leave(rows, progress_cb=lambda done, total: calls.append((done, total)))

        self.assertEqual(calls, [(1, 2), (2, 2)])

    def test_build_manager_rows_reports_per_employee_progress(self) -> None:
        """管理人员汇总按 (已处理人数, 总人数) 回调。"""
        with self.app.app_context():
            dept = db.session.get(Department, 1)
            db.session.add_all(
                [
                    Employee(emp_no="M001", name="管理甲", dept_id=dept.id, is_manager=True),
                    Employee(emp_no="M002", name="管理乙", dept_id=dept.id, is_manager=True),
                ]
            )
            db.session.commit()

        calls: list[tuple[int, int]] = []
        with self.app.app_context():
            build_manager_rows(
                ManagerAttendanceOptions(month="2026-06"),
                progress_cb=lambda done, total: calls.append((done, total)),
            )

        self.assertEqual(calls, [(1, 2), (2, 2)])


class CalcProgressEndpointTests(CalculationProgressTestBase):
    def test_progress_endpoint_returns_idle_when_absent(self) -> None:
        """无进度记录时轮询接口返回 idle，前端可当作 0% 处理。"""
        self._login()
        resp = self.client.get("/api/admin/account-sets/1/calculate/progress?mode=employee")
        self.assertEqual(resp.status_code, 200, resp.get_data(as_text=True))
        self.assertEqual(resp.get_json()["status"], "idle")

    def test_progress_endpoint_returns_running_progress(self) -> None:
        """计算进行中的进度可被另一个请求轮询到。"""
        self._login()
        with self.app.app_context():
            update_calc_progress(1, "employee", 35, "正在导入文件（1/2）")

        resp = self.client.get("/api/admin/account-sets/1/calculate/progress?mode=employee")
        body = resp.get_json()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(body["status"], "running")
        self.assertEqual(body["percent"], 35)
        self.assertEqual(body["stage"], "正在导入文件（1/2）")

    def test_calculate_writes_finished_progress(self) -> None:
        """完整计算结束后进度为 finished/100（进度描述完成度，业务成败由计算响应给出）。"""
        self._login()
        upload = self.client.post(
            "/api/admin/import/raw-files",
            data={"account_set_id": 1, "files": [self._leave_xlsx()]},
            content_type="multipart/form-data",
        )
        self.assertEqual(upload.status_code, 200, upload.get_data(as_text=True))

        calc = self.client.post("/api/admin/account-sets/1/calculate?mode=employee")
        self.assertEqual(calc.status_code, 200, calc.get_data(as_text=True))

        resp = self.client.get("/api/admin/account-sets/1/calculate/progress?mode=employee")
        body = resp.get_json()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(body["status"], "finished")
        self.assertEqual(body["percent"], 100)

    def test_calculate_manager_mode_walks_sync_stage_and_finishes(self) -> None:
        """管理人员模式完整链路：文件导入成功后必须进入汇总段（progress_cb 透传路径）。"""
        self._login()
        upload = self.client.post(
            "/api/admin/import/raw-files",
            data={"account_set_id": 1, "files": [self._leave_xlsx()]},
            content_type="multipart/form-data",
        )
        self.assertEqual(upload.status_code, 200, upload.get_data(as_text=True))

        calc = self.client.post("/api/admin/account-sets/1/calculate?mode=manager")
        body = calc.get_json()
        self.assertEqual(calc.status_code, 200, calc.get_data(as_text=True))
        self.assertEqual(body["failed"], 0, body)
        # 汇总段真的执行过（manager_stats_sync 非空说明走到了 build_manager_rows）
        self.assertIsNotNone(body["manager_stats_sync"])

        resp = self.client.get("/api/admin/account-sets/1/calculate/progress?mode=manager")
        progress = resp.get_json()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(progress["status"], "finished")
        self.assertEqual(progress["percent"], 100)

    def test_progress_endpoint_rejects_unknown_mode(self) -> None:
        """mode 白名单外的值一律按 idle 处理，不进入进度文件路径拼接。"""
        self._login()
        resp = self.client.get("/api/admin/account-sets/1/calculate/progress?mode=..%2F..%2Fetc")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["status"], "idle")


if __name__ == "__main__":
    unittest.main()
