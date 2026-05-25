import tempfile
import unittest
from datetime import timedelta

from flask import Flask

from models import db
from models.account_set import AccountSet
from models.department import Department
from models.employee import Employee
from models.user import User, UserEmployeeAssignment
from routes import register_routes


class ApiQueryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/query.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_NAME="api_access_token",
            SESSION_COOKIE_SAMESITE="None",
            SESSION_COOKIE_SECURE=False,
        )
        db.init_app(self.app)
        register_routes(self.app)

        with self.app.app_context():
            db.create_all()

            dept_a = Department(dept_no="D001", dept_name="制造一部")
            dept_b = Department(dept_no="D002", dept_name="制造二部")
            db.session.add_all([dept_a, dept_b])
            db.session.flush()

            employee_a = Employee(emp_no="E001", name="员工甲", dept_id=dept_a.id, is_manager=False)
            employee_b = Employee(emp_no="E002", name="员工乙", dept_id=dept_b.id, is_manager=False)
            db.session.add_all([employee_a, employee_b])
            db.session.flush()

            db.session.add(AccountSet(month="2026-05", name="2026年5月", is_active=True, is_locked=False))

            viewer = User(
                username="viewer",
                role="readonly",
                page_permissions={
                    "employee_dashboard": True,
                    "summary_download": True,
                },
            )
            viewer.set_password("viewer123")
            blocked = User(username="blocked", role="readonly", page_permissions={"employee_dashboard": True})
            blocked.set_password("blocked123")
            home_only = User(username="home-only", role="readonly", page_permissions={})
            home_only.set_password("home123")
            db.session.add_all([viewer, blocked, home_only])
            db.session.flush()

            db.session.add(UserEmployeeAssignment(user_id=viewer.id, emp_id=employee_a.id))
            db.session.add(UserEmployeeAssignment(user_id=blocked.id, emp_id=employee_a.id))
            db.session.commit()

        self.client = self.app.test_client()

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def _login(self, username: str, password: str):
        return self.client.post("/api/auth/login", json={"username": username, "password": password})

    def test_query_routes_are_registered_under_api_prefix(self) -> None:
        rules = {rule.rule for rule in self.app.url_map.iter_rules()}

        self.assertTrue(
            {
                "/api/query/bootstrap",
                "/api/query/navigation",
                "/api/query/employee-dashboard",
                "/api/query/abnormal",
                "/api/query/punch-records",
                "/api/query/department-hours",
                "/api/query/manager-attendance",
                "/api/query/manager-overtime",
                "/api/query/manager-annual-leave",
                "/api/query/manager-department-hours",
                "/api/query/summary-download/export",
            }.issubset(rules)
        )

    def test_query_bootstrap_returns_account_sets_and_scoped_people(self) -> None:
        self._login("viewer", "viewer123")

        response = self.client.get("/api/query/bootstrap")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["account_sets"][0]["month"], "2026-05")
        self.assertEqual([row["emp_no"] for row in payload["employees"]], ["E001"])
        self.assertEqual([row["dept_no"] for row in payload["departments"]], ["D001"])

    def test_query_bootstrap_propagates_forbidden_from_nested_permissions(self) -> None:
        self._login("home-only", "home123")

        response = self.client.get("/api/query/bootstrap")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json(), {"error": "Forbidden"})

    def test_query_navigation_api_returns_visible_query_entries(self) -> None:
        self._login("viewer", "viewer123")

        response = self.client.get("/api/query/navigation")

        self.assertEqual(response.status_code, 200)
        modules = response.get_json()["modules"]
        query_module = next(module for module in modules if module["slug"] == "query")
        entry_keys = {entry["key"] for entry in query_module["entries"]}
        self.assertIn("employee_dashboard", entry_keys)
        self.assertIn("summary_download", entry_keys)
        self.assertTrue(all("href" in entry for entry in query_module["entries"]))

    def test_legacy_employee_dashboard_route_is_not_available(self) -> None:
        self._login("viewer", "viewer123")

        response = self.client.get("/employee/dashboard")

        self.assertEqual(response.status_code, 404)

    def test_summary_download_wrapper_requires_matching_permission(self) -> None:
        self._login("blocked", "blocked123")

        response = self.client.get("/api/query/summary-download/export?month=2026-05")

        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
