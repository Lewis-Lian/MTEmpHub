"""守护账套原始文件上传：中文文件名必须保留，且能被正确分类。

历史 bug：`routes/admin_imports.py` 曾用 werkzeug 的 `secure_filename` 生成落盘文件名，
它会删除所有非 ASCII 字符（含全部中文），导致：
1. 不同文件被归并成同名（如「员工月报」「员工日报」「管理人员日报」全部变成 `2026_6.xlsx`），
   `file.save()` 后者覆盖前者，账套实际可用文件数 < 上传数；
2. `_account_set_file_type` 靠中文关键字（加班/请假/管理人员/月报）判型，文件名丢中文后
   全部回退成 `daily`，员工/管理人员计算因此缺类型、算出 0 人。

本测试直接断言修复后的落盘命名行为：保留中文 + 不互相覆盖 + 分类正确。
"""

import os
import tempfile
import unittest
from datetime import timedelta
from io import BytesIO

import openpyxl
from flask import Flask

from models import db
from models.account_set import AccountSet
from models.department import Department
from models.employee import Employee
from models.shift import Shift
from models.user import User
from routes import register_routes
from routes.auth_helpers import issue_slider_verified_token
from routes.admin_core import _account_set_file_type
from tests.csrf_helper import attach_origin


class AccountSetUploadNamingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/account-set.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_NAME="account_set_access_token",
            SESSION_COOKIE_SAMESITE="None",
            SESSION_COOKIE_SECURE=False,
            UPLOAD_FOLDER=os.path.join(self.tmpdir.name, "uploads"),
        )
        os.makedirs(self.app.config["UPLOAD_FOLDER"], exist_ok=True)
        db.init_app(self.app)
        register_routes(self.app)

        with self.app.app_context():
            db.create_all()
            admin = User(username="admin", role="admin")
            admin.set_password("admin123")
            dept = Department(dept_no="D001", dept_name="行政部")
            shift = Shift(
                shift_no="S001",
                shift_name="白班",
                time_slots=[{"start": "08:00", "end": "17:00"}],
                is_cross_day=False,
            )
            db.session.add_all([admin, dept, shift])
            db.session.flush()
            db.session.add(Employee(emp_no="E001", name="员工甲", dept_id=dept.id, is_manager=False))
            db.session.add(AccountSet(month="2026-06", name="2026-06", is_active=True, is_locked=False))
            db.session.commit()

        self.client = attach_origin(self.app.test_client())

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def _login(self) -> None:
        with self.app.app_context():
            captcha_token = issue_slider_verified_token()
        self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "admin123", "captcha_token": captcha_token},
        )

    @staticmethod
    def _xlsx_file(filename: str) -> BytesIO:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["占位"])
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        output.name = filename
        return output

    def test_chinese_filenames_are_preserved_and_not_collapsed(self) -> None:
        """上传多个含中文的文件名：落盘文件名必须保留中文，且彼此不归并覆盖。"""
        self._login()
        # 这些文件名经历史 bug 的 secure_filename 处理后会全部退化成同名残缺名
        filenames = [
            "2026_6月员工基础数据.xlsx",
            "2026_6月员工基础数据（月报）.xlsx",
            "2026年_6月管理人员基础数据.xlsx",
            "2026年_6月管理人员基础数据（月报）.xlsx",
            "庆元 - 加班单 (17).xlsx",
            "庆元 - 请假单查询 (51).xlsx",
        ]
        resp = self.client.post(
            "/api/admin/import/raw-files",
            data={"account_set_id": 1, "files": [self._xlsx_file(n) for n in filenames]},
            content_type="multipart/form-data",
        )
        self.assertEqual(resp.status_code, 200, resp.get_data(as_text=True))
        body = resp.get_json()
        # 六个文件应全部上传成功，没有一个因同名被另一个覆盖
        self.assertEqual(body["total"], 6)
        self.assertEqual(body["failed"], 0, body)

        upload_dir = os.path.join(self.app.config["UPLOAD_FOLDER"], "account_sets", "2026-06")
        saved_names = sorted(os.listdir(upload_dir))
        # 落盘文件数 == 上传数（没有被同名覆盖）
        self.assertEqual(len(saved_names), 6, f"落盘文件被覆盖，实际: {saved_names}")
        # 中文必须保留在落盘名里（关键字「月」「加班」「请假」「管理人员」）
        joined = "".join(saved_names)
        for keyword in ["月", "加班", "请假", "管理人员"]:
            self.assertIn(keyword, joined, f"落盘文件名丢失中文 {keyword}：{saved_names}")

    def test_uploaded_filenames_classify_into_distinct_types(self) -> None:
        """落盘文件名经 _account_set_file_type 必须分出 6 种不同类型，覆盖员工/管理人员全部计算所需。"""
        self._login()
        filenames = [
            "2026_6月员工基础数据.xlsx",
            "2026_6月员工基础数据（月报）.xlsx",
            "2026年_6月管理人员基础数据.xlsx",
            "2026年_6月管理人员基础数据（月报）.xlsx",
            "庆元 - 加班单 (17).xlsx",
            "庆元 - 请假单查询 (51).xlsx",
        ]
        resp = self.client.post(
            "/api/admin/import/raw-files",
            data={"account_set_id": 1, "files": [self._xlsx_file(n) for n in filenames]},
            content_type="multipart/form-data",
        )
        self.assertEqual(resp.status_code, 200, resp.get_data(as_text=True))

        # 6 个原始文件名应分别映射到 6 种 file_type（历史 bug 下会被全部压成 daily）
        expected = {
            "2026_6月员工基础数据.xlsx": "daily",
            "2026_6月员工基础数据（月报）.xlsx": "monthly",
            "2026年_6月管理人员基础数据.xlsx": "manager_daily",
            "2026年_6月管理人员基础数据（月报）.xlsx": "manager_monthly",
            "庆元 - 加班单 (17).xlsx": "overtime",
            "庆元 - 请假单查询 (51).xlsx": "leave",
        }
        for original, want in expected.items():
            self.assertEqual(
                _account_set_file_type(original),
                want,
                f"文件名 {original!r} 分类错误：期望 {want}",
            )


if __name__ == "__main__":
    unittest.main()
