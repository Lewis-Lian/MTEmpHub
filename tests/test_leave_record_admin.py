"""请假单作废/编辑（接入考勤修正页面）功能测试。

覆盖：
- 作废单不参与员工表（事假列）与管理表（扣薪出勤）口径
- 考勤日历载荷的请假条目带 id 与 is_revoked（作废单保留展示）
- 导入 upsert 不复活已作废单、不覆盖手工编辑单
- 作废/恢复/编辑 API 与调休余额联动、修正历史
"""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import date, datetime, time, timedelta

from flask import Flask

from models import db
from models.account_set import AccountSet, AccountSetFactoryRestDay
from models.attendance_override_history import AttendanceOverrideHistory
from models.department import Department
from models.employee import Employee
from models.leave import LeaveRecord
from models.annual_leave import AnnualLeave
from models.monthly_report import MonthlyReport
from models.user import User
from routes import register_routes
from routes.auth_helpers import issue_slider_verified_token
from tests.csrf_helper import attach_origin

LEAVE_ENDPOINT = "/api/admin/leave-records"


class LeaveRecordAdminTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmpdir.name, "test.db")
        self.upload_dir = os.path.join(self.tmpdir.name, "uploads")
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

        self.app = Flask(
            __name__,
            template_folder=os.path.join(project_root, "templates"),
            static_folder=os.path.join(project_root, "static"),
        )
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.db_path}",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            UPLOAD_FOLDER=self.upload_dir,
        )
        os.makedirs(self.upload_dir, exist_ok=True)

        db.init_app(self.app)
        register_routes(self.app)

        with self.app.app_context():
            db.create_all()
            admin = User(username="admin", role="admin")
            admin.set_password("admin123")
            dept = Department(dept_no="D001", dept_name="生产部")
            db.session.add_all([admin, dept])
            db.session.flush()

            employee = Employee(emp_no="E001", name="员工甲", dept_id=dept.id, is_manager=False)
            manager = Employee(emp_no="M001", name="夏群", dept_id=dept.id, is_manager=True)
            db.session.add_all([employee, manager])
            account_set = AccountSet(month="2026-05", name="2026-05", is_active=True, is_locked=False)
            db.session.add(account_set)
            db.session.flush()
            # 2026-05 的 10 个周末日按厂休登记：缺勤倒推口径用（31 天 − 出勤 − 厂休 = 缺口）
            db.session.add_all(
                AccountSetFactoryRestDay(
                    account_set_id=account_set.id, rest_date=date(2026, 5, day), rest_period="full"
                )
                for day in (2, 3, 9, 10, 16, 17, 23, 24, 30, 31)
            )
            db.session.commit()

            self.employee_id = employee.id
            self.manager_id = manager.id

        self.client = attach_origin(self.app.test_client())

        with self.app.app_context():
            captcha_token = issue_slider_verified_token()
        self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "admin123", "captcha_token": captcha_token},
        )

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.tmpdir.cleanup()

    # ---------------------------------------------------------------- helpers

    def _add_leave(
        self,
        emp_id: int,
        leave_type: str = "事假",
        start: datetime = datetime(2026, 5, 13, 13, 0),
        end: datetime = datetime(2026, 5, 13, 17, 0),
        leave_no: str = "QY2026051301",
        duration: float = 4.0,
    ) -> int:
        with self.app.app_context():
            record = LeaveRecord(
                leave_no=leave_no,
                emp_id=emp_id,
                leave_type=leave_type,
                start_time=start,
                end_time=end,
                duration=duration,
                apply_date=start.date(),
                reason="家里有事",
                approval_status="已审批",
            )
            db.session.add(record)
            db.session.commit()
            return record.id

    def _add_manager_report(self, attendance_days: float, month: str = "2026-05") -> None:
        with self.app.app_context():
            db.session.add(
                MonthlyReport(
                    emp_id=self.manager_id,
                    report_month=month,
                    raw_data={"出勤天数": attendance_days},
                )
            )
            db.session.commit()

    def _final_leave_days(self, month: str = "2026-05") -> float:
        resp = self.client.get(f"/api/query/employee-dashboard?month={month}&show_leave_durations=1")
        self.assertEqual(resp.status_code, 200)
        payload = resp.get_json()
        headers = payload["headers"]
        leave_col = headers.index("事假时长（天）")
        name_col = headers.index("人员名称")
        for row in payload["rows"]:
            if row[name_col] == "员工甲":
                return float(row[leave_col] or 0)
        self.fail("员工表里找不到员工甲")

    def _manager_attendance_days(self, month: str = "2026-05") -> tuple[float, float]:
        resp = self.client.get(f"/api/query/manager-attendance?month={month}")
        self.assertEqual(resp.status_code, 200)
        payload = resp.get_json()
        headers = payload["headers"]
        days_col = headers.index("出勤天数")
        sick_col = headers.index("事/病假")
        name_col = headers.index("姓名")
        for row in payload["rows"]:
            if row[name_col] == "夏群":
                return float(row[days_col] or 0), float(row[sick_col] or 0)
        self.fail("管理表里找不到夏群")

    # ------------------------------------------------- 口径：员工表/管理表过滤

    def test_final_table_excludes_revoked_leave(self) -> None:
        leave_id = self._add_leave(self.employee_id)
        self.assertEqual(self._final_leave_days(), 0.5)

        with self.app.app_context():
            record = db.session.get(LeaveRecord, leave_id)
            record.is_revoked = True
            db.session.commit()

        self.assertEqual(self._final_leave_days(), 0.0)

    def test_manager_table_excludes_revoked_leave(self) -> None:
        self._add_manager_report(attendance_days=21)
        self._add_leave(self.manager_id)
        days, sick = self._manager_attendance_days()
        self.assertEqual(days, 20.5)
        self.assertEqual(sick, 0.5)

        with self.app.app_context():
            record = LeaveRecord.query.filter_by(emp_id=self.manager_id).one()
            record.is_revoked = True
            db.session.commit()

        days, sick = self._manager_attendance_days()
        self.assertEqual(days, 21.0)
        self.assertEqual(sick, 0.0)

    # ------------------------------------------------- 口径：考勤日历标记

    def test_calendar_payload_flags_revoked_leave(self) -> None:
        self._add_leave(self.manager_id)
        with self.app.app_context():
            record = LeaveRecord.query.filter_by(emp_id=self.manager_id).one()
            record.is_revoked = True
            db.session.commit()
            leave_id = record.id

        resp = self.client.get(
            f"/api/query/attendance-calendar?emp_id={self.manager_id}&month=2026-05"
        )
        self.assertEqual(resp.status_code, 200)
        leaves = resp.get_json()["leaves"]
        matched = [item for item in leaves if item["leave_no"] == "QY2026051301"]
        self.assertEqual(len(matched), 1)
        self.assertEqual(matched[0]["id"], leave_id)
        self.assertTrue(matched[0]["is_revoked"])

    # ------------------------------------------------- 导入 upsert：跳过

    _IMPORT_HEADERS = [
        "请假单号", "工号", "请假人", "申请日期", "请假类型",
        "开始时间", "结束时间", "时长", "事由文本", "部门主管意见",
    ]

    def _import_rows(self, **overrides: str) -> list[list[object]]:
        row = [
            "QY2026051301", "M001", "夏群", "2026-05-13", "事假",
            "2026-05-13 08:00:00", "2026-05-13 17:00:00", "8", "源表事由", "同意",
        ]
        if "leave_type" in overrides:
            row[4] = overrides["leave_type"]
        if "reason" in overrides:
            row[8] = overrides["reason"]
        return [self._IMPORT_HEADERS, row]

    def test_import_does_not_revive_revoked_leave(self) -> None:
        self._add_leave(self.manager_id, leave_type="补休（调休）", duration=8.0)
        with self.app.app_context():
            record = LeaveRecord.query.filter_by(emp_id=self.manager_id).one()
            record.is_revoked = True
            db.session.commit()
            record_id = record.id
            # 作废时调休余额已被回退（作废 API 行为，此处直接置值模拟）
            balance = AnnualLeave(emp_id=self.manager_id, year=2026, total_days=10.0, used_days=2.0, remaining_days=8.0)
            db.session.add(balance)
            db.session.commit()

        with self.app.app_context():
            from services.import_service import ImportService

            result = ImportService._import_leave(self._import_rows(leave_type="补休（调休）", reason="源表事由"))
            self.assertEqual(result["imported"], 0)

            records = LeaveRecord.query.filter_by(emp_id=self.manager_id).all()
            self.assertEqual(len(records), 1)
            record = records[0]
            self.assertEqual(record.id, record_id)
            self.assertTrue(record.is_revoked)
            # 源表行不覆盖作废单的字段，也不重新累计调休余额
            self.assertEqual(record.reason, "家里有事")
            balance = AnnualLeave.query.filter_by(emp_id=self.manager_id, year=2026).one()
            self.assertEqual(balance.used_days, 2.0)

    def test_import_does_not_overwrite_manual_edited_leave(self) -> None:
        leave_id = self._add_leave(self.manager_id)
        with self.app.app_context():
            record = db.session.get(LeaveRecord, leave_id)
            record.is_manual_edited = True
            record.end_time = datetime(2026, 5, 13, 15, 0)
            db.session.commit()

        with self.app.app_context():
            from services.import_service import ImportService

            result = ImportService._import_leave(self._import_rows(reason="源表事由"))
            self.assertEqual(result["imported"], 0)

            record = db.session.get(LeaveRecord, leave_id)
            self.assertTrue(record.is_manual_edited)
            self.assertEqual(record.end_time, datetime(2026, 5, 13, 15, 0))
            self.assertEqual(record.reason, "家里有事")

    # ------------------------------------------------- API：作废/恢复/编辑

    def _add_time_off_balance(self, used_days: float = 3.0, total_days: float = 10.0) -> None:
        with self.app.app_context():
            db.session.add(
                AnnualLeave(
                    emp_id=self.manager_id,
                    year=2026,
                    total_days=total_days,
                    used_days=used_days,
                    remaining_days=total_days - used_days,
                )
            )
            db.session.commit()

    def _balance_used(self) -> float:
        with self.app.app_context():
            balance = AnnualLeave.query.filter_by(emp_id=self.manager_id, year=2026).first()
            return float(balance.used_days) if balance else 0.0

    def test_revoke_and_restore_time_off_leave_adjusts_balance(self) -> None:
        leave_id = self._add_leave(self.manager_id, leave_type="补休（调休）", duration=8.0)
        self._add_time_off_balance(used_days=3.0)

        resp = self.client.delete(f"{LEAVE_ENDPOINT}/{leave_id}?month=2026-05")
        self.assertEqual(resp.status_code, 200)
        payload = resp.get_json()
        self.assertTrue(payload["leave"]["is_revoked"])
        # 响应附日历刷新数据：作废单在弹层中置灰展示
        matched = [item for item in payload["calendar"]["leaves"] if item["id"] == leave_id]
        self.assertEqual(len(matched), 1)
        self.assertTrue(matched[0]["is_revoked"])

        with self.app.app_context():
            record = db.session.get(LeaveRecord, leave_id)
            self.assertTrue(record.is_revoked)
            history = AttendanceOverrideHistory.query.filter_by(
                override_type="leave_record", emp_id=self.manager_id, month="2026-05"
            ).all()
            self.assertEqual(len(history), 1)
            self.assertEqual(history[0].action_type, "revoke")
        # 补休 8h = 1 天：作废回退调休余额 3.0 -> 2.0
        self.assertEqual(self._balance_used(), 2.0)

        resp = self.client.post(f"{LEAVE_ENDPOINT}/{leave_id}/restore?month=2026-05")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.get_json()["leave"]["is_revoked"])
        with self.app.app_context():
            record = db.session.get(LeaveRecord, leave_id)
            self.assertFalse(record.is_revoked)
            self.assertEqual(
                AttendanceOverrideHistory.query.filter_by(
                    override_type="leave_record", emp_id=self.manager_id, month="2026-05"
                ).count(),
                2,
            )
        # 恢复重新计入：2.0 -> 3.0
        self.assertEqual(self._balance_used(), 3.0)

    def test_revoke_twice_returns_error(self) -> None:
        leave_id = self._add_leave(self.manager_id)
        self.assertEqual(self.client.delete(f"{LEAVE_ENDPOINT}/{leave_id}?month=2026-05").status_code, 200)
        self.assertEqual(self.client.delete(f"{LEAVE_ENDPOINT}/{leave_id}?month=2026-05").status_code, 400)

    def test_restore_active_leave_returns_error(self) -> None:
        leave_id = self._add_leave(self.manager_id)
        self.assertEqual(
            self.client.post(f"{LEAVE_ENDPOINT}/{leave_id}/restore?month=2026-05").status_code, 400
        )

    def test_edit_leave_updates_fields_and_marks_manual(self) -> None:
        leave_id = self._add_leave(self.manager_id)
        resp = self.client.put(
            f"{LEAVE_ENDPOINT}/{leave_id}",
            json={
                "month": "2026-05",
                "start_time": "2026-05-14 08:00",
                "end_time": "2026-05-14 17:00",
                "leave_type": "事假",
            },
        )
        self.assertEqual(resp.status_code, 200)
        with self.app.app_context():
            record = db.session.get(LeaveRecord, leave_id)
            self.assertEqual(record.start_time, datetime(2026, 5, 14, 8, 0))
            self.assertEqual(record.end_time, datetime(2026, 5, 14, 17, 0))
            self.assertEqual(record.duration, 9.0)
            self.assertTrue(record.is_manual_edited)
            history = AttendanceOverrideHistory.query.filter_by(
                override_type="leave_record", emp_id=self.manager_id, month="2026-05"
            ).one()
            self.assertEqual(history.action_type, "manual_edit")
            self.assertIn("end_time", history.changed_fields_json)

    def test_edit_leave_type_switches_time_off_balance(self) -> None:
        leave_id = self._add_leave(self.manager_id, leave_type="事假", duration=8.0)
        self._add_time_off_balance(used_days=2.0)

        # 事假 -> 补休：计入 1 天（09:00~17:00 共 8 小时，duration 按纯时段差计算）
        resp = self.client.put(
            f"{LEAVE_ENDPOINT}/{leave_id}",
            json={
                "month": "2026-05",
                "start_time": "2026-05-13 09:00",
                "end_time": "2026-05-13 17:00",
                "leave_type": "补休（调休）",
            },
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self._balance_used(), 3.0)

        # 补休 -> 事假：回退 1 天
        resp = self.client.put(
            f"{LEAVE_ENDPOINT}/{leave_id}",
            json={
                "month": "2026-05",
                "start_time": "2026-05-13 09:00",
                "end_time": "2026-05-13 17:00",
                "leave_type": "事假",
            },
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self._balance_used(), 2.0)

    def test_edit_leave_validates_times(self) -> None:
        leave_id = self._add_leave(self.manager_id)
        resp = self.client.put(
            f"{LEAVE_ENDPOINT}/{leave_id}",
            json={
                "month": "2026-05",
                "start_time": "2026-05-14 18:00",
                "end_time": "2026-05-14 08:00",
                "leave_type": "事假",
            },
        )
        self.assertEqual(resp.status_code, 400)

    def test_locked_account_set_rejects_leave_operations(self) -> None:
        leave_id = self._add_leave(self.manager_id)
        with self.app.app_context():
            account_set = AccountSet.query.filter_by(month="2026-05").one()
            account_set.is_locked = True
            db.session.commit()

        self.assertEqual(
            self.client.delete(f"{LEAVE_ENDPOINT}/{leave_id}?month=2026-05").status_code, 400
        )
        self.assertEqual(
            self.client.post(f"{LEAVE_ENDPOINT}/{leave_id}/restore?month=2026-05").status_code, 400
        )
        self.assertEqual(
            self.client.put(
                f"{LEAVE_ENDPOINT}/{leave_id}",
                json={
                    "month": "2026-05",
                    "start_time": "2026-05-14 08:00",
                    "end_time": "2026-05-14 17:00",
                    "leave_type": "事假",
                },
            ).status_code,
            400,
        )
