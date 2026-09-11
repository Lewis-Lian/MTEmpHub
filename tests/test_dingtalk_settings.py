import os
import tempfile
import unittest
from datetime import timedelta
from unittest.mock import patch

from flask import Flask

from models import db
from models.department import Department
from models.employee import Employee
from models.system_setting import SystemSetting
from models.user import User
from routes import register_routes
from routes.auth_helpers import issue_slider_verified_token
from services.migration_service import MIGRATION_ORDER
from services.dingtalk_client import DingTalkClientError
from tests.csrf_helper import attach_origin


class DingTalkSettingsTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/settings.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_NAME="settings_access_token",
            SESSION_COOKIE_SECURE=False,
        )
        db.init_app(self.app)
        register_routes(self.app)
        with self.app.app_context():
            db.create_all()
            admin = User(username="admin", role="admin")
            admin.set_password("admin123")
            dept = Department(dept_no="D001", dept_name="行政部")
            db.session.add_all([admin, dept])
            db.session.flush()
            self.employee = Employee(emp_no="E001", name="员工甲", dept_id=dept.id)
            db.session.add(self.employee)
            db.session.commit()
        self.client = attach_origin(self.app.test_client())
        self.env_patch = patch("utils.env_utils.read_env", return_value={"SETUP_PASSWORD": "testpass"})
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.tmpdir.cleanup()

    def _login(self):
        with self.app.app_context():
            captcha_token = issue_slider_verified_token()
        self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "admin123", "captcha_token": captcha_token},
        )

    def test_settings_default_and_valid_updates_are_persisted(self):
        with patch.dict(os.environ, {"DINGTALK_CLIENT_ID": "", "DINGTALK_CLIENT_SECRET": "", "DINGTALK_CORP_ID": ""}):
            response = self.client.get("/api/admin/attendance-settings")
            self.assertEqual(response.status_code, 401)

        self._login()

        with patch.dict(os.environ, {"DINGTALK_CLIENT_ID": "", "DINGTALK_CLIENT_SECRET": "", "DINGTALK_CORP_ID": ""}):
            response = self.client.get("/api/admin/attendance-settings")
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertEqual(payload["manager_attendance_source"], "local")
            self.assertFalse(payload["dingtalk_configured"])
            self.assertNotIn("DINGTALK_CLIENT_SECRET", payload)
            self.assertNotIn("secret", str(payload))

        with patch.dict(os.environ, {"DINGTALK_CLIENT_ID": "", "DINGTALK_CLIENT_SECRET": "", "DINGTALK_CORP_ID": ""}):
            response = self.client.put(
                "/api/admin/attendance-settings", json={"manager_attendance_source": "dingtalk"}
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_json()["manager_attendance_source"], "dingtalk")
            self.assertFalse(response.get_json()["dingtalk_configured"])

        response = self.client.put(
            "/api/admin/attendance-settings", json={"manager_attendance_source": "local"}
        )
        self.assertEqual(response.status_code, 200)
        with self.app.app_context():
            self.assertEqual(SystemSetting.get_value("manager_attendance_source"), "local")

    def test_invalid_source_is_rejected_and_employee_mapping_is_nullable_and_non_secret(self):
        self._login()
        with patch.dict(os.environ, {"DINGTALK_CLIENT_ID": "", "DINGTALK_CLIENT_SECRET": "", "DINGTALK_CORP_ID": ""}):
            response = self.client.put(
                "/api/admin/attendance-settings", json={"manager_attendance_source": "remote"}
            )
            self.assertEqual(response.status_code, 400)

        response = self.client.get("/api/admin/employees")
        self.assertEqual(response.status_code, 200)
        employee = response.get_json()[0]
        self.assertIn("dingtalk_user_id", employee)
        self.assertIsNone(employee["dingtalk_user_id"])
        self.assertNotIn("DINGTALK_CLIENT_SECRET", employee)

    def test_database_migration_order_includes_persisted_system_settings(self):
        self.assertLess(MIGRATION_ORDER.index("employees"), MIGRATION_ORDER.index("system_settings"))

    def test_attendance_connection_test_returns_sanitized_success_or_actionable_failure(self):
        self._login()
        with patch("services.dingtalk_client.DingTalkClient.test_connection", return_value=True):
            response = self.client.post("/api/admin/attendance-settings/test")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])
        self.assertNotIn("secret", str(response.get_json()).lower())

        with patch("services.dingtalk_client.DingTalkClient.test_connection", side_effect=DingTalkClientError("钉钉考勤接口无访问权限，请检查应用权限")):
            response = self.client.post("/api/admin/attendance-settings/test")
        self.assertEqual(response.status_code, 502)
        self.assertIn("访问权限", response.get_json()["message"])
        self.assertNotIn("secret", str(response.get_json()).lower())

        with patch("services.dingtalk_client.DingTalkClient.test_connection", side_effect=DingTalkClientError("DingTalk token request returned an error")):
            response = self.client.post("/api/admin/attendance-settings/test")
        self.assertEqual(response.status_code, 502)
        self.assertIn("钉钉认证失败", response.get_json()["message"])
        self.assertNotIn("DingTalk token request", str(response.get_json()))


if __name__ == "__main__":
    unittest.main()
