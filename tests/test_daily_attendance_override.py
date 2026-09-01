"""逐日考勤修正（考勤修正页面日历化）功能测试。

覆盖：
- 系统口径变更：确认晚上加班（晚加班条或手工标记）的日期考勤天数固定 0.5
- 逐日状态修正参与月度聚合（考勤天数/半勤/工时/迟到早退/假种天数）
- 月度修正优先级最高（与逐日修正共存）
- 新端点行为：保存/清除/日历数据、账套锁定、非法状态
"""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import date, datetime, timedelta

from flask import Flask

from models import db
from models.account_set import AccountSet, AccountSetFactoryRestDay
from models.daily_record import DailyRecord
from models.department import Department
from models.employee import Employee
from models.overtime import OvertimeRecord
from models.user import User
from routes import register_routes
from routes.auth_helpers import issue_slider_verified_token
from tests.csrf_helper import attach_origin

DAILY_ENDPOINT = "/api/admin/attendance-override-daily/record"
BATCH_ENDPOINT = "/api/admin/attendance-override-daily/batch"
CALENDAR_ENDPOINT = "/api/admin/attendance-override-daily/calendar"


class DailyAttendanceOverrideTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmpdir.name, "test.db")
        self.upload_dir = os.path.join(self.tmpdir.name, "uploads")
        project_root = os.path.dirname(os.path.dirname(__file__))

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
            dept = Department(dept_no="D001", dept_name="行政部")
            db.session.add_all([admin, dept])
            db.session.flush()

            employee = Employee(emp_no="E001", name="员工甲", dept_id=dept.id, is_manager=False)
            manager = Employee(emp_no="M001", name="经理甲", dept_id=dept.id, is_manager=True)
            db.session.add_all([employee, manager])
            db.session.add(AccountSet(month="2026-05", name="2026-05", is_active=True, is_locked=False))
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

    def _add_daily(
        self,
        record_date: date,
        in_time: str = "08:00",
        out_time: str = "17:00",
        late_minutes: int = 0,
        early_leave_minutes: int = 0,
        emp_id: int | None = None,
    ) -> None:
        raw_punch = f"{in_time},{out_time}"
        with self.app.app_context():
            db.session.add(
                DailyRecord(
                    emp_id=emp_id or self.employee_id,
                    record_date=record_date,
                    late_minutes=late_minutes,
                    early_leave_minutes=early_leave_minutes,
                    raw_data={"刷卡时间数据": raw_punch},
                )
            )
            db.session.commit()

    def _add_evening_overtime(self, day: date, hours: float = 3.0) -> None:
        with self.app.app_context():
            db.session.add(
                OvertimeRecord(
                    emp_id=self.employee_id,
                    overtime_no=f"OT-{day.isoformat()}",
                    start_time=datetime.combine(day, datetime.strptime("18:00", "%H:%M").time()),
                    end_time=datetime.combine(day, datetime.strptime("21:00", "%H:%M").time()),
                    effective_hours=hours / 24,
                    approval_status="已同意",
                )
            )
            db.session.commit()

    def _put_daily(self, body: dict):
        return self.client.put(DAILY_ENDPOINT, json=body)

    def _employee_automatic(self) -> dict:
        res = self.client.get(
            f"/api/admin/employee-attendance-overrides?month=2026-05&emp_ids={self.employee_id}"
        )
        self.assertEqual(res.status_code, 200)
        return res.get_json()["rows"][0]["automatic"]

    def _employee_row(self) -> dict:
        res = self.client.get(
            f"/api/admin/employee-attendance-overrides?month=2026-05&emp_ids={self.employee_id}"
        )
        self.assertEqual(res.status_code, 200)
        return res.get_json()["rows"][0]

    # ---------------------------------------------------- 系统口径变更：晚加 0.5

    def test_evening_overtime_record_counts_half_day(self) -> None:
        """有晚加班条的日期，不论刷卡工时长短，考勤天数一律 0.5（原口径 8h 刷卡算 1 天）。"""
        self._add_daily(date(2026, 5, 6), "08:00", "17:00")
        self._add_evening_overtime(date(2026, 5, 6), hours=3.0)

        automatic = self._employee_automatic()
        self.assertEqual(automatic["attendance_days"], 0.5)

    def test_evening_overtime_flag_forces_half_day(self) -> None:
        """手工勾选晚上加班的日期，考勤天数固定 0.5（原刷卡口径 1 天）。"""
        self._add_daily(date(2026, 5, 6), "08:00", "17:00")
        res = self._put_daily(
            {"month": "2026-05", "emp_id": self.employee_id, "date": "2026-05-06", "is_evening_overtime": True}
        )
        self.assertEqual(res.status_code, 200)

        automatic = self._employee_automatic()
        self.assertEqual(automatic["attendance_days"], 0.5)

    # ------------------------------------------------------------ 状态修正聚合

    def test_full_status_on_absent_day_adds_one_day(self) -> None:
        """无任何记录的缺勤日标「全勤」→ 考勤天数 +1。"""
        self._add_daily(date(2026, 5, 6), "08:00", "17:00")
        self.assertEqual(self._employee_automatic()["attendance_days"], 1.0)

        res = self._put_daily(
            {"month": "2026-05", "emp_id": self.employee_id, "date": "2026-05-12", "status": "全勤"}
        )
        self.assertEqual(res.status_code, 200)
        automatic = self._employee_automatic()
        self.assertEqual(automatic["attendance_days"], 2.0)

    def test_half_day_status_adds_half_day_and_half_days(self) -> None:
        """标「上午出勤」→ 考勤天数 +0.5、半勤天数 +1。"""
        self._add_daily(date(2026, 5, 6), "08:00", "17:00")

        res = self._put_daily(
            {"month": "2026-05", "emp_id": self.employee_id, "date": "2026-05-12", "status": "上午出勤"}
        )
        self.assertEqual(res.status_code, 200)

        automatic = self._employee_automatic()
        self.assertEqual(automatic["attendance_days"], 1.5)
        self.assertEqual(automatic["half_days"], 1)

    def test_leave_status_adds_leave_days_without_attendance(self) -> None:
        """标「事假」→ 考勤天数不变、查询页事假天数 +1。"""
        self._add_daily(date(2026, 5, 6), "08:00", "17:00")

        res = self._put_daily(
            {"month": "2026-05", "emp_id": self.employee_id, "date": "2026-05-12", "status": "事假"}
        )
        self.assertEqual(res.status_code, 200)

        automatic = self._employee_automatic()
        self.assertEqual(automatic["attendance_days"], 1.0)

        res = self.client.get(
            f"/api/query/employee-dashboard?month=2026-05&emp_ids={self.employee_id}&show_leave_durations=1"
        )
        self.assertEqual(res.status_code, 200)
        payload = res.get_json()
        headers = payload["headers"]
        row = next(r for r in payload["rows"] if r[headers.index("人员编号")] == "E001")
        self.assertEqual(row[headers.index("事假时长（天）")], 1.0)

    def test_work_hours_and_late_early_overrides(self) -> None:
        """工时/迟到/早退逐日修正替换该天口径。"""
        self._add_daily(date(2026, 5, 6), "08:00", "17:00", late_minutes=15)

        res = self._put_daily(
            {
                "month": "2026-05",
                "emp_id": self.employee_id,
                "date": "2026-05-06",
                "work_hours": 8,
                "late_minutes": 0,
                "early_leave_minutes": 0,
            }
        )
        self.assertEqual(res.status_code, 200)

        automatic = self._employee_automatic()
        self.assertEqual(automatic["work_hours"], 8.0)
        self.assertEqual(automatic["late_early_minutes"], 0)

    # ------------------------------------------------------ 与月度修正的共存

    def test_monthly_override_still_wins(self) -> None:
        """逐日修正改变 automatic，月度修正覆盖 applied（月度优先级最高）。"""
        self._add_daily(date(2026, 5, 6), "08:00", "17:00")
        self._put_daily(
            {"month": "2026-05", "emp_id": self.employee_id, "date": "2026-05-12", "status": "全勤"}
        )
        monthly = self.client.put(
            "/api/admin/employee-attendance-overrides/record",
            json={"month": "2026-05", "emp_id": self.employee_id, "attendance_days": "5"},
        )
        self.assertEqual(monthly.status_code, 200)

        row = self._employee_row()
        self.assertEqual(row["automatic"]["attendance_days"], 2.0)
        self.assertEqual(row["applied"]["attendance_days"], 5.0)

    def test_delete_daily_override_restores_automatic(self) -> None:
        """清除逐日修正 → automatic 回到系统口径。"""
        self._add_daily(date(2026, 5, 6), "08:00", "17:00")
        self._put_daily(
            {"month": "2026-05", "emp_id": self.employee_id, "date": "2026-05-12", "status": "全勤"}
        )
        self.assertEqual(self._employee_automatic()["attendance_days"], 2.0)

        res = self.client.delete(
            f"{DAILY_ENDPOINT}?emp_id={self.employee_id}&date=2026-05-12"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self._employee_automatic()["attendance_days"], 1.0)

    # ------------------------------------------------------------ 端点校验

    def test_put_rejects_invalid_status(self) -> None:
        res = self._put_daily(
            {"month": "2026-05", "emp_id": self.employee_id, "date": "2026-05-12", "status": "外星假"}
        )
        self.assertEqual(res.status_code, 400)

    def test_put_rejects_status_out_of_scope(self) -> None:
        """员工不允许用管理人员专属状态「出差」，管理人员不允许用员工专属状态「事假」。"""
        res = self._put_daily(
            {"month": "2026-05", "emp_id": self.employee_id, "date": "2026-05-12", "status": "出差"}
        )
        self.assertEqual(res.status_code, 400)

        res = self._put_daily(
            {"month": "2026-05", "emp_id": self.manager_id, "date": "2026-05-12", "status": "事假"}
        )
        self.assertEqual(res.status_code, 400)

    def test_put_locked_account_set_rejected(self) -> None:
        with self.app.app_context():
            account_set = AccountSet.query.filter_by(month="2026-05").first()
            account_set.is_locked = True
            db.session.commit()

        res = self._put_daily(
            {"month": "2026-05", "emp_id": self.employee_id, "date": "2026-05-12", "status": "全勤"}
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("锁定", res.get_json()["error"])

    # ------------------------------------------------------------ 日历端点

    def test_calendar_endpoint_returns_override_and_summary(self) -> None:
        """日历端点返回每日 override 与修正后 summary。"""
        self._add_daily(date(2026, 5, 6), "08:00", "17:00")
        self._put_daily(
            {"month": "2026-05", "emp_id": self.employee_id, "date": "2026-05-12", "status": "全勤"}
        )

        res = self.client.get(
            f"{CALENDAR_ENDPOINT}?emp_id={self.employee_id}&month=2026-05"
        )
        self.assertEqual(res.status_code, 200)
        payload = res.get_json()
        self.assertEqual(payload["summary"]["attendance_days"], 2.0)
        day = next(d for d in payload["days"] if d["date"] == "2026-05-12")
        self.assertEqual(day["override"]["status"], "全勤")
        day_with_punch = next(d for d in payload["days"] if d["date"] == "2026-05-06")
        self.assertIsNone(day_with_punch["override"])

    # ------------------------------------------------ 当天算菜票修正（单日 + 批量多选）

    def _calendar_override(self, day: str) -> dict | None:
        res = self.client.get(
            f"{CALENDAR_ENDPOINT}?emp_id={self.employee_id}&month=2026-05"
        )
        self.assertEqual(res.status_code, 200)
        days = res.get_json()["days"]
        return next((d["override"] for d in days if d["date"] == day), None)

    def test_save_meal_ticket_flag(self) -> None:
        """单日保存接口支持 is_meal_ticket，日历 override 原样返回。"""
        res = self._put_daily(
            {"month": "2026-05", "emp_id": self.employee_id, "date": "2026-05-06", "is_meal_ticket": True}
        )
        self.assertEqual(res.status_code, 200)
        override = self._calendar_override("2026-05-06")
        self.assertIsNotNone(override)
        self.assertIs(override["is_meal_ticket"], True)

        res = self._put_daily(
            {"month": "2026-05", "emp_id": self.employee_id, "date": "2026-05-06", "is_meal_ticket": False}
        )
        self.assertEqual(res.status_code, 200)
        self.assertIs(self._calendar_override("2026-05-06")["is_meal_ticket"], False)

    def test_meal_ticket_not_affect_attendance_summary(self) -> None:
        """菜票是纯标记，不影响考勤天数等汇总。"""
        self._add_daily(date(2026, 5, 6), "08:00", "17:00")
        res = self._put_daily(
            {"month": "2026-05", "emp_id": self.employee_id, "date": "2026-05-06", "is_meal_ticket": True}
        )
        self.assertEqual(res.status_code, 200)
        calendar = self.client.get(
            f"{CALENDAR_ENDPOINT}?emp_id={self.employee_id}&month=2026-05"
        ).get_json()
        self.assertEqual(calendar["summary"]["attendance_days"], 1.0)

    def test_batch_mark_meal_ticket_keeps_other_fields(self) -> None:
        """批量端点只改菜票位，保留同日已有其他修正字段。"""
        self._put_daily(
            {"month": "2026-05", "emp_id": self.employee_id, "date": "2026-05-06", "status": "全勤", "work_hours": 8}
        )
        res = self.client.put(
            BATCH_ENDPOINT,
            json={
                "month": "2026-05",
                "emp_id": self.employee_id,
                "dates": ["2026-05-06", "2026-05-07"],
                "is_meal_ticket": True,
            },
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("calendar", res.get_json())
        override6 = self._calendar_override("2026-05-06")
        self.assertIs(override6["is_meal_ticket"], True)
        self.assertEqual(override6["status"], "全勤")
        self.assertEqual(override6["work_hours"], 8)
        self.assertIs(self._calendar_override("2026-05-07")["is_meal_ticket"], True)

    def test_batch_unmark_meal_ticket(self) -> None:
        """批量取消菜票：已标记日期翻回 False。"""
        self.client.put(
            BATCH_ENDPOINT,
            json={"month": "2026-05", "emp_id": self.employee_id, "dates": ["2026-05-06"], "is_meal_ticket": True},
        )
        res = self.client.put(
            BATCH_ENDPOINT,
            json={"month": "2026-05", "emp_id": self.employee_id, "dates": ["2026-05-06"], "is_meal_ticket": False},
        )
        self.assertEqual(res.status_code, 200)
        self.assertIs(self._calendar_override("2026-05-06")["is_meal_ticket"], False)

    def test_batch_meal_ticket_validations(self) -> None:
        """批量端点校验：空日期 / 非布尔标记 / 跨月日期。"""
        res = self.client.put(
            BATCH_ENDPOINT,
            json={"month": "2026-05", "emp_id": self.employee_id, "dates": [], "is_meal_ticket": True},
        )
        self.assertEqual(res.status_code, 400)

        res = self.client.put(
            BATCH_ENDPOINT,
            json={"month": "2026-05", "emp_id": self.employee_id, "dates": ["2026-05-06"], "is_meal_ticket": "yes"},
        )
        self.assertEqual(res.status_code, 400)

        res = self.client.put(
            BATCH_ENDPOINT,
            json={"month": "2026-05", "emp_id": self.employee_id, "dates": ["2026-06-01"], "is_meal_ticket": True},
        )
        self.assertEqual(res.status_code, 400)

    def test_batch_meal_ticket_locked_account_set_rejected(self) -> None:
        with self.app.app_context():
            account_set = AccountSet.query.filter_by(month="2026-05").first()
            account_set.is_locked = True
            db.session.commit()

        res = self.client.put(
            BATCH_ENDPOINT,
            json={"month": "2026-05", "emp_id": self.employee_id, "dates": ["2026-05-06"], "is_meal_ticket": True},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("锁定", res.get_json()["error"])

    # ------------------------------------------------------------ 管理人员侧

    def test_manager_leave_status_updates_manager_fields(self) -> None:
        """管理人员标「工伤」→ 管理人员列表工伤天数 +1。"""
        res = self._put_daily(
            {"month": "2026-05", "emp_id": self.manager_id, "date": "2026-05-12", "status": "工伤"}
        )
        self.assertEqual(res.status_code, 200)

        res = self.client.get(
            f"/api/admin/manager-attendance-overrides?month=2026-05&emp_ids={self.manager_id}"
        )
        self.assertEqual(res.status_code, 200)
        row = res.get_json()["rows"][0]
        self.assertEqual(row["automatic"]["injury_days"], 1.0)

    def test_manager_full_status_syncs_overtime_stats(self) -> None:
        """管理人员逐日修正后加班统计表同步重算。

        场景：2026-05 共 31 天，厂休 5 天（周六）。无月报 → 出勤天数按刷卡兜底。
        逐日标 27 天「全勤」→ 出勤 27 天，27 + 5 = 32 > 31 → 加班 1 天。
        """
        with self.app.app_context():
            account_set = AccountSet.query.filter_by(month="2026-05").first()
            rest_saturday = date(2026, 5, 2)
            for offset in range(5):
                db.session.add(AccountSetFactoryRestDay(
                    account_set_id=account_set.id,
                    rest_date=rest_saturday + timedelta(days=7 * offset),
                    rest_period="full",
                ))
            db.session.commit()

        marked = 0
        day = date(2026, 5, 1)
        while day.month == 5 and marked < 26:
            if day.weekday() != 5:  # 先标非周六（26 天）
                res = self._put_daily(
                    {"month": "2026-05", "emp_id": self.manager_id, "date": day.isoformat(), "status": "全勤"}
                )
                self.assertEqual(res.status_code, 200)
                marked += 1
            day += timedelta(days=1)
        # 再把一个周六（厂休日）标全勤，凑 27 天：27 + 5 厂休 > 31 → 加班 1 天
        res = self._put_daily(
            {"month": "2026-05", "emp_id": self.manager_id, "date": "2026-05-02", "status": "全勤"}
        )
        self.assertEqual(res.status_code, 200)

        with self.app.app_context():
            from models.manager_month_stat import ManagerMonthStat

            stat = (
                db.session.query(ManagerMonthStat)
                .filter_by(emp_id=self.manager_id, year=2026, stat_type="overtime")
                .first()
            )
            self.assertIsNotNone(stat, "保存逐日修正后应存在加班统计记录")
            self.assertEqual(stat.m5, 1.0, "加班查询页 m5 应同步为 1.0 天")


if __name__ == "__main__":
    unittest.main()
