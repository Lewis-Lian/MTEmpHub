"""SQLite 到 MySQL 的数据迁移服务。"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.exc import NoSuchTableError, OperationalError

logger = logging.getLogger(__name__)

# 按外键依赖排序（父表在前，子表在后）
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



def migrate_sqlite_to_mysql(sqlite_url: str, mysql_url: str) -> list[dict]:
    """执行 SQLite → MySQL 数据迁移，返回每张表的迁移结果。"""
    from flask import Flask
    from flask_sqlalchemy import SQLAlchemy
    from flask_migrate import Migrate

    results: list[dict] = []

    # ---- 第一步：从 SQLite 读取所有数据 ----
    read_db = SQLAlchemy()
    app_read = Flask(__name__)
    app_read.config["SQLALCHEMY_DATABASE_URI"] = sqlite_url
    app_read.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    read_db.init_app(app_read)

    data_by_table: dict[str, list[dict]] = {}
    with app_read.app_context():
        for table_name in MIGRATION_ORDER:
            try:
                rows = read_db.session.execute(text(f"SELECT * FROM {table_name}")).mappings().all()
                data_by_table[table_name] = [dict(row) for row in rows]
            except (NoSuchTableError, OperationalError):
                data_by_table[table_name] = []

    # ---- 第二步：写入 MySQL ----
    write_db = SQLAlchemy()
    app_write = Flask(__name__)
    app_write.config["SQLALCHEMY_DATABASE_URI"] = mysql_url
    app_write.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app_write.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "pool_pre_ping": True,
        "pool_recycle": 3600,
    }
    write_db.init_app(app_write)
    Migrate(app_write, write_db)

    with app_write.app_context():
        # 用 SQLAlchemy 建表，因为现存的 migration 历史可能不完整
        from models import db as main_db
        main_db.metadata.create_all(bind=write_db.engine)
        
        from flask_migrate import stamp
        try:
            stamp()
        except Exception as exc:
            logger.warning("迁移 stamp 失败（不影响本次数据写入）: %s", exc)

        for table_name in MIGRATION_ORDER:
            rows = data_by_table[table_name]
            if not rows:
                results.append({"table": table_name, "rows": 0, "status": "skipped"})
                continue

            columns = list(rows[0].keys())
            col_names = ", ".join(columns)
            placeholders = ", ".join([f":{c}" for c in columns])
            insert_sql = text(f"INSERT INTO {table_name} ({col_names}) VALUES ({placeholders})")

            for i in range(0, len(rows), BATCH_SIZE):
                batch = rows[i : i + BATCH_SIZE]
                write_db.session.execute(insert_sql, batch)
            write_db.session.commit()
            results.append({"table": table_name, "rows": len(rows), "status": "ok"})

        # 重置 AUTO_INCREMENT
        for table_name in MIGRATION_ORDER:
            rows = data_by_table[table_name]
            if rows and "id" in rows[0]:
                max_id_row = write_db.session.execute(text(f"SELECT COALESCE(MAX(id), 0) FROM {table_name}")).fetchone()
                next_id = (max_id_row[0] if max_id_row else 0) + 1
                write_db.session.execute(text(f"ALTER TABLE {table_name} AUTO_INCREMENT = {next_id}"))
        write_db.session.commit()

    return results


def test_mysql_connection(mysql_url: str) -> dict:
    """测试 MySQL 连接是否可用。"""
    from flask import Flask
    from flask_sqlalchemy import SQLAlchemy

    test_db = SQLAlchemy()
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = mysql_url
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "pool_pre_ping": True,
        "connect_args": {"connect_timeout": 10}
    }

    test_db.init_app(app)

    try:
        with app.app_context():
            test_db.session.execute(text("SELECT 1"))
        return {"ok": True, "message": "连接成功"}
    except Exception as e:
        return {"ok": False, "message": str(e)}


def migrate_mysql_to_sqlite(mysql_url: str, sqlite_url: str) -> list[dict]:
    """执行 MySQL → SQLite 数据迁移，返回每张表的迁移结果。"""
    from flask import Flask
    from flask_sqlalchemy import SQLAlchemy

    results: list[dict] = []

    # ---- 第一步：从 MySQL 读取所有数据 ----
    read_db = SQLAlchemy()
    app_read = Flask(__name__)
    app_read.config["SQLALCHEMY_DATABASE_URI"] = mysql_url
    app_read.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app_read.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "pool_pre_ping": True,
        "pool_recycle": 3600,
    }
    read_db.init_app(app_read)

    data_by_table: dict[str, list[dict]] = {}
    with app_read.app_context():
        for table_name in MIGRATION_ORDER:
            try:
                rows = read_db.session.execute(text(f"SELECT * FROM {table_name}")).mappings().all()
                data_by_table[table_name] = [dict(row) for row in rows]
            except (NoSuchTableError, OperationalError):
                data_by_table[table_name] = []

    # ---- 第二步：写入 SQLite ----
    write_db = SQLAlchemy()
    app_write = Flask(__name__)
    app_write.config["SQLALCHEMY_DATABASE_URI"] = sqlite_url
    app_write.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    write_db.init_app(app_write)

    with app_write.app_context():
        # 用 SQLAlchemy 建表（已存在的表跳过），清空旧数据用 DELETE（可回滚）
        # 而非 drop_all（DDL 不可回滚，插入失败会导致目标库被清空）
        from models import db as main_db
        main_db.metadata.create_all(bind=write_db.engine)

        from flask_migrate import stamp
        try:
            stamp()
        except Exception as exc:
            logger.warning("迁移 stamp 失败（不影响本次数据写入）: %s", exc)

        # 先清空目标表数据（DELETE 可在事务中回滚）
        for table_name in MIGRATION_ORDER:
            write_db.session.execute(text(f"DELETE FROM {table_name}"))

        # 单事务写入所有表，全部成功才 commit，任何失败则整体回滚
        for table_name in MIGRATION_ORDER:
            rows = data_by_table.get(table_name, [])
            if not rows:
                results.append({"table": table_name, "rows": 0, "status": "skipped"})
                continue

            columns = list(rows[0].keys())
            col_names = ", ".join(columns)
            placeholders = ", ".join([f":{c}" for c in columns])
            insert_sql = text(f"INSERT INTO {table_name} ({col_names}) VALUES ({placeholders})")

            for i in range(0, len(rows), BATCH_SIZE):
                batch = rows[i : i + BATCH_SIZE]
                write_db.session.execute(insert_sql, batch)
            results.append({"table": table_name, "rows": len(rows), "status": "ok"})

        write_db.session.commit()

    return results

