import os
import tempfile
import unittest
from datetime import timedelta

from flask import Flask

from models import db
from models.account_set import AccountSet
from models.department import Department
from models.employee import Employee
from models.user import User
from routes import register_routes


class QueryFeedbackUITests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmpdir.name, "query_feedback.db")
        self.upload_dir = os.path.join(self.tmpdir.name, "uploads")
        project_root = os.path.dirname(os.path.dirname(__file__))

        app = Flask(
            "query_feedback_ui_test",
            template_folder=os.path.join(project_root, "templates"),
            static_folder=os.path.join(project_root, "static"),
        )
        app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.db_path}",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_HOURS=12,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            UPLOAD_FOLDER=self.upload_dir,
        )
        os.makedirs(self.upload_dir, exist_ok=True)

        db.init_app(app)
        register_routes(app)
        self.app = app

        with self.app.app_context():
            db.create_all()
            admin = User(username="admin", role="admin")
            admin.set_password("admin123")
            dept = Department(dept_no="D001", dept_name="行政部")
            db.session.add_all([admin, dept])
            db.session.flush()
            db.session.add_all([
                Employee(emp_no="E001", name="员工甲", dept_id=dept.id, is_manager=False),
                Employee(emp_no="M001", name="主管甲", dept_id=dept.id, is_manager=True),
                AccountSet(month="2026-05", name="2026-05", is_active=True, is_locked=False),
            ])
            db.session.commit()

        self.client = self.app.test_client()
        self.client.post(
            "/login",
            data={"username": "admin", "password": "admin123"},
            follow_redirects=False,
        )

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.tmpdir.cleanup()

    def test_query_pages_render_progress_overlay_markup(self) -> None:
        for path in [
            "/employee/dashboard",
            "/employee/punch-records",
            "/employee/abnormal-query",
            "/employee/department-hours-query",
            "/employee/manager-query",
            "/employee/manager-overtime-query",
            "/employee/manager-annual-leave-query",
            "/employee/manager-department-hours-query",
            "/admin/dashboard",
        ]:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            html = response.get_data(as_text=True)
            self.assertIn("query-progress-overlay", html, path)
            self.assertIn("query-progress-label", html, path)
            self.assertIn("query-progress-detail", html, path)

    def test_toast_script_defines_ten_second_pauseable_timer(self) -> None:
        script_path = os.path.join(self.app.static_folder, "js", "app_dialog.js")
        with open(script_path, "r", encoding="utf-8") as fh:
            script = fh.read()

        self.assertIn("const AUTO_HIDE_DELAY_MS = 10000;", script)
        self.assertIn('toastEl.addEventListener("mouseenter"', script)
        self.assertIn('toastEl.addEventListener("mouseleave"', script)
        self.assertIn("remainingMs", script)

    def test_account_set_script_uses_progress_overlay(self) -> None:
        script_path = os.path.join(self.app.static_folder, "js", "admin.js")
        with open(script_path, "r", encoding="utf-8") as fh:
            script = fh.read()

        self.assertIn("window.AppQueryProgress.with", script)

    def test_punch_record_download_script_passes_selected_headers(self) -> None:
        script_path = os.path.join(self.app.static_folder, "js", "punch_records.js")
        with open(script_path, "r", encoding="utf-8") as fh:
            script = fh.read()

        self.assertIn('query.set("punch_headers"', script)
        self.assertIn('document.getElementById("toggleRawPunch").checked', script)
        self.assertIn('document.getElementById("toggleInOutPunch").checked', script)

    def test_annual_leave_and_overtime_save_show_success_feedback(self) -> None:
        for filename, expected in [
            ("manager_annual_leave.js", 'window.AppToast.success("年休修正已保存", "保存成功")'),
            ("manager_overtime.js", 'window.AppToast.success("加班修正已保存", "保存成功")'),
        ]:
            script_path = os.path.join(self.app.static_folder, "js", filename)
            with open(script_path, "r", encoding="utf-8") as fh:
                script = fh.read()

            self.assertIn(expected, script, filename)


if __name__ == "__main__":
    unittest.main()
