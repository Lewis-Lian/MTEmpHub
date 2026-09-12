import os
import tempfile
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from flask import Flask

from models import db
from models.account_set import AccountSet
from models.employee import Employee
from models.system_setting import SystemSetting
from models.user import User
from routes import register_routes
from routes.auth_helpers import issue_slider_verified_token
from services.sync_progress_service import get_sync_progress, update_sync_progress
from tests.csrf_helper import attach_origin


class FakeClient:
    def __init__(self, records=None):
        self.records = records or []

    def attendance_records(self, *args, **kwargs):
        return self.records

    def directory_users(self):
        return []


class SyncProgressTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/sync-progress.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_NAME="account_set_access_token",
            SESSION_COOKIE_SAMESITE="None",
            SESSION_COOKIE_SECURE=False,
            UPLOAD_FOLDER=os.path.join(self.tmpdir.name, "uploads"),
            CALC_PROGRESS_DIR=os.path.join(self.tmpdir.name, "calc-progress"),
            SYNC_PROGRESS_DIR=os.path.join(self.tmpdir.name, "sync-progress"),
        )
        os.makedirs(self.app.config["UPLOAD_FOLDER"], exist_ok=True)
        os.makedirs(self.app.config["SYNC_PROGRESS_DIR"], exist_ok=True)
        db.init_app(self.app)
        register_routes(self.app)

        with self.app.app_context():
            db.create_all()
            admin = User(username="admin", role="admin")
            admin.set_password("admin123")
            db.session.add(admin)
            account_set = AccountSet(month="2026-08", name="2026年08月", is_active=True, is_locked=False)
            db.session.add(account_set)
            db.session.commit()
            self.account_set_id = account_set.id

        self.client = attach_origin(self.app.test_client())

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

    def test_sync_progress_service_write_and_read(self):
        with self.app.app_context():
            update_sync_progress(self.account_set_id, "employee", 30, "正在匹配打卡记录 (300/1000)...")
            prog = get_sync_progress(self.account_set_id, "employee")
            self.assertIsNotNone(prog)
            self.assertEqual(prog["percent"], 30)
            self.assertEqual(prog["stage"], "正在匹配打卡记录 (300/1000)...")
            self.assertEqual(prog["status"], "running")

    def test_sync_progress_endpoint(self):
        self._login()
        # 无进度时返回 idle
        resp = self.client.get(f"/api/admin/account-sets/{self.account_set_id}/sync-progress?type=employee")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["status"], "idle")

        # 写入运行中进度
        with self.app.app_context():
            update_sync_progress(self.account_set_id, "employee", 75, "正在写入员工每日考勤...")

        resp = self.client.get(f"/api/admin/account-sets/{self.account_set_id}/sync-progress?type=employee")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["status"], "running")
        self.assertEqual(body["percent"], 75)
        self.assertEqual(body["stage"], "正在写入员工每日考勤...")

        # 非法 type 返回 idle
        resp_bad = self.client.get(f"/api/admin/account-sets/{self.account_set_id}/sync-progress?type=unknown")
        self.assertEqual(resp_bad.status_code, 200)
        self.assertEqual(resp_bad.get_json()["status"], "idle")


if __name__ == "__main__":
    unittest.main()
