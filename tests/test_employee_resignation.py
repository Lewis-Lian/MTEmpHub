import os
import tempfile
import unittest
from datetime import date, timedelta

from flask import Flask

from models import db
from models.department import Department
from models.employee import Employee
from models.user import User, UserEmployeeAssignment
from routes import register_routes
from routes.auth_helpers import issue_slider_verified_token
from tests.csrf_helper import attach_origin


class EmployeeResignationTestBase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/resignation.db",
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
            db.session.add_all([admin, dept])
            db.session.flush()

            self.active_emp = Employee(emp_no="E100", name="在职员工", dept_id=dept.id)
            self.resigned_emp = Employee(
                emp_no="E200", name="已离职员工", dept_id=dept.id, resigned_at=date(2026, 8, 31)
            )
            db.session.add_all([self.active_emp, self.resigned_emp])
            db.session.commit()
            self.active_emp_id = self.active_emp.id
            self.resigned_emp_id = self.resigned_emp.id

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


class TestEmployeeResignationField(EmployeeResignationTestBase):
    def test_serialize_employee_includes_resigned_at(self) -> None:
        self._login()

        response = self.client.get("/api/admin/employees?status=all")

        self.assertEqual(response.status_code, 200)
        rows = {row["emp_no"]: row for row in response.get_json()}
        self.assertIsNone(rows["E100"]["resigned_at"])
        self.assertEqual(rows["E200"]["resigned_at"], "2026-08-31")
