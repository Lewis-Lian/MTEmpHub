"""一次性迁移脚本：将 SQLite 数据库的数据迁移到 MySQL

使用方法：
    1. 确保 MySQL 已创建目标数据库（utf8mb4 字符集）
    2. 修改下方 SQLITE_URL 和 MYSQL_URL
    3. python scripts/migrate_sqlite_to_mysql.py
"""

import os
import sys

# 将项目根目录加入 path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from flask import Flask
from flask_sqlalchemy import SQLAlchemy

# ============================================================
# 配置：修改这两行为实际连接信息
# ============================================================
SQLITE_URL = "sqlite:///instance/attendance.db"
MYSQL_URL = "mysql+pymysql://root:@localhost:3306/attendance_db?charset=utf8mb4"

# 按外键依赖排序的迁移顺序（父表在前，子表在后）
MIGRATION_ORDER = [
    "departments",
    "users",
    "shifts",
    "employees",
    "user_employee_assignments",
    "user_department_assignments",
    "employee_shift_assignments",
    "account_sets",
    "account_set_imports",
    "account_set_factory_rest_days",
    "daily_records",
    "monthly_reports",
    "overtime_records",
    "leave_records",
    "annual_leave",
    "manager_month_stats",
    "manager_attendance_overrides",
    "employee_attendance_overrides",
    "attendance_override_histories",
]

BATCH_SIZE = 500


def _create_app_with_uri(uri: str) -> Flask:
    """用指定数据库 URI 创建 Flask app"""
    from flask_migrate import Migrate

    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    if uri.startswith("mysql"):
        app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
            "pool_pre_ping": True,
            "pool_recycle": 3600,
        }

    from models import db as _db

    _db.init_app(app)
    Migrate(app, _db)
    return app


def migrate():
    from models import db

    # ---- 第一步：从 SQLite 读取所有数据 ----
    print("=" * 60)
    print("第一步：从 SQLite 读取数据")
    print("=" * 60)

    app_sqlite = _create_app_with_uri(SQLITE_URL)
    with app_sqlite.app_context():
        from models import db as sqlite_db

        data_by_table: dict[str, list[dict]] = {}
        for table_name in MIGRATION_ORDER:
            rows = sqlite_db.session.execute(text(f"SELECT * FROM {table_name}")).mappings().all()
            data_by_table[table_name] = [dict(row) for row in rows]
            print(f"  {table_name}: {len(rows)} 行")

    # ---- 第二步：写入 MySQL ----
    print()
    print("=" * 60)
    print("第二步：写入 MySQL")
    print("=" * 60)

    app_mysql = _create_app_with_uri(MYSQL_URL)
    with app_mysql.app_context():
        from models import db as mysql_db
        from flask_migrate import upgrade

        # 用 migration 建表
        print("  正在创建表结构...")
        upgrade()

        # 按顺序插入数据
        total_tables = len(MIGRATION_ORDER)
        for idx, table_name in enumerate(MIGRATION_ORDER, 1):
            rows = data_by_table[table_name]
            if not rows:
                print(f"  [{idx}/{total_tables}] {table_name}: 跳过（无数据）")
                continue

            columns = list(rows[0].keys())
            col_names = ", ".join(columns)
            placeholders = ", ".join([f":{c}" for c in columns])
            insert_sql = text(f"INSERT INTO {table_name} ({col_names}) VALUES ({placeholders})")

            for i in range(0, len(rows), BATCH_SIZE):
                batch = rows[i : i + BATCH_SIZE]
                mysql_db.session.execute(insert_sql, batch)
            mysql_db.session.commit()
            print(f"  [{idx}/{total_tables}] {table_name}: {len(rows)} 行已写入")

        # 重置 AUTO_INCREMENT
        print()
        print("  重置 AUTO_INCREMENT...")
        for table_name in MIGRATION_ORDER:
            rows = data_by_table[table_name]
            if rows and "id" in rows[0]:
                mysql_db.session.execute(
                    text(
                        f"ALTER TABLE {table_name} AUTO_INCREMENT = "
                        f"(SELECT COALESCE(MAX(id), 0) + 1 FROM {table_name})"
                    )
                )
        mysql_db.session.commit()

    print()
    print("=" * 60)
    print("迁移完成！")
    print("=" * 60)


if __name__ == "__main__":
    migrate()
