import os
import tempfile
import unittest
from datetime import date, datetime, timedelta

from flask import Flask

from models import db
from models.account_set import AccountSet
from models.attendance_override_history import AttendanceOverrideHistory
from models.daily_attendance_override import DailyAttendanceOverride
from models.daily_record import DailyRecord
from models.department import Department
from models.employee import Employee
from models.leave import LeaveRecord
from models.user import User
from routes import register_routes
from routes.auth_helpers import issue_slider_verified_token
from tests.csrf_helper import attach_origin


class LateOffsetApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmpdir.name, "late-offset-api.db")

        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.db_path}",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
        )
        db.init_app(self.app)
        register_routes(self.app)

        with self.app.app_context():
            db.create_all()
            admin = User(username="admin", role="admin")
            admin.set_password("admin123")
            viewer = User(username="viewer", role="readonly")
            viewer.set_password("viewer123")
            dept = Department(dept_no="D001", dept_name="品质部")
            db.session.add_all([admin, viewer, dept])
            db.session.flush()
            manager = Employee(emp_no="M001", name="张管理", dept_id=dept.id, is_manager=True)
            db.session.add(manager)
            db.session.flush()
            db.session.add(AccountSet(month="2026-04", name="2026-04", is_active=True, is_locked=False))
            db.session.add(
                DailyRecord(
                    emp_id=manager.id,
                    record_date=date(2026, 4, 18),
                    late_minutes=20,
                    raw_data={"上班1打卡结果": "迟到", "迟到时长": 20},
                )
            )
            db.session.add(
                LeaveRecord(
                    leave_no="L0001",
                    emp_id=manager.id,
                    leave_type="事假",
                    start_time=datetime(2026, 4, 18, 8, 30),
                    end_time=datetime(2026, 4, 18, 8, 50),
                    duration=0.33,
                    reason="迟到冲抵20分钟",
                )
            )
            db.session.commit()
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

    def test_candidates_endpoint_returns_rows(self) -> None:
        res = self.client.get("/api/admin/late-offset/candidates?month=2026-04")
        self.assertEqual(res.status_code, 200)
        payload = res.get_json()
        self.assertEqual(payload["month"], "2026-04")
        self.assertEqual(len(payload["rows"]), 1)
        row = payload["rows"][0]
        self.assertEqual(row["emp_id"], self.manager_id)
        self.assertEqual(row["date"], "2026-04-18")
        self.assertEqual(row["late_minutes"], 20)
        self.assertEqual(row["offset_minutes"], 20)
        self.assertEqual(row["effective_late_minutes"], 0)

    def test_candidates_endpoint_rejects_invalid_month(self) -> None:
        res = self.client.get("/api/admin/late-offset/candidates?month=bad")
        self.assertEqual(res.status_code, 400)

    def test_candidates_endpoint_filters_by_emp_ids(self) -> None:
        res = self.client.get(
            f"/api/admin/late-offset/candidates?month=2026-04&emp_ids={self.manager_id + 999}"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()["rows"], [])

        res_all = self.client.get("/api/admin/late-offset/candidates?month=2026-04")
        self.assertEqual(len(res_all.get_json()["rows"]), 1)

    def test_confirm_endpoint_writes_override_and_history(self) -> None:
        res = self.client.post(
            "/api/admin/late-offset/confirm",
            json={"month": "2026-04", "items": [{"emp_id": self.manager_id, "date": "2026-04-18"}]},
        )
        self.assertEqual(res.status_code, 200)
        payload = res.get_json()
        self.assertEqual(len(payload["confirmed"]), 1)
        self.assertEqual(payload["confirmed"][0]["late_minutes"], 0)

        with self.app.app_context():
            override = DailyAttendanceOverride.query.filter_by(
                emp_id=self.manager_id, record_date=date(2026, 4, 18)
            ).first()
            self.assertIsNotNone(override)
            self.assertEqual(override.late_minutes, 0)
            history = (
                AttendanceOverrideHistory.query.filter_by(
                    override_type="daily", emp_id=self.manager_id, month="2026-04"
                )
                .filter(AttendanceOverrideHistory.action_type == "late_offset")
                .all()
            )
            self.assertEqual(len(history), 1)

    def test_confirm_endpoint_skips_stale_item(self) -> None:
        res = self.client.post(
            "/api/admin/late-offset/confirm",
            json={"month": "2026-04", "items": [{"emp_id": self.manager_id, "date": "2026-04-01"}]},
        )
        self.assertEqual(res.status_code, 200)
        payload = res.get_json()
        self.assertEqual(payload["confirmed"], [])
        self.assertEqual(len(payload["skipped"]), 1)

    def test_confirm_endpoint_rejects_locked_month(self) -> None:
        with self.app.app_context():
            account_set = AccountSet.query.filter_by(month="2026-04").first()
            account_set.is_locked = True
            db.session.commit()
        res = self.client.post(
            "/api/admin/late-offset/confirm",
            json={"month": "2026-04", "items": [{"emp_id": self.manager_id, "date": "2026-04-18"}]},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("已锁定", res.get_json()["error"])

    def test_clear_endpoint_restores_system_value(self) -> None:
        confirm = self.client.post(
            "/api/admin/late-offset/confirm",
            json={"month": "2026-04", "items": [{"emp_id": self.manager_id, "date": "2026-04-18"}]},
        )
        self.assertEqual(confirm.status_code, 200)

        res = self.client.post(
            "/api/admin/late-offset/clear",
            json={"month": "2026-04", "items": [{"emp_id": self.manager_id, "date": "2026-04-18"}]},
        )
        self.assertEqual(res.status_code, 200)
        payload = res.get_json()
        self.assertEqual(len(payload["cleared"]), 1)
        self.assertIsNone(payload["cleared"][0]["late_minutes"])
        pending_rows = [row for row in payload["rows"] if row["status"] == "pending"]
        self.assertEqual(len(pending_rows), 1)

        with self.app.app_context():
            history = (
                AttendanceOverrideHistory.query.filter_by(
                    override_type="daily", emp_id=self.manager_id, month="2026-04"
                )
                .filter(AttendanceOverrideHistory.action_type == "late_offset_clear")
                .all()
            )
            self.assertEqual(len(history), 1)

    def test_clear_endpoint_rejects_locked_month(self) -> None:
        with self.app.app_context():
            account_set = AccountSet.query.filter_by(month="2026-04").first()
            account_set.is_locked = True
            db.session.commit()
        res = self.client.post(
            "/api/admin/late-offset/clear",
            json={"month": "2026-04", "items": [{"emp_id": self.manager_id, "date": "2026-04-18"}]},
        )
        self.assertEqual(res.status_code, 400)

    def test_readonly_user_gets_forbidden(self) -> None:
        with self.app.app_context():
            captcha_token = issue_slider_verified_token()
        login = self.client.post(
            "/api/auth/login",
            json={"username": "viewer", "password": "viewer123", "captcha_token": captcha_token},
        )
        self.assertEqual(login.status_code, 200)

        candidates = self.client.get("/api/admin/late-offset/candidates?month=2026-04")
        self.assertEqual(candidates.status_code, 403)
        confirm = self.client.post(
            "/api/admin/late-offset/confirm",
            json={"month": "2026-04", "items": [{"emp_id": self.manager_id, "date": "2026-04-18"}]},
        )
        self.assertEqual(confirm.status_code, 403)
        leaves = self.client.get(
            f"/api/admin/late-offset/leaves?month=2026-04&emp_id={self.manager_id}"
        )
        self.assertEqual(leaves.status_code, 403)

    def test_leaves_endpoint_returns_all_leave_records(self) -> None:
        with self.app.app_context():
            db.session.add(
                LeaveRecord(
                    leave_no="L0002",
                    emp_id=self.manager_id,
                    leave_type="年假",
                    start_time=datetime(2026, 4, 10, 9, 0),
                    end_time=datetime(2026, 4, 10, 18, 0),
                    duration=8,
                    reason="年假一天",
                    approval_status="已审批",
                )
            )
            db.session.commit()

        res = self.client.get(
            f"/api/admin/late-offset/leaves?month=2026-04&emp_id={self.manager_id}"
        )
        self.assertEqual(res.status_code, 200)
        payload = res.get_json()
        self.assertEqual(payload["month"], "2026-04")
        self.assertEqual(payload["emp_id"], self.manager_id)
        self.assertEqual(len(payload["rows"]), 2)
        self.assertEqual(payload["rows"][0]["leave_no"], "L0002")
        self.assertEqual(payload["rows"][0]["leave_type"], "年假")
        self.assertEqual(payload["rows"][0]["start_time"], "2026-04-10 09:00")
        self.assertEqual(payload["rows"][0]["end_time"], "2026-04-10 18:00")
        self.assertEqual(payload["rows"][0]["approval_status"], "已审批")
        self.assertEqual(payload["rows"][1]["leave_no"], "L0001")
        self.assertEqual(payload["rows"][1]["start_time"], "2026-04-18 08:30")
        self.assertEqual(payload["rows"][1]["duration"], 0.33)
        self.assertEqual(payload["rows"][1]["reason"], "迟到冲抵20分钟")

    def test_leaves_endpoint_rejects_invalid_month(self) -> None:
        res = self.client.get(
            f"/api/admin/late-offset/leaves?month=bad&emp_id={self.manager_id}"
        )
        self.assertEqual(res.status_code, 400)

    def test_leaves_endpoint_rejects_unknown_employee(self) -> None:
        res = self.client.get("/api/admin/late-offset/leaves?month=2026-04&emp_id=999")
        self.assertEqual(res.status_code, 400)
        self.assertIn("员工不存在", res.get_json()["error"])
