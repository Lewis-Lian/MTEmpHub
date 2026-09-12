import os
import tempfile
import unittest
from datetime import timedelta

from flask import Flask

from models import db
from models.user import User
from models.employee import Employee
from models.user import UserEmployeeAssignment
from routes import register_routes
from routes.auth_helpers import issue_slider_verified_token
from tests.csrf_helper import attach_origin


class MessagesApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{os.path.join(self.tmpdir.name, 'test.db')}",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
        )
        db.init_app(self.app)
        register_routes(self.app)
        with self.app.app_context():
            db.create_all()
            admin = User(username="admin", role="admin")
            admin.set_password("admin123")
            recipient = User(username="recipient", role="readonly", profile_name="收件人")
            recipient.set_password("pass123")
            employee = Employee(emp_no="E1001", name="收件人", is_manager=False)
            db.session.add_all([admin, recipient, employee])
            db.session.flush()
            db.session.add(UserEmployeeAssignment(user_id=recipient.id, emp_id=employee.id))
            db.session.commit()
            self.admin_id = admin.id
            self.recipient_id = recipient.id
        self.client = attach_origin(self.app.test_client())

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.tmpdir.cleanup()

    def _login(self, username: str, password: str) -> None:
        with self.app.app_context():
            captcha_token = issue_slider_verified_token()
        response = self.client.post(
            "/api/auth/login",
            json={"username": username, "password": password, "captcha_token": captcha_token},
        )
        self.assertEqual(response.status_code, 200)

    def test_admin_can_send_message_to_any_account_and_recipient_can_read_it(self):
        self._login("admin", "admin123")
        response = self.client.post(
            "/api/admin/messages",
            json={"recipient_id": self.recipient_id, "title": "系统通知", "content": "请查收"},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()["message"]["unread"], True)

        self.client.post("/api/auth/logout")
        self._login("recipient", "pass123")
        response = self.client.get("/api/query/messages")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["unread_count"], 1)
        self.assertEqual(payload["messages"][0]["title"], "系统通知")

    def test_non_admin_cannot_send_message(self):
        self._login("recipient", "pass123")
        response = self.client.post(
            "/api/admin/messages",
            json={"recipient_id": self.admin_id, "title": "越权", "content": "不应发送"},
        )
        self.assertEqual(response.status_code, 403)

    def test_recipient_can_mark_message_read(self):
        self._login("admin", "admin123")
        created = self.client.post(
            "/api/admin/messages",
            json={"recipient_id": self.recipient_id, "title": "标题", "content": "内容"},
        ).get_json()["message"]
        self.client.post("/api/auth/logout")
        self._login("recipient", "pass123")
        response = self.client.post(f"/api/query/messages/{created['id']}/read")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["message"]["unread"], False)

    def test_admin_message_recipients_only_include_accounts_bound_to_employees(self):
        self._login("admin", "admin123")
        response = self.client.get("/api/admin/message-recipients")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()[0]["account_ids"], [self.recipient_id])
        self.assertEqual(response.get_json()[0]["emp_no"], "E1001")

    def test_admin_can_send_one_message_to_multiple_accounts(self):
        self._login("admin", "admin123")
        response = self.client.post(
            "/api/admin/messages",
            json={"recipient_ids": [self.recipient_id], "title": "批量", "content": "内容"},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()["created_count"], 1)

    def test_message_recipients_are_unique_by_employee(self):
        self._login("admin", "admin123")
        with self.app.app_context():
            second = User(username="recipient2", role="readonly")
            second.set_password("pass123")
            db.session.add(second)
            db.session.flush()
            db.session.add(UserEmployeeAssignment(user_id=second.id, emp_id=1))
            db.session.commit()
        response = self.client.get("/api/admin/message-recipients")
        rows = response.get_json()
        self.assertEqual(len([row for row in rows if row["emp_no"] == "E1001"]), 1)
        self.assertEqual(len(rows[0]["account_ids"]), 2)


if __name__ == "__main__":
    unittest.main()
