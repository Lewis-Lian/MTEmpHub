"""CSRF 防护专项测试。

验证 configure_csrf_protection 的拦截逻辑：写请求必须带与
FRONTEND_ORIGIN 匹配的 Origin 或 Referer，否则 403。
"""
import tempfile
import unittest

from flask import Flask

from models import db
import app  # noqa: F401 —— 触发全部模型注册到 metadata
from routes import register_routes


class CsrfProtectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/csrf.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_NAME="access_token",
        )
        db.init_app(self.app)
        register_routes(self.app)
        with self.app.app_context():
            db.create_all()
        self.client = self.app.test_client()

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_write_with_matching_origin_is_allowed(self) -> None:
        """带匹配 Origin 的写请求不被拦截（可能因业务逻辑返回 400/401，但非 403 CSRF）。"""
        response = self.client.post(
            "/api/auth/login",
            json={"username": "nobody", "password": "x"},
            headers={"Origin": "http://localhost:5173"},
        )
        self.assertNotEqual(response.status_code, 403)

    def test_write_with_matching_referer_is_allowed(self) -> None:
        """带匹配 Referer（含路径）的写请求不被拦截。"""
        response = self.client.post(
            "/api/auth/login",
            json={"username": "nobody", "password": "x"},
            headers={"Referer": "http://localhost:5173/login"},
        )
        self.assertNotEqual(response.status_code, 403)

    def test_write_without_origin_or_referer_is_blocked(self) -> None:
        """Origin/Referer 均缺失的写请求被 403 拦截。"""
        response = self.client.post("/api/auth/login", json={"username": "x", "password": "x"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "跨站请求校验失败")

    def test_write_with_mismatched_origin_is_blocked(self) -> None:
        """Origin 不匹配时被 403 拦截（模拟跨站攻击）。"""
        response = self.client.post(
            "/api/auth/login",
            json={"username": "x", "password": "x"},
            headers={"Origin": "http://evil.example.com"},
        )
        self.assertEqual(response.status_code, 403)

    def test_get_request_is_not_blocked_without_origin(self) -> None:
        """GET 请求不受 CSRF 校验约束，不带 Origin 也不拦截。"""
        response = self.client.get("/api/auth/me")
        self.assertNotEqual(response.status_code, 403)

    def test_non_api_path_is_not_blocked(self) -> None:
        """非 /api/ 前缀的路径不经过 CSRF 校验（返回 404 路由不存在，而非 403 CSRF 拦截）。"""
        response = self.client.post("/some-other-path", json={})
        self.assertNotEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
