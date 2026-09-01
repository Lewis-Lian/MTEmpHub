"""守护账套原始文件上传：中文文件名必须保留，且能被正确分类。

历史 bug：`routes/admin_imports.py` 曾用 werkzeug 的 `secure_filename` 生成落盘文件名，
它会删除所有非 ASCII 字符（含全部中文），导致：
1. 不同文件被归并成同名（如「员工月报」「员工日报」「管理人员日报」全部变成 `2026_6.xlsx`），
   `file.save()` 后者覆盖前者，账套实际可用文件数 < 上传数；
2. `_account_set_file_type` 靠中文关键字（加班/请假/管理人员/月报）判型，文件名丢中文后
   全部回退成 `daily`，员工/管理人员计算因此缺类型、算出 0 人。

本测试直接断言修复后的落盘命名行为：保留中文 + 不互相覆盖 + 分类正确。
"""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import date, datetime, timedelta
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
from routes.admin_core import _account_set_file_type
from tests.csrf_helper import attach_origin


class AccountSetUploadNamingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/account-set.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_NAME="account_set_access_token",
            SESSION_COOKIE_SAMESITE="None",
            SESSION_COOKIE_SECURE=False,
            UPLOAD_FOLDER=os.path.join(self.tmpdir.name, "uploads"),
        )
        os.makedirs(self.app.config["UPLOAD_FOLDER"], exist_ok=True)
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
            db.session.add(Employee(emp_no="E001", name="员工甲", dept_id=dept.id, is_manager=False))
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
    def _xlsx_file(filename: str) -> BytesIO:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["占位"])
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        output.name = filename
        return output

    def test_chinese_filenames_are_preserved_and_not_collapsed(self) -> None:
        """上传多个含中文的文件名：落盘文件名必须保留中文，且彼此不归并覆盖。"""
        self._login()
        # 这些文件名经历史 bug 的 secure_filename 处理后会全部退化成同名残缺名
        filenames = [
            "2026_6月员工基础数据.xlsx",
            "2026_6月员工基础数据（月报）.xlsx",
            "2026年_6月管理人员基础数据.xlsx",
            "2026年_6月管理人员基础数据（月报）.xlsx",
            "庆元 - 加班单 (17).xlsx",
            "庆元 - 请假单查询 (51).xlsx",
        ]
        resp = self.client.post(
            "/api/admin/import/raw-files",
            data={"account_set_id": 1, "files": [self._xlsx_file(n) for n in filenames]},
            content_type="multipart/form-data",
        )
        self.assertEqual(resp.status_code, 200, resp.get_data(as_text=True))
        body = resp.get_json()
        # 六个文件应全部上传成功，没有一个因同名被另一个覆盖
        self.assertEqual(body["total"], 6)
        self.assertEqual(body["failed"], 0, body)

        upload_dir = os.path.join(self.app.config["UPLOAD_FOLDER"], "account_sets", "2026-06")
        saved_names = sorted(os.listdir(upload_dir))
        # 落盘文件数 == 上传数（没有被同名覆盖）
        self.assertEqual(len(saved_names), 6, f"落盘文件被覆盖，实际: {saved_names}")
        # 中文必须保留在落盘名里（关键字「月」「加班」「请假」「管理人员」）
        joined = "".join(saved_names)
        for keyword in ["月", "加班", "请假", "管理人员"]:
            self.assertIn(keyword, joined, f"落盘文件名丢失中文 {keyword}：{saved_names}")

    def test_uploaded_filenames_classify_into_distinct_types(self) -> None:
        """落盘文件名经 _account_set_file_type 必须分出 6 种不同类型，覆盖员工/管理人员全部计算所需。"""
        self._login()
        filenames = [
            "2026_6月员工基础数据.xlsx",
            "2026_6月员工基础数据（月报）.xlsx",
            "2026年_6月管理人员基础数据.xlsx",
            "2026年_6月管理人员基础数据（月报）.xlsx",
            "庆元 - 加班单 (17).xlsx",
            "庆元 - 请假单查询 (51).xlsx",
        ]
        resp = self.client.post(
            "/api/admin/import/raw-files",
            data={"account_set_id": 1, "files": [self._xlsx_file(n) for n in filenames]},
            content_type="multipart/form-data",
        )
        self.assertEqual(resp.status_code, 200, resp.get_data(as_text=True))

        # 6 个原始文件名应分别映射到 6 种 file_type（历史 bug 下会被全部压成 daily）
        expected = {
            "2026_6月员工基础数据.xlsx": "daily",
            "2026_6月员工基础数据（月报）.xlsx": "monthly",
            "2026年_6月管理人员基础数据.xlsx": "manager_daily",
            "2026年_6月管理人员基础数据（月报）.xlsx": "manager_monthly",
            "庆元 - 加班单 (17).xlsx": "overtime",
            "庆元 - 请假单查询 (51).xlsx": "leave",
        }
        for original, want in expected.items():
            self.assertEqual(
                _account_set_file_type(original),
                want,
                f"文件名 {original!r} 分类错误：期望 {want}",
            )


