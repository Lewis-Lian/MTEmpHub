"""守护管理人员月报/日报导入的批量预查路径。

历史 bug(commit 55d0733 引入):`_import_manager_monthly_report` 和
`_import_manager_daily_records` 构造 `resolved_emp_ids` 时漏取 `.id`,
直接把 Employee 对象塞进集合:

    resolved_emp_ids = set(emp_by_no.values()) | set(emp_by_name.values())

随后 `MonthlyReport.emp_id.in_(resolved_emp_ids)` / `DailyRecord.emp_id.in_(...)`
把 Employee 对象当作 SQL 字面量,SQLAlchemy 抛:
    ArgumentError: Object <Employee N> is not legal as a SQL literal value

该异常被 `calculate_account_set` 兜底成「导入失败,请查看服务端日志」,
表现即用户点「管理人员计算」时管理人员月报/日报两个文件导入失败。
员工版导入写法正确(取了 `.id`),故只有管理人员计算受影响。

本测试用真实 Employee 对象触发该路径,确保 Employee.id(而非对象本身)
流入 `.in_()` 查询。
"""

import os
import tempfile
import unittest
from datetime import timedelta
from io import BytesIO

import openpyxl
from flask import Flask

from models import db
from models.department import Department
from models.employee import Employee
from models.monthly_report import MonthlyReport
from models.shift import Shift
from models.user import User
from routes import register_routes
from services.import_service import ImportService


def _write_xlsx(path: str, rows: list[list]) -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    wb.save(path)


class ManagerImportBulkLookupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/manager-import.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN="http://localhost:5173",
            SESSION_COOKIE_NAME="access_token",
            SESSION_COOKIE_SAMESITE="Lax",
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
            # is_manager=True 才会被 _can_receive_manager_source 接收
            db.session.add(
                Employee(
                    emp_no="M001",
                    name="经理甲",
                    dept_id=dept.id,
                    is_manager=True,
                )
            )
            db.session.commit()

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_manager_monthly_report_import_uses_emp_ids_not_objects(self) -> None:
        """管理人员月报导入:resolved_emp_ids 必须是 id 集合,不能含 Employee 对象。"""
        # 文件名需含「管理人员」+「月报」+「年X月」以命中 manager_monthly 分类与月份提取
        path = os.path.join(self.tmpdir.name, "2026年6月管理人员基础数据（月报）.xlsx")
        _write_xlsx(
            path,
            [
                ["部门", "姓名", "工号"],
                ["", "", ""],
                ["行政部", "经理甲", "M001"],
            ],
        )

        with self.app.app_context():
            result = ImportService.import_file(path)

        self.assertEqual(result["status"], "ok", result)
        self.assertEqual(result["file_type"], "manager_monthly")
        self.assertEqual(result["imported"], 1, result)

        with self.app.app_context():
            reports = MonthlyReport.query.filter_by(report_month="2026-06").all()
            self.assertEqual(len(reports), 1)
            self.assertEqual(reports[0].manager_raw_data["姓名"], "经理甲")

    def test_manager_daily_records_import_uses_emp_ids_not_objects(self) -> None:
        """管理人员日报导入:resolved_emp_ids 必须是 id 集合,不能含 Employee 对象。"""
        path = os.path.join(self.tmpdir.name, "2026年6月管理人员基础数据.xlsx")
        _write_xlsx(
            path,
            [
                ["部门", "姓名", "工号", "日期"],
                ["", "", "", ""],
                ["行政部", "经理甲", "M001", "2026-06-15"],
            ],
        )

        with self.app.app_context():
            result = ImportService.import_file(path)

        self.assertEqual(result["status"], "ok", result)
        self.assertEqual(result["file_type"], "manager_daily")
        self.assertEqual(result["imported"], 1, result)


if __name__ == "__main__":
    unittest.main()
