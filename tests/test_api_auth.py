import tempfile
import unittest
from datetime import timedelta

from flask import Flask

from models import db
from models.user import User
from routes import register_routes


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
        self.client = self.app.test_client()

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_api_login_sets_configured_cookie_and_cors_headers(self) -> None:
        response = self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "admin123"},
            headers={"Origin": "http://localhost:5173"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173")
        self.assertEqual(response.headers.get("Access-Control-Allow-Credentials"), "true")
        cookie_name = response.headers.get("Set-Cookie", "").split("=", 1)[0]
        self.assertEqual(cookie_name, "api_access_token")

    def test_api_me_requires_cookie_auth(self) -> None:
        response = self.client.get("/api/auth/me")

        self.assertEqual(response.status_code, 401)

    def test_api_me_returns_current_user_with_configured_cookie(self) -> None:
        login_response = self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "admin123"},
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
            json={"username": "admin", "password": "admin123"},
            headers={"Origin": "http://localhost:5173"},
        )

        response = self.client.post("/api/auth/logout", headers={"Origin": "http://localhost:5173"})

        self.assertEqual(response.status_code, 200)
        self.assertIn("api_access_token=;", response.headers.get("Set-Cookie", ""))


if __name__ == "__main__":
    unittest.main()
