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
        self.client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})

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

    def test_admin_collection_endpoints_return_expected_payloads(self) -> None:
        self._login()

        accounts_response = self.client.get("/api/admin/accounts")
        employees_response = self.client.get("/api/admin/employees")
        departments_response = self.client.get("/api/admin/departments")
        shifts_response = self.client.get("/api/admin/shifts")
        employee_override_response = self.client.get(
            f"/api/admin/employee-attendance-overrides?month=2026-05&emp_ids={self.employee_id}"
        )
        employee_history_response = self.client.get("/api/admin/employee-attendance-overrides/history?month=2026-05")
        manager_override_response = self.client.get(
            f"/api/admin/manager-attendance-overrides?month=2026-05&emp_ids={self.manager_id}"
        )
        manager_history_response = self.client.get("/api/admin/manager-attendance-overrides/history?month=2026-05")
        manager_overtime_response = self.client.get(
            f"/api/admin/manager-overtime?year=2026&emp_ids={self.manager_id}"
        )
        manager_annual_leave_response = self.client.get(
            f"/api/admin/manager-annual-leave?year=2026&emp_ids={self.manager_id}"
        )
        accounts_payload = accounts_response.get_json()
        employees_payload = employees_response.get_json()
        departments_payload = departments_response.get_json()
        shifts_payload = shifts_response.get_json()
        employee_override_payload = employee_override_response.get_json()
        employee_history_payload = employee_history_response.get_json()
        manager_override_payload = manager_override_response.get_json()
        manager_history_payload = manager_history_response.get_json()
        manager_overtime_payload = manager_overtime_response.get_json()
        manager_annual_leave_payload = manager_annual_leave_response.get_json()

        self.assertEqual(accounts_response.status_code, 200)
        self.assertIsInstance(accounts_payload, list)
        self.assertIn("username", accounts_payload[0])
        self.assertIn("role", accounts_payload[0])
        self.assertEqual(accounts_payload[0]["username"], "admin")
        self.assertEqual(employees_response.status_code, 200)
        self.assertIsInstance(employees_payload, list)
        self.assertIn("emp_no", employees_payload[0])
        self.assertIn("name", employees_payload[0])
        self.assertEqual(employees_payload[0]["emp_no"], "E001")
        self.assertEqual(departments_response.status_code, 200)
        self.assertIsInstance(departments_payload, list)
        self.assertIn("dept_no", departments_payload[0])
        self.assertIn("dept_name", departments_payload[0])
        self.assertEqual(departments_payload[0]["dept_no"], "D001")
        self.assertEqual(shifts_response.status_code, 200)
        self.assertIsInstance(shifts_payload, list)
        self.assertIn("shift_no", shifts_payload[0])
        self.assertIn("shift_name", shifts_payload[0])
        self.assertEqual(shifts_payload[0]["shift_no"], "S001")
        self.assertEqual(employee_override_response.status_code, 200)
        self.assertIn("rows", employee_override_payload)
        self.assertIn("month", employee_override_payload)
        self.assertIn("employee", employee_override_payload["rows"][0])
        self.assertIn("override", employee_override_payload["rows"][0])
        self.assertIn("applied", employee_override_payload["rows"][0])
        self.assertEqual(employee_history_response.status_code, 200)
        self.assertIn("rows", employee_history_payload)
        self.assertEqual(employee_history_payload["rows"], [])
        self.assertEqual(manager_override_response.status_code, 200)
        self.assertIn("rows", manager_override_payload)
        self.assertIn("month", manager_override_payload)
        self.assertIn("employee", manager_override_payload["rows"][0])
        self.assertIn("override", manager_override_payload["rows"][0])
        self.assertIn("applied", manager_override_payload["rows"][0])
        self.assertEqual(manager_history_response.status_code, 200)
        self.assertIn("rows", manager_history_payload)
        self.assertEqual(manager_history_payload["rows"], [])
        self.assertEqual(manager_overtime_response.status_code, 200)
        self.assertIsInstance(manager_overtime_payload, list)
        self.assertIn("name", manager_overtime_payload[0])
        self.assertIn("remark", manager_overtime_payload[0])
        self.assertEqual(manager_annual_leave_response.status_code, 200)
        self.assertIsInstance(manager_annual_leave_payload, list)
        self.assertIn("name", manager_annual_leave_payload[0])
        self.assertIn("remark", manager_annual_leave_payload[0])

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
            f"/api/admin/employee-attendance-overrides?month=2026-05&emp_ids={self.employee_id}"
        ).get_json()["rows"][0]
        manager_record = self.client.get(
            f"/api/admin/manager-attendance-overrides?month=2026-05&emp_ids={self.manager_id}"
        ).get_json()["rows"][0]
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

    def test_legacy_admin_dashboard_route_is_not_available(self) -> None:
        self._login()

        response = self.client.get("/admin/dashboard")

        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
