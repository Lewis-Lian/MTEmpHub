import os
import tempfile
import unittest
from datetime import timedelta
from unittest.mock import patch

from flask import Flask

from models import db
from models.account_set import AccountSet
from models.dingtalk_sync_run import DingTalkSyncRun
from models.employee import Employee
from models.system_setting import SystemSetting
from models.user import User
from routes import register_routes
from routes import admin_core
from routes.auth_helpers import issue_slider_verified_token
from services.dingtalk_client import DingTalkClientError
from tests.csrf_helper import attach_origin


class FakeDingTalkClient:
    def __init__(self, records=None, error=None):
        self.records = records or []
        self.error = error
        self.calls = []

    def attendance_records(self, user_ids, start_date, end_date):
        self.calls.append((list(user_ids), start_date, end_date))
        if self.error:
            raise self.error
        return self.records


class DingTalkAdminApiTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/dingtalk-admin.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_NAME="dingtalk_admin_access_token",
            SESSION_COOKIE_SAMESITE="None",
            SESSION_COOKIE_SECURE=False,
            UPLOAD_FOLDER=os.path.join(self.tmpdir.name, "uploads"),
        )
        db.init_app(self.app)
        register_routes(self.app)

        with self.app.app_context():
            db.create_all()
            admin = User(username="admin", role="admin")
            admin.set_password("admin123")
            viewer = User(username="viewer", role="readonly")
            viewer.set_password("viewer123")
            account_set = AccountSet(month="2026-08", name="2026年8月", is_active=True)
            manager = Employee(
                emp_no="M001",
                name="经理甲",
                is_manager=True,
                dingtalk_user_id="user-1",
            )
            db.session.add_all([admin, viewer, account_set, manager])
            db.session.commit()
            self.account_set_id = account_set.id

        self.client = attach_origin(self.app.test_client())

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.tmpdir.cleanup()

    def _login(self, username="admin", password="admin123"):
        with self.app.app_context():
            captcha_token = issue_slider_verified_token()
        self.client.post(
            "/api/auth/login",
            json={"username": username, "password": password, "captcha_token": captcha_token},
        )

    def _set_source(self, source):
        with self.app.app_context():
            SystemSetting.set_value("manager_attendance_source", source)
            db.session.commit()

    def test_local_source_rejects_dingtalk_dispatch_without_call_or_sync_run(self):
        self._login()
        fake_client = FakeDingTalkClient()

        with patch("routes.admin_imports.DingTalkClient", return_value=fake_client):
            response = self.client.post(
                f"/api/admin/account-sets/{self.account_set_id}/manager-attendance/sync"
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.get_json(),
            {
                "status": "error",
                "read_count": 0,
                "imported_count": 0,
                "unmatched_count": 0,
                "unmatched": [],
                "sync_run_id": None,
                "message": "管理人员考勤来源为本地导入，请使用文件上传接口",
            },
        )
        self.assertEqual(fake_client.calls, [])
        with self.app.app_context():
            self.assertEqual(DingTalkSyncRun.query.count(), 0)

    def test_dingtalk_source_sync_returns_stable_partial_success_report(self):
        self._login()
        self._set_source("dingtalk")
        fake_client = FakeDingTalkClient(
            [
                {
                    "employee_no": "M001",
                    "employee_user_id": "user-1",
                    "employee_name": "经理甲",
                    "date": "2026-08-03",
                    "punch_in": "08:00",
                    "punch_out": None,
                    "result": "Normal",
                    "time_result": "Normal",
                    "location_result": "Normal",
                    "is_late": False,
                    "is_early_leave": False,
                    "raw_payload": {"recordId": "matched"},
                },
                {
                    "employee_no": "X009",
                    "employee_user_id": "user-x",
                    "employee_name": "未匹配经理",
                    "date": "2026-08-04",
                    "punch_in": "08:10",
                    "punch_out": None,
                    "result": "Late",
                    "time_result": "Late",
                    "location_result": "Normal",
                    "is_late": True,
                    "is_early_leave": False,
                    "raw_payload": {"recordId": "unmatched"},
                },
            ]
        )

        with patch("routes.admin_imports.DingTalkClient", return_value=fake_client):
            response = self.client.post(
                f"/api/admin/account-sets/{self.account_set_id}/manager-attendance/sync"
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(
            set(payload),
            {
                "status",
                "read_count",
                "imported_count",
                "unmatched_count",
                "unmatched",
                "sync_run_id",
                "message",
            },
        )
        self.assertEqual(payload["status"], "partial")
        self.assertEqual(payload["read_count"], 2)
        self.assertEqual(payload["imported_count"], 1)
        self.assertEqual(payload["unmatched_count"], 1)
        self.assertEqual(
            payload["unmatched"],
            [{"emp_no": "X009", "name": "未匹配经理", "record_date": "2026-08-04"}],
        )
        self.assertIsInstance(payload["sync_run_id"], int)
        self.assertTrue(payload["message"])
        self.assertEqual(len(fake_client.calls), 1)

    def test_authentication_and_admin_role_are_checked_before_external_call(self):
        self._set_source("dingtalk")
        fake_client = FakeDingTalkClient()

        with patch("routes.admin_imports.DingTalkClient", return_value=fake_client):
            anonymous = self.client.post(
                f"/api/admin/account-sets/{self.account_set_id}/manager-attendance/sync"
            )
            self._login("viewer", "viewer123")
            non_admin = self.client.post(
                f"/api/admin/account-sets/{self.account_set_id}/manager-attendance/sync"
            )

        self.assertEqual(anonymous.status_code, 401)
        self.assertEqual(non_admin.status_code, 403)
        self.assertEqual(fake_client.calls, [])
        with self.app.app_context():
            self.assertEqual(DingTalkSyncRun.query.count(), 0)

    def test_locked_account_set_is_rejected_before_external_call_or_mutation(self):
        self._login()
        self._set_source("dingtalk")
        with self.app.app_context():
            account_set = db.session.get(AccountSet, self.account_set_id)
            account_set.is_locked = True
            db.session.commit()
        fake_client = FakeDingTalkClient()

        with patch("routes.admin_imports.DingTalkClient", return_value=fake_client):
            response = self.client.post(
                f"/api/admin/account-sets/{self.account_set_id}/manager-attendance/sync"
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn("已锁定", response.get_json()["error"])
        self.assertEqual(fake_client.calls, [])
        with self.app.app_context():
            self.assertEqual(DingTalkSyncRun.query.count(), 0)

    def test_dingtalk_calculation_syncs_manager_data_and_continues_for_manager_and_all_modes(self):
        self._login()
        self._set_source("dingtalk")

        for mode in ("manager", "all"):
            with self.subTest(mode=mode):
                fake_client = FakeDingTalkClient()
                with patch("services.dingtalk_client.DingTalkClient", return_value=fake_client):
                    response = self.client.post(
                        f"/api/admin/account-sets/{self.account_set_id}/calculate?mode={mode}"
                    )

                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                payload = response.get_json()
                self.assertEqual(payload["mode"], mode)
                self.assertEqual(payload["dingtalk_sync"]["status"], "success")
                self.assertIsNotNone(payload["manager_stats_sync"])
                self.assertEqual(len(fake_client.calls), 1)
                self.assertEqual(fake_client.calls[0][0], ["user-1"])

        with self.app.app_context():
            self.assertEqual(DingTalkSyncRun.query.count(), 2)

    def test_sync_history_is_scoped_to_account_set_and_newest_first(self):
        self._login()
        with self.app.app_context():
            older = DingTalkSyncRun(
                account_set_id=self.account_set_id,
                month="2026-08",
                status="success",
                read_count=3,
                imported_count=3,
            )
            newer = DingTalkSyncRun(
                account_set_id=self.account_set_id,
                month="2026-08",
                status="partial",
                read_count=2,
                imported_count=1,
                unmatched_count=1,
                unmatched=[{"emp_no": "X009", "name": "未匹配经理", "record_date": "2026-08-04"}],
            )
            other_set = AccountSet(month="2026-09", name="2026年9月")
            db.session.add_all([older, newer, other_set])
            db.session.flush()
            db.session.add(
                DingTalkSyncRun(
                    account_set_id=other_set.id,
                    month="2026-09",
                    status="success",
                    read_count=9,
                    imported_count=9,
                )
            )
            db.session.commit()
            newer_id = newer.id
            older_id = older.id

        response = self.client.get(
            f"/api/admin/account-sets/{self.account_set_id}/manager-attendance/sync-history"
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual([item["sync_run_id"] for item in payload], [newer_id, older_id])
        self.assertEqual(payload[0]["status"], "partial")
        self.assertEqual(payload[0]["unmatched_count"], 1)
        self.assertTrue(payload[0]["message"])

    def test_failed_sync_and_history_return_actionable_message_without_exception_secrets(self):
        self._login()
        self._set_source("dingtalk")
        fake_client = FakeDingTalkClient(
            error=DingTalkClientError(
                "DingTalk configuration is missing: client_secret=should-not-leak"
            )
        )

        with patch("routes.admin_imports.DingTalkClient", return_value=fake_client):
            response = self.client.post(
                f"/api/admin/account-sets/{self.account_set_id}/manager-attendance/sync"
            )

        self.assertEqual(response.status_code, 502)
        payload = response.get_json()
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(
            payload["message"],
            "钉钉配置缺失，请检查 DINGTALK_CLIENT_ID、DINGTALK_CLIENT_SECRET 和 DINGTALK_CORP_ID",
        )
        self.assertNotIn("should-not-leak", str(payload))

        history = self.client.get(
            f"/api/admin/account-sets/{self.account_set_id}/manager-attendance/sync-history"
        )
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.get_json()[0]["message"], payload["message"])
        self.assertNotIn("should-not-leak", history.get_data(as_text=True))

    def test_failure_serializer_redacts_quoted_json_credentials_and_keeps_context(self):
        payload = admin_core._dingtalk_sync_response(
            {
                "status": "failed",
                "error": (
                    'DingTalk API failed: {"client_secret": "should-not-leak", '
                    '"access_token": "token-value", "client_id": "app-id"}'
                ),
            }
        )

        self.assertIn("DingTalk API failed", payload["message"])
        self.assertIn("client_secret", payload["message"])
        self.assertNotIn("should-not-leak", payload["message"])
        self.assertNotIn("token-value", payload["message"])
        self.assertNotIn("app-id", payload["message"])

    def test_unmatched_csv_download_is_admin_only_and_uses_run_details(self):
        with self.app.app_context():
            run = DingTalkSyncRun(
                account_set_id=self.account_set_id,
                month="2026-08",
                status="partial",
                read_count=1,
                imported_count=0,
                unmatched_count=2,
                unmatched=[
                    {
                        "emp_no": "  =2+2",
                        "name": "+SUM(1,2)",
                        "record_date": "@malicious",
                    },
                    {
                        "emp_no": "X,009",
                        "name": '王"某',
                        "record_date": "2026-08-04",
                    },
                ],
            )
            db.session.add(run)
            db.session.commit()
            run_id = run.id

        anonymous = self.client.get(
            f"/api/admin/manager-attendance/sync-runs/{run_id}/unmatched.csv"
        )
        self.assertEqual(anonymous.status_code, 401)

        self._login()
        response = self.client.get(
            f"/api/admin/manager-attendance/sync-runs/{run_id}/unmatched.csv"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "text/csv")
        self.assertIn(f"dingtalk-unmatched-{run_id}.csv", response.headers["Content-Disposition"])
        self.assertEqual(
            response.data.decode("utf-8-sig"),
            "钉钉工号,姓名,考勤日期\r\n"
            "  '=2+2,\"'+SUM(1,2)\",'@malicious\r\n"
            "\"X,009\",\"王\"\"某\",2026-08-04\r\n",
        )


if __name__ == "__main__":
    unittest.main()
