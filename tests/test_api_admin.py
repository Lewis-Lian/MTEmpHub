import os
import tempfile
import unittest
from datetime import timedelta

from flask import Flask

from models import db
from models.account_set import AccountSet
from models.department import Department
from models.employee import Employee
from models.shift import Shift
from models.user import User
from routes import register_routes


class ApiAdminTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/api-admin.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_NAME="api_admin_access_token",
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

            employee = Employee(emp_no="E001", name="员工甲", dept_id=dept.id, is_manager=False)
            manager = Employee(emp_no="M001", name="经理甲", dept_id=dept.id, is_manager=True)
            db.session.add_all([employee, manager])
            db.session.add(AccountSet(month="2026-05", name="2026-05", is_active=True, is_locked=False))
            db.session.commit()

            self.employee_id = employee.id
            self.manager_id = manager.id

        self.client = self.app.test_client()

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def _login(self) -> None:
        self.client.post("/login", data={"username": "admin", "password": "admin123"})

    def test_admin_routes_are_registered_under_api_prefix(self) -> None:
        rules = {rule.rule for rule in self.app.url_map.iter_rules()}

        self.assertTrue(
            {
                "/api/admin/bootstrap",
                "/api/admin/accounts",
                "/api/admin/employees",
                "/api/admin/departments",
                "/api/admin/shifts",
                "/api/admin/employee-attendance-overrides",
                "/api/admin/employee-attendance-overrides/history",
                "/api/admin/employee-attendance-overrides/record",
                "/api/admin/manager-attendance-overrides",
                "/api/admin/manager-attendance-overrides/history",
                "/api/admin/manager-attendance-overrides/record",
                "/api/admin/manager-overtime",
                "/api/admin/manager-annual-leave",
            }.issubset(rules)
        )

    def test_admin_bootstrap_requires_login(self) -> None:
        response = self.client.get("/api/admin/bootstrap")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json(), {"error": "Unauthorized"})

    def test_admin_bootstrap_returns_departments_and_shifts(self) -> None:
        self._login()

        response = self.client.get("/api/admin/bootstrap")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual([row["dept_no"] for row in payload["departments"]], ["D001"])
        self.assertEqual([row["shift_no"] for row in payload["shifts"]], ["S001"])

    def test_admin_collection_wrappers_match_existing_json_routes(self) -> None:
        self._login()

        self.assertEqual(
            self.client.get("/api/admin/accounts").get_json(),
            self.client.get("/admin/users").get_json(),
        )
        self.assertEqual(
            self.client.get("/api/admin/employees").get_json(),
            self.client.get("/admin/employees").get_json(),
        )
        self.assertEqual(
            self.client.get("/api/admin/departments").get_json(),
            self.client.get("/admin/departments").get_json(),
        )
        self.assertEqual(
            self.client.get("/api/admin/shifts").get_json(),
            self.client.get("/admin/shifts").get_json(),
        )
        self.assertEqual(
            self.client.get(
                f"/api/admin/employee-attendance-overrides?month=2026-05&emp_ids={self.employee_id}"
            ).get_json(),
            self.client.get(
                f"/admin/employee-attendance-overrides/list?month=2026-05&emp_ids={self.employee_id}"
            ).get_json(),
        )
        self.assertEqual(
            self.client.get("/api/admin/employee-attendance-overrides/history?month=2026-05").get_json(),
            self.client.get("/admin/employee-attendance-overrides/history?month=2026-05").get_json(),
        )
        self.assertEqual(
            self.client.get(
                f"/api/admin/manager-attendance-overrides?month=2026-05&emp_ids={self.manager_id}"
            ).get_json(),
            self.client.get(
                f"/admin/manager-attendance-overrides/list?month=2026-05&emp_ids={self.manager_id}"
            ).get_json(),
        )
        self.assertEqual(
            self.client.get("/api/admin/manager-attendance-overrides/history?month=2026-05").get_json(),
            self.client.get("/admin/manager-attendance-overrides/history?month=2026-05").get_json(),
        )
        self.assertEqual(
            self.client.get(f"/api/admin/manager-overtime?year=2026&emp_ids={self.manager_id}").get_json(),
            self.client.get(f"/admin/manager-overtime/records?year=2026&emp_ids={self.manager_id}").get_json(),
        )
        self.assertEqual(
            self.client.get(f"/api/admin/manager-annual-leave?year=2026&emp_ids={self.manager_id}").get_json(),
            self.client.get(f"/admin/manager-annual-leave/records?year=2026&emp_ids={self.manager_id}").get_json(),
        )

    def test_admin_record_wrappers_reuse_existing_write_behavior(self) -> None:
        self._login()

        employee_response = self.client.put(
            "/api/admin/employee-attendance-overrides/record",
            json={
                "month": "2026-05",
                "emp_id": self.employee_id,
                "attendance_days": "3",
                "work_hours": "21.5",
                "half_days": "1",
                "late_early_minutes": "10",
                "remark": "员工修正",
            },
        )
        manager_response = self.client.put(
            "/api/admin/manager-attendance-overrides/record",
            json={
                "month": "2026-05",
                "emp_id": self.manager_id,
                "attendance_days": "20",
                "injury_days": "1",
                "business_trip_days": "2",
                "marriage_days": "0",
                "funeral_days": "0",
                "late_early_minutes": "5",
                "remark": "经理修正",
            },
        )

        self.assertEqual(employee_response.status_code, 200)
        self.assertEqual(manager_response.status_code, 200)

        employee_record = self.client.get(
            f"/admin/employee-attendance-overrides/record?emp_id={self.employee_id}&month=2026-05"
        ).get_json()
        manager_record = self.client.get(
            f"/admin/manager-attendance-overrides/record?emp_id={self.manager_id}&month=2026-05"
        ).get_json()
        employee_history = self.client.get(
            "/api/admin/employee-attendance-overrides/history?month=2026-05"
        ).get_json()["rows"]
        manager_history = self.client.get(
            "/api/admin/manager-attendance-overrides/history?month=2026-05"
        ).get_json()["rows"]

        self.assertEqual(employee_record["override"]["attendance_days"], 3.0)
        self.assertEqual(employee_record["override"]["remark"], "员工修正")
        self.assertEqual(manager_record["override"]["attendance_days"], 20.0)
        self.assertEqual(manager_record["override"]["remark"], "经理修正")
        self.assertEqual(employee_history[0]["action_type"], "manual_save")
        self.assertEqual(manager_history[0]["action_type"], "manual_save")


if __name__ == "__main__":
    unittest.main()
