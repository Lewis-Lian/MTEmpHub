import os
import tempfile
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from flask import Flask

from models import db
from models.account_set import AccountSet
from models.account_set import AccountSetImport
from models.daily_record import DailyRecord
from models.dingtalk_sync_run import DingTalkSyncRun
from models.employee import Employee
from models.system_setting import SystemSetting
from models.user import User
from routes import register_routes
from routes.auth_helpers import issue_slider_verified_token
from services.card_db_client import CardDBClientError
from tests.csrf_helper import attach_origin


class FakeCardClient:
    def __init__(self, records=None, error=None):
        self.records = records or []
        self.error = error
        self.calls = []

    def attendance_records(self, start_date, end_date):
        self.calls.append((start_date, end_date))
        if self.error:
            raise self.error
        return self.records

    @staticmethod
    def record(person_no="E001", day=date(2026, 8, 3), times=None):
        return {
            "person_no": person_no,
            "person_name": "员工甲",
            "dept_name": "安全管理部",
            "card_no": "",
            "record_date": day,
            "times": times if times is not None else ["07:25", "17:09"],
        }


class CardAttendanceAdminApiTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/card-admin.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_NAME="card_admin_access_token",
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
            employee = Employee(emp_no="E001", name="员工甲", is_manager=False)
            db.session.add_all([admin, viewer, account_set, employee])
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

    def _set_employee_source(self, source):
        with self.app.app_context():
            SystemSetting.set_value("employee_attendance_source", source)
            db.session.commit()

    def _save_card_db_settings(self):
        with self.app.app_context():
            for key, value in {
                "card_db_host": "192.0.2.10",
                "card_db_port": "1433",
                "card_db_database": "STCard_Test",
                "card_db_user": "card_user",
                "card_db_password": "card-pass-123",
            }.items():
                SystemSetting.set_value(key, value)
            db.session.commit()

    # ---- 设置项 ----

    def test_attendance_settings_include_card_defaults_without_password(self):
        self._login()
        response = self.client.get("/api/admin/attendance-settings")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(
            set(payload),
            {
                "manager_attendance_source",
                "dingtalk_configured",
                "employee_attendance_source",
                "card_db",
                "card_db_configured",
            },
        )
        self.assertEqual(payload["manager_attendance_source"], "local")
        self.assertEqual(payload["employee_attendance_source"], "local")
        self.assertEqual(payload["card_db"], {})
        self.assertFalse(payload["card_db_configured"])

    def test_save_employee_source_and_card_db_config_hides_password(self):
        self._login()
        response = self.client.put(
            "/api/admin/attendance-settings",
            json={
                "manager_attendance_source": "local",
                "employee_attendance_source": "card_db",
                "card_db": {
                    "host": "192.0.2.10",
                    "port": 1433,
                    "database": "STCard_Test",
                    "user": "card_user",
                    "password": "card-pass-123",
                },
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["employee_attendance_source"], "card_db")
        self.assertTrue(payload["card_db_configured"])
        self.assertEqual(
            payload["card_db"],
            {"host": "192.0.2.10", "port": 1433, "database": "STCard_Test", "user": "card_user"},
        )
        self.assertNotIn("card-pass-123", response.get_data(as_text=True))

        # 再次保存不带密码：保留原密码
        response = self.client.put(
            "/api/admin/attendance-settings",
            json={
                "manager_attendance_source": "local",
                "card_db": {"host": "192.0.2.11"},
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["card_db_configured"])
        with self.app.app_context():
            self.assertEqual(SystemSetting.get_value("card_db_host"), "192.0.2.11")
            self.assertEqual(SystemSetting.get_value("card_db_password"), "card-pass-123")

    def test_invalid_employee_source_is_rejected(self):
        self._login()
        response = self.client.put(
            "/api/admin/attendance-settings",
            json={"manager_attendance_source": "local", "employee_attendance_source": "cloud"},
        )
        self.assertEqual(response.status_code, 400)

    def test_card_connection_test_reports_success_and_sanitized_failure(self):
        self._login()
        self._save_card_db_settings()
        fake_client = FakeCardClient()
        fake_client.test_connection = lambda: "Microsoft SQL Server 2012 - 11.0.2100.60 (X64)"
        with patch("services.card_db_client.CardDBClient", return_value=fake_client):
            ok = self.client.post("/api/admin/attendance-settings/card-test")
        self.assertEqual(ok.status_code, 200)
        self.assertTrue(ok.get_json()["ok"])
        self.assertIn("SQL Server", ok.get_json()["message"])

        broken = FakeCardClient()
        broken.test_connection = lambda: (_ for _ in ()).throw(
            CardDBClientError("login failed password='card-pass-123'")
        )
        with patch("services.card_db_client.CardDBClient", return_value=broken):
            failed = self.client.post("/api/admin/attendance-settings/card-test")
        self.assertEqual(failed.status_code, 502)
        self.assertFalse(failed.get_json()["ok"])
        self.assertNotIn("card-pass-123", failed.get_data(as_text=True))

    def test_card_connection_test_accepts_form_values_with_saved_password_fallback(self):
        self._login()
        self._save_card_db_settings()

        captured = {}

        class CapturingClient:
            def __init__(self, config):
                captured.update(config)

            def test_connection(self):
                return "SQL Server 2012"

        import services.card_db_client as card_db_module

        with patch.object(card_db_module, "CardDBClient", CapturingClient):
            response = self.client.post(
                "/api/admin/attendance-settings/card-test",
                json={"card_db": {"host": "192.0.2.12", "password": "NewPass@1"}},
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])
        self.assertEqual(captured["host"], "192.0.2.12")
        self.assertEqual(captured["database"], "STCard_Test")
        self.assertEqual(captured["password"], "NewPass@1")

        # 表单密码留空 → 回退已保存密码
        captured.clear()
        with patch.object(card_db_module, "CardDBClient", CapturingClient):
            self.client.post(
                "/api/admin/attendance-settings/card-test",
                json={"card_db": {"host": "192.0.2.13"}},
            )
        self.assertEqual(captured["host"], "192.0.2.13")
        self.assertEqual(captured["password"], "card-pass-123")

    def test_card_connection_test_rejects_non_numeric_port(self):
        self._login()
        self._save_card_db_settings()
        response = self.client.post(
            "/api/admin/attendance-settings/card-test",
            json={"card_db": {"port": "14a3"}},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("端口", response.get_json()["error"])

    def test_card_connection_test_without_config_reports_missing_settings(self):
        self._login()
        response = self.client.post("/api/admin/attendance-settings/card-test")
        self.assertEqual(response.status_code, 502)
        self.assertIn("未配置", response.get_json()["message"])

    # ---- 同步端点 ----

    def test_local_source_rejects_employee_sync(self):
        self._login()
        fake_client = FakeCardClient()
        with patch("routes.admin_imports.CardDBClient", return_value=fake_client):
            response = self.client.post(
                f"/api/admin/account-sets/{self.account_set_id}/employee-attendance/sync"
            )
        self.assertEqual(response.status_code, 409)
        self.assertIn("本地上传", response.get_json()["message"])
        self.assertEqual(fake_client.calls, [])
        with self.app.app_context():
            self.assertEqual(DingTalkSyncRun.query.count(), 0)

    def test_employee_sync_returns_stable_report(self):
        self._login()
        self._set_employee_source("card_db")
        fake_client = FakeCardClient([FakeCardClient.record("E001")])
        with patch("routes.admin_imports.CardDBClient", return_value=fake_client):
            response = self.client.post(
                f"/api/admin/account-sets/{self.account_set_id}/employee-attendance/sync"
            )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["read_count"], 1)
        self.assertEqual(payload["imported_count"], 1)
        self.assertIsInstance(payload["sync_run_id"], int)
        self.assertTrue(payload["message"])
        with self.app.app_context():
            row = DailyRecord.query.one()
            self.assertEqual(row.check_in_times, ["07:25"])

    def test_employee_sync_requires_admin_and_unlocked_account_set(self):
        self._set_employee_source("card_db")
        fake_client = FakeCardClient()
        with patch("routes.admin_imports.CardDBClient", return_value=fake_client):
            anonymous = self.client.post(
                f"/api/admin/account-sets/{self.account_set_id}/employee-attendance/sync"
            )
            self._login("viewer", "viewer123")
            non_admin = self.client.post(
                f"/api/admin/account-sets/{self.account_set_id}/employee-attendance/sync"
            )
        self.assertEqual(anonymous.status_code, 401)
        self.assertEqual(non_admin.status_code, 403)
        self.assertEqual(fake_client.calls, [])

        self._login()
        with self.app.app_context():
            account_set = db.session.get(AccountSet, self.account_set_id)
            account_set.is_locked = True
            db.session.commit()
        with patch("routes.admin_imports.CardDBClient", return_value=fake_client):
            locked = self.client.post(
                f"/api/admin/account-sets/{self.account_set_id}/employee-attendance/sync"
            )
        self.assertEqual(locked.status_code, 400)
        self.assertIn("已锁定", locked.get_json()["error"])
        self.assertEqual(fake_client.calls, [])

    def test_failed_employee_sync_returns_sanitized_message(self):
        self._login()
        self._set_employee_source("card_db")
        fake_client = FakeCardClient(error=CardDBClientError("login failed password='card-pass-123'"))
        with patch("routes.admin_imports.CardDBClient", return_value=fake_client):
            response = self.client.post(
                f"/api/admin/account-sets/{self.account_set_id}/employee-attendance/sync"
            )
        self.assertEqual(response.status_code, 502)
        payload = response.get_json()
        self.assertEqual(payload["status"], "failed")
        self.assertNotIn("card-pass-123", response.get_data(as_text=True))

    # ---- 历史与 CSV ----

    def test_sync_history_is_scoped_by_source(self):
        self._login()
        with self.app.app_context():
            dingtalk_run = DingTalkSyncRun(
                account_set_id=self.account_set_id,
                month="2026-08",
                status="success",
            )
            card_run = DingTalkSyncRun(
                account_set_id=self.account_set_id,
                month="2026-08",
                source="card",
                status="partial",
                unmatched_count=1,
                unmatched=[{"emp_no": "X009", "name": "外部", "record_date": "2026-08-03"}],
            )
            db.session.add_all([dingtalk_run, card_run])
            db.session.commit()
            card_run_id = card_run.id

        employee_history = self.client.get(
            f"/api/admin/account-sets/{self.account_set_id}/employee-attendance/sync-history"
        )
        self.assertEqual(employee_history.status_code, 200)
        employee_runs = employee_history.get_json()
        self.assertEqual(len(employee_runs), 1)
        self.assertEqual(employee_runs[0]["sync_run_id"], card_run_id)
        self.assertEqual(employee_runs[0]["status"], "partial")
        self.assertTrue(employee_runs[0]["message"])

        manager_history = self.client.get(
            f"/api/admin/account-sets/{self.account_set_id}/manager-attendance/sync-history"
        )
        self.assertEqual([run["status"] for run in manager_history.get_json()], ["success"])

        csv_response = self.client.get(
            f"/api/admin/employee-attendance/sync-runs/{card_run_id}/unmatched.csv"
        )
        self.assertEqual(csv_response.status_code, 200)
        self.assertIn(f"card-unmatched-{card_run_id}.csv", csv_response.headers["Content-Disposition"])
        self.assertEqual(
            csv_response.data.decode("utf-8-sig"),
            "考勤机工号,姓名,考勤日期\r\nX009,外部,2026-08-03\r\n",
        )

    # ---- 计算联动 ----

    def test_employee_calculation_with_card_source_syncs_and_skips_daily_files(self):
        self._login()
        self._set_employee_source("card_db")
        with self.app.app_context():
            db.session.add(AccountSetImport(
                account_set_id=self.account_set_id,
                source_filename="员工日考勤.xlsx",
                stored_path="/nonexistent/daily.xlsx",
                file_type="daily",
            ))
            db.session.commit()

        fake_client = FakeCardClient([FakeCardClient.record("E001")])
        with patch("services.card_db_client.CardDBClient", return_value=fake_client):
            response = self.client.post(
                f"/api/admin/account-sets/{self.account_set_id}/calculate?mode=employee"
            )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["card_sync"]["status"], "success")
        self.assertEqual(len(fake_client.calls), 1)
        # daily 文件被排除：不尝试导入不存在的文件
        self.assertEqual(
            [item["file"] for item in payload["results"] if item["status"] == "error"],
            [],
        )

    def test_manager_mode_calculation_does_not_trigger_card_sync(self):
        self._login()
        self._set_employee_source("card_db")
        fake_client = FakeCardClient()
        with patch("services.card_db_client.CardDBClient", return_value=fake_client):
            response = self.client.post(
                f"/api/admin/account-sets/{self.account_set_id}/calculate?mode=manager"
            )
        # manager 模式且账套无文件：按原逻辑 400，且不触发考勤机同步
        self.assertEqual(response.status_code, 400)
        self.assertEqual(fake_client.calls, [])
        self.assertNotIn("card_sync", response.get_json())
        with self.app.app_context():
            self.assertEqual(DingTalkSyncRun.query.count(), 0)


if __name__ == "__main__":
    unittest.main()