class AccountSetUploadValidationTests(unittest.TestCase):
    """上传时的内容防线：文件名月份必须与账套一致；月报槽位不得是日报内容。

    历史 bug：把日报改名为「（月报）」上传，上传与计算全程无任何提示，
    日报的逐日打卡列被当作月报指标写入 MonthlyReport，污染整月统计。
    """

    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/upload-validate.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_NAME="upload_validate_access_token",
            SESSION_COOKIE_SAMESITE="None",
            SESSION_COOKIE_SECURE=False,
            UPLOAD_FOLDER=os.path.join(self.tmpdir.name, "uploads"),
        )
        os.makedirs(self.app.config["UPLOAD_FOLDER"], exist_ok=True)
        db.init_app(self.app)
        register_routes(self.app)

        with self.app.app_context():
            db.create_all()
            admin = User(username="admin", role="admin")
            admin.set_password("admin123")
            db.session.add(admin)
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
    def _xlsx_file(filename: str, header: list[str] | None = None) -> BytesIO:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(header or ["占位"])
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        output.name = filename
        return output

    def _upload(self, *files: BytesIO):
        return self.client.post(
            "/api/admin/import/raw-files",
            data={"account_set_id": 1, "files": list(files)},
            content_type="multipart/form-data",
        )

    def test_rejects_filename_month_mismatching_account_set(self) -> None:
        """文件名月份与账套月份不一致的月报/日报类文件必须被拒绝，且不影响同批正确文件。"""
        self._login()
        resp = self._upload(
            self._xlsx_file("2026_5月员工基础数据（月报）.xlsx"),
            self._xlsx_file("2026_6月员工基础数据（月报）.xlsx"),
        )
        self.assertEqual(resp.status_code, 200, resp.get_data(as_text=True))
        body = resp.get_json()
        self.assertEqual(body["failed"], 1, body)
        rejected = next(r for r in body["results"] if r["status"] == "error")
        self.assertIn("月份", rejected["error"])
        # 拒绝的文件不得落盘、不得留导入记录
        upload_dir = os.path.join(self.app.config["UPLOAD_FOLDER"], "account_sets", "2026-06")
        self.assertEqual(len(os.listdir(upload_dir)), 1, os.listdir(upload_dir))

    def test_rejects_monthly_file_without_month_in_filename(self) -> None:
        """月报/日报类文件名提取不到年月时必须被拒绝（否则会静默导入到 1970-01）。"""
        self._login()
        resp = self._upload(self._xlsx_file("员工基础数据（月报）.xlsx"))
        body = resp.get_json()
        self.assertEqual(body["failed"], 1, body)
        rejected = next(r for r in body["results"] if r["status"] == "error")
        self.assertIn("月份", rejected["error"])

    def test_rejects_daily_content_uploaded_as_monthly(self) -> None:
        """文件名是月报、内容却是日报格式（含逐日打卡特征列）时必须被拒绝。"""
        self._login()
        daily_header = [
            "人员编号", "人员名称", "部门编号", "部门名称",
            "刷卡时间数据", "星期", "段1实际上班时间", "段1实际下班时间",
        ]
        resp = self._upload(self._xlsx_file("2026_6月员工基础数据（月报）.xlsx", header=daily_header))
        body = resp.get_json()
        self.assertEqual(body["failed"], 1, body)
        rejected = next(r for r in body["results"] if r["status"] == "error")
        self.assertIn("日报", rejected["error"])
        upload_dir = os.path.join(self.app.config["UPLOAD_FOLDER"], "account_sets", "2026-06")
        self.assertFalse(os.path.exists(upload_dir) and os.listdir(upload_dir), "被拒文件不应落盘")

    def test_leave_and_overtime_files_skip_month_validation(self) -> None:
        """请假单/加班单文件名惯例不含年月，不做月份校验。"""
        self._login()
        resp = self._upload(
            self._xlsx_file("庆元 - 请假单查询 (52).xlsx"),
            self._xlsx_file("庆元 - 加班单 (18).xlsx"),
        )
        body = resp.get_json()
        self.assertEqual(body["failed"], 0, body)


