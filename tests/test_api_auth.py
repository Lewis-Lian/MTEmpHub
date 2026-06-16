import tempfile
import unittest
from datetime import timedelta
from unittest.mock import patch

from flask import Flask

from models import db
from models.user import User
from routes import register_routes
from tests.csrf_helper import attach_origin


class ApiAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/auth.db",
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
            user = User(username="admin", role="admin")
            user.set_password("admin123")
            db.session.add(user)
            db.session.commit()
        self.client = attach_origin(self.app.test_client())

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_api_login_sets_configured_cookie_and_cors_headers(self) -> None:
        response = self.client.post(
            "/api/auth/login",
            json={
                "username": "admin",
                "password": "admin123",
            },
            headers={"Origin": "http://localhost:5173"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173")
        self.assertEqual(response.headers.get("Access-Control-Allow-Credentials"), "true")
        cookie_name = response.headers.get("Set-Cookie", "").split("=", 1)[0]
        self.assertEqual(cookie_name, "api_access_token")

    def test_api_login_with_remember_me_sets_persistent_cookie(self) -> None:
        response = self.client.post(
            "/api/auth/login",
            json={
                "username": "admin",
                "password": "admin123",
                "remember_me": True,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("Max-Age=2592000", response.headers.get("Set-Cookie", ""))

    def test_api_me_requires_cookie_auth(self) -> None:
        response = self.client.get("/api/auth/me")

        self.assertEqual(response.status_code, 401)

    def test_api_me_returns_current_user_with_configured_cookie(self) -> None:
        login_response = self.client.post(
            "/api/auth/login",
            json={
                "username": "admin",
                "password": "admin123",
            },
            headers={"Origin": "http://localhost:5173"},
        )

        self.assertEqual(login_response.status_code, 200)

        response = self.client.get("/api/auth/me")
        payload = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["username"], "admin")
        self.assertEqual(payload["role"], "admin")
        self.assertTrue(payload["page_permissions"]["query_home"])

    def test_legacy_login_endpoint_is_not_available(self) -> None:
        response = self.client.post(
            "/login",
            data={"username": "admin", "password": "admin123", "remember_me": "1"},
        )

        self.assertEqual(response.status_code, 404)

    def test_api_login_preflight_returns_cors_headers(self) -> None:
        response = self.client.open(
            "/api/auth/login",
            method="OPTIONS",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173")
        self.assertEqual(response.headers.get("Access-Control-Allow-Credentials"), "true")
        self.assertIn("Content-Type", response.headers.get("Access-Control-Allow-Headers", ""))

    def test_api_logout_clears_configured_cookie(self) -> None:
        self.client.post(
            "/api/auth/login",
            json={
                "username": "admin",
                "password": "admin123",
            },
            headers={"Origin": "http://localhost:5173"},
        )

        response = self.client.post("/api/auth/logout", headers={"Origin": "http://localhost:5173"})

        self.assertEqual(response.status_code, 200)
        self.assertIn("api_access_token=;", response.headers.get("Set-Cookie", ""))

    def test_change_password_rejects_wrong_current_password(self) -> None:
        response = self.client.post(
            "/api/auth/change-password",
            json={
                "username": "admin",
                "current_password": "wrong-password",
                "new_password": "newpass123",
                "confirm_password": "newpass123",
            },
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "用户名或原密码错误")

        login_response = self.client.post(
            "/api/auth/login",
            json={
                "username": "admin",
                "password": "admin123",
            },
        )
        self.assertEqual(login_response.status_code, 200)

    def test_change_password_requires_matching_confirmation(self) -> None:
        response = self.client.post(
            "/api/auth/change-password",
            json={
                "username": "admin",
                "current_password": "admin123",
                "new_password": "newpass123",
                "confirm_password": "different123",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "两次输入的新密码不一致")

    def test_change_password_updates_password_after_current_password_verification(self) -> None:
        response = self.client.post(
            "/api/auth/change-password",
            json={
                "username": "admin",
                "current_password": "admin123",
                "new_password": "newpass123",
                "confirm_password": "newpass123",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"ok": True})

        old_login_response = self.client.post(
            "/api/auth/login",
            json={
                "username": "admin",
                "password": "admin123",
            },
        )
        self.assertEqual(old_login_response.status_code, 401)

        new_login_response = self.client.post(
            "/api/auth/login",
            json={
                "username": "admin",
                "password": "newpass123",
            },
        )
        self.assertEqual(new_login_response.status_code, 200)

    def test_change_password_locks_account_after_five_failed_attempts(self) -> None:
        for _ in range(4):
            response = self.client.post(
                "/api/auth/change-password",
                json={
                    "username": "admin",
                    "current_password": "wrong-password",
                    "new_password": "newpass123",
                    "confirm_password": "newpass123",
                },
            )
            self.assertEqual(response.status_code, 401)

        fifth_response = self.client.post(
            "/api/auth/change-password",
            json={
                "username": "admin",
                "current_password": "wrong-password",
                "new_password": "newpass123",
                "confirm_password": "newpass123",
            },
        )

        self.assertEqual(fifth_response.status_code, 423)
        self.assertEqual(
            fifth_response.get_json()["error"],
            "该账号已被临时禁用 10 分钟，请稍后再试",
        )

    def test_change_password_rejects_when_account_temporarily_locked(self) -> None:
        for _ in range(5):
            self.client.post(
                "/api/auth/change-password",
                json={
                    "username": "admin",
                    "current_password": "wrong-password",
                    "new_password": "newpass123",
                    "confirm_password": "newpass123",
                },
            )

        locked_response = self.client.post(
            "/api/auth/change-password",
            json={
                "username": "admin",
                "current_password": "admin123",
                "new_password": "newpass123",
                "confirm_password": "newpass123",
            },
        )

        self.assertEqual(locked_response.status_code, 423)
        self.assertEqual(
            locked_response.get_json()["error"],
            "该账号已被临时禁用 10 分钟，请稍后再试",
        )

    def test_api_login_locks_account_for_ten_minutes_after_five_failed_attempts(self) -> None:
        for _ in range(5):
            response = self.client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "wrong-password"},
            )

        self.assertEqual(response.status_code, 423)
        self.assertEqual(response.get_json()["error"], "该账号已被临时禁用 10 分钟，请稍后再试")

        blocked_response = self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        self.assertEqual(blocked_response.status_code, 423)
        self.assertEqual(blocked_response.get_json()["error"], "该账号已被临时禁用 10 分钟，请稍后再试")

    def test_api_login_permanently_disables_account_after_ten_failed_attempts(self) -> None:
        for _ in range(5):
            self.client.post("/api/auth/login", json={"username": "admin", "password": "wrong-password"})

        with patch("routes.api_auth.datetime") as mock_datetime:
            from datetime import datetime

            mock_datetime.utcnow.return_value = datetime.utcnow() + timedelta(minutes=11)
            for _ in range(5):
                response = self.client.post(
                    "/api/auth/login",
                    json={"username": "admin", "password": "wrong-password"},
                )

        self.assertEqual(response.status_code, 423)
        self.assertEqual(response.get_json()["error"], "该账号已被禁用，请联系管理员解锁")

    def test_api_login_success_clears_failed_attempts(self) -> None:
        for _ in range(4):
            response = self.client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "wrong-password"},
            )
            self.assertEqual(response.status_code, 401)

        success_response = self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        self.assertEqual(success_response.status_code, 200)

        failure_response = self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "wrong-password"},
        )
        self.assertEqual(failure_response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
