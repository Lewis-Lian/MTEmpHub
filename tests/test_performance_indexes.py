"""性能复合索引存在性验证。

覆盖：模型 create_all 后应生成三个面向高频查询模式的复合索引：
- leave_records(emp_id, start_time)：emp_id.in_() + 时间范围过滤的假期查询
- overtime_records(emp_id, start_time)：同模式的加班查询
- attendance_override_history(override_type, month, created_at)：修正历史按类型+月份过滤并按时间倒序
"""

from __future__ import annotations

import os
import tempfile
import unittest

from flask import Flask

from models import db
import app  # noqa: F401 —— 触发全部模型注册到 metadata，使 db.create_all() 建全表


class PerformanceIndexTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmpdir.name, "test.db")
        self.flask_app = Flask(__name__)
        self.flask_app.config.update(
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.db_path}",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
        )
        db.init_app(self.flask_app)
        with self.flask_app.app_context():
            db.create_all()

    def tearDown(self) -> None:
        self.tmpdir.cleanup()

    def _index_names(self) -> set[str]:
        rows = db.session.execute(db.text("SELECT name FROM sqlite_master WHERE type='index'")).fetchall()
        return {row[0] for row in rows}

    def test_performance_composite_indexes_exist(self) -> None:
        with self.flask_app.app_context():
            names = self._index_names()
        self.assertIn("ix_leave_records_emp_id_start_time", names)
        self.assertIn("ix_overtime_records_emp_id_start_time", names)
        self.assertIn("ix_attendance_override_history_type_month_created", names)


if __name__ == "__main__":
    unittest.main()
