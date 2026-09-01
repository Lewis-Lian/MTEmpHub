from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.exc import NoSuchTableError, OperationalError
from sqlalchemy.engine.reflection import Inspector

from models import db
from models.user import User


def initialize_database() -> None:
    from flask_migrate import upgrade
    upgrade()
    ensure_schema_compatibility()


def ensure_default_admin() -> None:
    from flask import current_app

    admin = User.query.filter_by(username="admin").first()
    if admin is None:
        password = current_app.config.get("INITIAL_ADMIN_PASSWORD")
        if not password:
            raise RuntimeError(
                "未配置初始管理员密码，请在 .env 中设置 INITIAL_ADMIN_PASSWORD 后再执行 init-admin"
            )
        admin = User(username="admin", role="admin")
        admin.set_password(password)
        db.session.add(admin)
        db.session.commit()


def ensure_schema_compatibility() -> None:
    inspector = inspect(db.engine)
    table_names = set(inspector.get_table_names())

    if "account_set_factory_rest_days" not in table_names:
        from models.account_set import AccountSetFactoryRestDay

        AccountSetFactoryRestDay.__table__.create(bind=db.engine, checkfirst=True)

    if "daily_attendance_overrides" not in table_names:
        from models.daily_attendance_override import DailyAttendanceOverride

        DailyAttendanceOverride.__table__.create(bind=db.engine, checkfirst=True)

    department_columns = _get_column_names(inspector, "departments")
    if department_columns is not None:
        if "parent_id" not in department_columns:
            db.session.execute(text("ALTER TABLE departments ADD COLUMN parent_id INTEGER"))
            try:
                db.session.execute(text("CREATE INDEX ix_departments_parent_id ON departments(parent_id)"))
            except OperationalError:
                # 索引可能已存在（旧库迁移重复执行），幂等跳过
                pass
            db.session.commit()
        if "is_locked" not in department_columns:
            db.session.execute(text("ALTER TABLE departments ADD COLUMN is_locked BOOLEAN NOT NULL DEFAULT 0"))
            db.session.commit()

    employee_columns = _get_column_names(inspector, "employees")
    if employee_columns is not None:
        if "is_manager" not in employee_columns:
            db.session.execute(text("ALTER TABLE employees ADD COLUMN is_manager BOOLEAN NOT NULL DEFAULT 0"))
            db.session.commit()
        if "is_nursing" not in employee_columns:
            db.session.execute(text("ALTER TABLE employees ADD COLUMN is_nursing BOOLEAN NOT NULL DEFAULT 0"))
            db.session.commit()
        if "include_in_manager_stats" not in employee_columns:
            db.session.execute(text("ALTER TABLE employees ADD COLUMN include_in_manager_stats BOOLEAN NOT NULL DEFAULT 0"))
            db.session.commit()
        if "employee_stats_attendance_source" not in employee_columns:
            db.session.execute(
                text(
                    "ALTER TABLE employees ADD COLUMN employee_stats_attendance_source "
                    "VARCHAR(20) NOT NULL DEFAULT 'employee'"
                )
            )
            db.session.commit()
        if "manager_stats_attendance_source" not in employee_columns:
            db.session.execute(
                text(
                    "ALTER TABLE employees ADD COLUMN manager_stats_attendance_source "
                    "VARCHAR(20) NOT NULL DEFAULT 'manager'"
                )
            )
            db.session.commit()
        if "resigned_at" not in employee_columns:
            db.session.execute(text("ALTER TABLE employees ADD COLUMN resigned_at DATE"))
            db.session.commit()
            try:
                db.session.execute(text("CREATE INDEX ix_employees_resigned_at ON employees(resigned_at)"))
                db.session.commit()
            except OperationalError:
                # 索引可能已存在（旧库迁移重复执行），幂等跳过
                db.session.rollback()

    account_set_columns = _get_column_names(inspector, "account_sets")
    if account_set_columns is not None:
        if "factory_rest_days" not in account_set_columns:
            db.session.execute(text("ALTER TABLE account_sets ADD COLUMN factory_rest_days FLOAT NOT NULL DEFAULT 0"))
            db.session.commit()
        if "monthly_benefit_days" not in account_set_columns:
            db.session.execute(text("ALTER TABLE account_sets ADD COLUMN monthly_benefit_days FLOAT NOT NULL DEFAULT 0"))
            db.session.commit()
        if "is_locked" not in account_set_columns:
            db.session.execute(text("ALTER TABLE account_sets ADD COLUMN is_locked BOOLEAN NOT NULL DEFAULT 0"))
            db.session.commit()
        if "locked_at" not in account_set_columns:
            db.session.execute(text("ALTER TABLE account_sets ADD COLUMN locked_at DATETIME"))
            db.session.commit()
        if "locked_by" not in account_set_columns:
            db.session.execute(text("ALTER TABLE account_sets ADD COLUMN locked_by INTEGER"))
            db.session.commit()

    user_columns = _get_column_names(inspector, "users")
    if user_columns is not None:
        if "page_permissions" not in user_columns:
            db.session.execute(text("ALTER TABLE users ADD COLUMN page_permissions JSON"))
            db.session.commit()
        if "profile_emp_no" not in user_columns:
            db.session.execute(text("ALTER TABLE users ADD COLUMN profile_emp_no VARCHAR(80)"))
            db.session.commit()
        if "profile_name" not in user_columns:
            db.session.execute(text("ALTER TABLE users ADD COLUMN profile_name VARCHAR(80)"))
            db.session.commit()
        if "profile_dept_id" not in user_columns:
            db.session.execute(text("ALTER TABLE users ADD COLUMN profile_dept_id INTEGER"))
            db.session.commit()
        if "login_failed_attempts" not in user_columns:
            db.session.execute(text("ALTER TABLE users ADD COLUMN login_failed_attempts INTEGER NOT NULL DEFAULT 0"))
            db.session.commit()
        if "login_locked_until" not in user_columns:
            db.session.execute(text("ALTER TABLE users ADD COLUMN login_locked_until DATETIME"))
            db.session.commit()
        if "login_disabled_until_admin_unlock" not in user_columns:
            db.session.execute(
                text("ALTER TABLE users ADD COLUMN login_disabled_until_admin_unlock BOOLEAN NOT NULL DEFAULT 0")
            )
            db.session.commit()
        if "login_disabled_reason" not in user_columns:
            db.session.execute(text("ALTER TABLE users ADD COLUMN login_disabled_reason VARCHAR(255)"))
            db.session.commit()

    daily_record_columns = _get_column_names(inspector, "daily_records")
    if daily_record_columns is not None:
        if "employee_payload" not in daily_record_columns:
            db.session.execute(text("ALTER TABLE daily_records ADD COLUMN employee_payload JSON"))
            db.session.commit()
        if "manager_payload" not in daily_record_columns:
            db.session.execute(text("ALTER TABLE daily_records ADD COLUMN manager_payload JSON"))
            db.session.commit()

    monthly_report_columns = _get_column_names(inspector, "monthly_reports")
    if monthly_report_columns is not None:
        if "employee_raw_data" not in monthly_report_columns:
            db.session.execute(text("ALTER TABLE monthly_reports ADD COLUMN employee_raw_data JSON"))
            db.session.commit()
        if "manager_raw_data" not in monthly_report_columns:
            db.session.execute(text("ALTER TABLE monthly_reports ADD COLUMN manager_raw_data JSON"))
            db.session.commit()

    employee_override_columns = _get_column_names(inspector, "employee_attendance_overrides")
    if employee_override_columns is not None:
        if "actual_attendance_days" not in employee_override_columns:
            db.session.execute(
                text("ALTER TABLE employee_attendance_overrides ADD COLUMN actual_attendance_days FLOAT")
            )
            db.session.commit()

    # 性能复合索引（模型层与 Alembic 迁移 b2c3d4e5f6a7 同名同列）：
    # 旧库升级路径（upgrade-legacy-schema）不跑 Alembic，这里幂等补建
    _performance_indexes = (
        ("leave_records", "ix_leave_records_emp_id_start_time", "emp_id, start_time"),
        ("overtime_records", "ix_overtime_records_emp_id_start_time", "emp_id, start_time"),
        (
            "attendance_override_histories",
            "ix_attendance_override_history_type_month_created",
            "override_type, month, created_at",
        ),
    )
    for table_name, index_name, index_columns in _performance_indexes:
        if table_name not in table_names:
            continue
        existing_index_names = {index["name"] for index in inspector.get_indexes(table_name)}
        if index_name in existing_index_names:
            continue
        try:
            db.session.execute(text(f"CREATE INDEX {index_name} ON {table_name}({index_columns})"))
            db.session.commit()
        except OperationalError:
            # 索引可能已存在（重复执行），幂等跳过
            db.session.rollback()


def _get_column_names(inspector: Inspector, table_name: str) -> set[str] | None:
    try:
        return {column["name"] for column in inspector.get_columns(table_name)}
    except NoSuchTableError:
        return None
