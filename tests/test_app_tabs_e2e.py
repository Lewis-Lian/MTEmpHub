import os
import tempfile
import threading
import time
import unittest

from flask import Flask
from werkzeug.serving import make_server

from models import db
from models.account_set import AccountSet
from models.department import Department
from models.employee import Employee
from models.user import User
from routes import register_routes

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - dependency is installed in test env
    sync_playwright = None


class _ServerThread(threading.Thread):
    def __init__(self, app: Flask) -> None:
        super().__init__(daemon=True)
        self.server = make_server("127.0.0.1", 0, app)
        self.port = self.server.server_port
        self.ctx = app.app_context()
        self.ctx.push()

    def run(self) -> None:
        self.server.serve_forever()

    def stop(self) -> None:
        self.server.shutdown()
        self.ctx.pop()


@unittest.skipIf(sync_playwright is None, "playwright 未安装")
class AppTabsE2ETests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmpdir.name, "tabs.db")
        self.upload_dir = os.path.join(self.tmpdir.name, "uploads")
        project_root = os.path.dirname(os.path.dirname(__file__))

        app = Flask(
            "app_tabs_e2e_test",
            template_folder=os.path.join(project_root, "templates"),
            static_folder=os.path.join(project_root, "static"),
        )
        app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.db_path}",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_HOURS=12,
            JWT_EXPIRES_DELTA=__import__("datetime").timedelta(hours=12),
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
                Employee(emp_no="E002", name="员工乙", dept_id=dept.id, is_manager=False),
                AccountSet(month="2026-05", name="2026-05", is_active=True, is_locked=False),
            ])
            db.session.commit()

        self.server = _ServerThread(self.app)
        self.server.start()
        self.base_url = f"http://127.0.0.1:{self.server.port}"
        time.sleep(0.2)

    def tearDown(self) -> None:
        self.server.stop()
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.tmpdir.cleanup()

    def login_and_open_dashboard(self, page) -> None:
        page.goto(f"{self.base_url}/login", wait_until="networkidle")
        page.fill('input[name="username"]', "admin")
        page.fill('input[name="password"]', "admin123")
        page.eval_on_selector('input[name="slider_verified"]', "el => { el.value = '1'; }")
        page.click('button[type="submit"]')
        page.wait_for_url(f"{self.base_url}/employee/home")
        page.goto(f"{self.base_url}/employee/dashboard", wait_until="networkidle")
        page.wait_for_selector("#appTabBar")
        page.wait_for_function("""
          () => {
            const select = document.getElementById('accountSetSelect');
            return Boolean(select && select.options.length > 0);
          }
        """)

    def test_dashboard_state_survives_tab_switch(self) -> None:
        with sync_playwright() as p:
          browser = p.chromium.launch()
          page = browser.new_page()
          self.login_and_open_dashboard(page)

          page.click("#refreshBtn")
          page.wait_for_function("""
            () => {
              const text = document.getElementById('finalDataMeta')?.textContent || '';
              return text.includes('无数据') || text.includes('记录');
            }
          """)
          meta_before = page.text_content("#finalDataMeta").strip()

          page.click('a.app-side-link[href="/employee/summary-download"]')
          page.wait_for_function("() => document.querySelectorAll('.app-tab-button').length === 2")
          page.click('.app-tab-button[title="员工考勤数据查询"]')
          page.wait_for_selector("#refreshBtn")

          self.assertEqual(page.text_content("#finalDataMeta").strip(), meta_before)
          browser.close()

    def test_reopening_same_page_does_not_duplicate_tab(self) -> None:
        with sync_playwright() as p:
          browser = p.chromium.launch()
          page = browser.new_page()
          self.login_and_open_dashboard(page)

          page.click('a.app-side-link[href="/employee/summary-download"]')
          page.wait_for_function("() => document.querySelectorAll('.app-tab-button').length === 2")
          page.click('a.app-side-link[href="/employee/summary-download"]')
          page.wait_for_timeout(200)

          self.assertEqual(page.locator(".app-tab-button").count(), 2)
          browser.close()

    def test_returning_to_home_does_not_open_duplicate_home_tab(self) -> None:
        with sync_playwright() as p:
          browser = p.chromium.launch()
          page = browser.new_page()
          self.login_and_open_dashboard(page)

          page.click('a.app-side-link[href="/employee/summary-download"]')
          page.wait_for_function("() => document.querySelectorAll('.app-tab-button').length === 2")
          page.locator('a[href="/employee/home"]').first.click()
          page.wait_for_timeout(300)

          self.assertEqual(page.locator(".app-tab-button").count(), 2)
          self.assertEqual(page.locator('.app-tab-button[title="首页"]').count(), 1)
          self.assertEqual(page.locator(".app-tab-button.is-active").get_attribute("title"), "首页")
          browser.close()

    def test_employee_manage_page_renders_edit_button(self) -> None:
        with sync_playwright() as p:
          browser = p.chromium.launch()
          page = browser.new_page()
          self.login_and_open_dashboard(page)

          page.goto(f"{self.base_url}/admin/employees/manage", wait_until="networkidle")
          page.wait_for_selector("#employeeTableBody tr")

          self.assertGreaterEqual(page.locator(".edit-single-btn").count(), 1)
          self.assertGreaterEqual(page.locator(".delete-single-btn").count(), 1)
          browser.close()

    def test_refresh_restores_open_tabs_and_active_tab(self) -> None:
        with sync_playwright() as p:
          browser = p.chromium.launch()
          page = browser.new_page()
          self.login_and_open_dashboard(page)

          page.click('a.app-side-link[href="/employee/summary-download"]')
          page.wait_for_function("() => document.querySelector('.app-tab-button.is-active')?.title === '汇总下载'")
          page.reload(wait_until="networkidle")
          page.wait_for_function("() => document.querySelectorAll('.app-tab-button').length === 2")

          self.assertEqual(page.locator(".app-tab-button.is-active").get_attribute("title"), "汇总下载")
          browser.close()

    def test_closing_active_tab_returns_to_neighbor(self) -> None:
        with sync_playwright() as p:
          browser = p.chromium.launch()
          page = browser.new_page()
          self.login_and_open_dashboard(page)

          page.click('a.app-side-link[href="/employee/summary-download"]')
          page.wait_for_function("() => document.querySelector('.app-tab-button.is-active')?.title === '汇总下载'")
          page.click('.app-tab-button.is-active .app-tab-close')
          page.wait_for_function("() => document.querySelectorAll('.app-tab-button').length === 1")

          self.assertEqual(page.locator(".app-tab-button.is-active").get_attribute("title"), "员工考勤数据查询")
          browser.close()

    def test_query_result_panel_shows_progress_overlay_during_request(self) -> None:
        with sync_playwright() as p:
          browser = p.chromium.launch()
          page = browser.new_page()
          self.login_and_open_dashboard(page)

          def delayed_final_data(route):
              time.sleep(0.6)
              route.fulfill(
                  status=200,
                  content_type="application/json",
                  body='{"headers":["姓名"],"rows":[["员工甲"]]}',
              )

          page.route("**/employee/api/final-data?*", delayed_final_data)
          page.click("#refreshBtn")
          page.wait_for_selector(".query-progress-overlay.is-visible")

          self.assertIn("查询中", page.locator(".query-progress-label").text_content())
          self.assertIn("正在加载结果", page.locator(".query-progress-detail").text_content())

          page.wait_for_function("""
            () => !document.querySelector('.query-progress-overlay.is-visible')
          """)
          self.assertEqual(page.text_content("#finalDataMeta").strip(), "共返回 1 条记录")
          browser.close()

    def test_toast_auto_hide_pauses_on_hover_and_resumes_after_leave(self) -> None:
        with sync_playwright() as p:
          browser = p.chromium.launch()
          page = browser.new_page()
          self.login_and_open_dashboard(page)

          page.evaluate("""
            () => {
              let now = 0;
              let nextId = 1;
              const tasks = new Map();
              const originalSetTimeout = window.setTimeout.bind(window);
              const originalClearTimeout = window.clearTimeout.bind(window);

              window.__toastClock = {
                advance(ms) {
                  now += ms;
                  const ready = Array.from(tasks.entries())
                    .filter(([, task]) => task.runAt <= now)
                    .sort((a, b) => a[1].runAt - b[1].runAt);
                  ready.forEach(([id, task]) => {
                    tasks.delete(id);
                    task.fn();
                  });
                },
                restore() {
                  window.setTimeout = originalSetTimeout;
                  window.clearTimeout = originalClearTimeout;
                },
              };

              window.setTimeout = (fn, delay = 0, ...args) => {
                const id = nextId++;
                tasks.set(id, { fn: () => fn(...args), runAt: now + Number(delay || 0) });
                return id;
              };
              window.clearTimeout = (id) => {
                tasks.delete(id);
              };

              bootstrap.Toast.Default.animation = false;
            }
          """)

          page.evaluate("""() => window.AppToast.success("测试消息", "测试标题")""")
          page.wait_for_selector(".app-toast")

          page.evaluate("""() => window.__toastClock.advance(9000)""")
          self.assertEqual(page.locator(".app-toast").count(), 1)

          page.dispatch_event(".app-toast", "mouseenter")
          page.evaluate("""() => window.__toastClock.advance(5000)""")
          self.assertEqual(page.locator(".app-toast").count(), 1)

          page.dispatch_event(".app-toast", "mouseleave")
          page.evaluate("""() => window.__toastClock.advance(900)""")
          self.assertEqual(page.locator(".app-toast").count(), 1)

          page.evaluate("""() => window.__toastClock.advance(200)""")
          page.wait_for_function("() => document.querySelectorAll('.app-toast').length === 0")
          page.evaluate("""() => window.__toastClock.restore()""")
          browser.close()