class AccountSetResetTests(unittest.TestCase):
    """「清空已导入数据」：按账套月份清掉导入产生的数据与归档，其他月份不受影响。"""

    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/reset.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_NAME="reset_access_token",
            SESSION_COOKIE_SAMESITE="None",
            SESSION_COOKIE_SECURE=False,
            UPLOAD_FOLDER=os.path.join(self.tmpdir.name, "uploads"),
        )
        os.makedirs(self.app.config["UPLOAD_FOLDER"], exist_ok=True)
        db.init_app(self.app)
        register_routes(self.app)

        with self.app.app_context():
            from models.account_set import AccountSetImport
            from models.daily_record import DailyRecord
            from models.leave import LeaveRecord
            from models.monthly_report import MonthlyReport
            from models.overtime import OvertimeRecord

            db.create_all()
            admin = User(username="admin", role="admin")
            admin.set_password("admin123")
            db.session.add(admin)
            db.session.flush()
            dept = Department(dept_no="D001", dept_name="行政部")
            db.session.add(dept)
            db.session.flush()
            emp = Employee(emp_no="E001", name="员工甲", dept_id=dept.id, is_manager=False)
            db.session.add(emp)
            db.session.flush()

            db.session.add_all([
                AccountSet(month="2026-06", name="2026-06", is_active=True, is_locked=False),
                AccountSet(month="2026-05", name="2026-05", is_active=False, is_locked=False),
            ])
            db.session.flush()

            # 同结构数据各造两份：6 月（将被清空）与 5 月（必须保留）
            db.session.add(MonthlyReport(emp_id=emp.id, report_month="2026-06"))
            db.session.add(MonthlyReport(emp_id=emp.id, report_month="2026-05"))
            db.session.add(DailyRecord(emp_id=emp.id, record_date=date(2026, 6, 15)))
            db.session.add(DailyRecord(emp_id=emp.id, record_date=date(2026, 5, 15)))
            db.session.add(LeaveRecord(
                emp_id=emp.id, leave_no="L-06", leave_type="事假",
                start_time=datetime(2026, 6, 3, 9, 0), end_time=datetime(2026, 6, 3, 18, 0),
            ))
            db.session.add(LeaveRecord(
                emp_id=emp.id, leave_no="L-05", leave_type="事假",
                start_time=datetime(2026, 5, 3, 9, 0), end_time=datetime(2026, 5, 3, 18, 0),
            ))
            db.session.add(OvertimeRecord(
                emp_id=emp.id, overtime_no="OT-06",
                start_time=datetime(2026, 6, 4, 18, 0), end_time=datetime(2026, 6, 4, 20, 0),
            ))
            db.session.add(OvertimeRecord(
                emp_id=emp.id, overtime_no="OT-05",
                start_time=datetime(2026, 5, 4, 18, 0), end_time=datetime(2026, 5, 4, 20, 0),
            ))

            archive_path = os.path.join(self.app.config["UPLOAD_FOLDER"], "archive-06.xlsx")
            with open(archive_path, "w", encoding="utf-8") as f:
                f.write("x")
            db.session.add(AccountSetImport(
                account_set_id=1, source_filename="2026_6月员工基础数据（月报）.xlsx",
                stored_path=archive_path, file_type="monthly", status="ok",
            ))
            db.session.commit()

        self.archive_path = archive_path
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

    def test_reset_clears_month_data_and_archives_only_for_target_set(self) -> None:
        from models.account_set import AccountSetImport
        from models.daily_record import DailyRecord
        from models.leave import LeaveRecord
        from models.monthly_report import MonthlyReport
        from models.overtime import OvertimeRecord

        self._login()
        resp = self.client.post("/api/admin/account-sets/1/reset-imported")
        self.assertEqual(resp.status_code, 200, resp.get_data(as_text=True))

        with self.app.app_context():
            self.assertEqual(MonthlyReport.query.filter_by(report_month="2026-06").count(), 0)
            self.assertEqual(MonthlyReport.query.filter_by(report_month="2026-05").count(), 1)
            self.assertEqual(
                DailyRecord.query.filter(DailyRecord.record_date >= date(2026, 6, 1)).count(), 0
            )
            self.assertEqual(
                DailyRecord.query.filter(DailyRecord.record_date < date(2026, 6, 1)).count(), 1
            )
            self.assertEqual(LeaveRecord.query.filter_by(leave_no="L-06").count(), 0)
            self.assertEqual(LeaveRecord.query.filter_by(leave_no="L-05").count(), 1)
            self.assertEqual(OvertimeRecord.query.filter_by(overtime_no="OT-06").count(), 0)
            self.assertEqual(OvertimeRecord.query.filter_by(overtime_no="OT-05").count(), 1)
            self.assertEqual(AccountSetImport.query.filter_by(account_set_id=1).count(), 0)
        self.assertFalse(os.path.exists(self.archive_path), "归档文件应被删除")

    def test_reset_rejects_locked_account_set(self) -> None:
        from models.account_set import AccountSet
        from models.monthly_report import MonthlyReport

        self._login()
        with self.app.app_context():
            row = db.session.get(AccountSet, 1)
            row.is_locked = True
            db.session.commit()

        resp = self.client.post("/api/admin/account-sets/1/reset-imported")
        self.assertEqual(resp.status_code, 400)

        with self.app.app_context():
            self.assertEqual(MonthlyReport.query.filter_by(report_month="2026-06").count(), 1)


if __name__ == "__main__":
    unittest.main()
