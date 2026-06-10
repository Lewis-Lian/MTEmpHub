import os
from urllib.parse import urlparse

from flask import Blueprint, current_app, jsonify, request

from models.department import Department
from models.shift import Shift
from routes.admin_core import (
    AccountSet,
    AccountSetImport,
    activate_account_set,
    calculate_account_set,
    batch_operate_departments,
    batch_operate_employees,
    create_department,
    create_employee,
    create_account_set,
    create_shift,
    delete_department,
    delete_employee,
    delete_account_set,
    delete_shift,
    delete_unbound_departments,
    departments_list,
    employees_list,
    list_account_sets,
    list_shifts,
    lock_account_set,
    manager_annual_leave_records,
    manager_overtime_records,
    update_manager_annual_leave_record,
    update_manager_overtime_summary,
    update_department,
    update_employee,
    update_account_set,
    update_shift,
    unlock_account_set,
)
from routes.admin_imports import (
    download_departments_template,
    download_employees_template,
    download_manager_annual_leave_template,
    download_manager_overtime_template,
    import_departments_xlsx,
    export_departments_xlsx,
    import_employees_xlsx,
    export_employees_xlsx,
    import_manager_annual_leave,
    import_manager_overtime,
    export_manager_annual_leave,
    export_manager_overtime,
    import_raw_files as admin_import_raw_files,
)
from routes.admin_accounts import (
    disabled_users_list_api,
    unlock_disabled_user_api,
    users_list_api,
    register_admin_account_routes,
)
from routes.admin_attendance_overrides import (
    employee_attendance_override_history_api,
    employee_attendance_override_list_api,
    employee_attendance_override_record_api,
    delete_employee_attendance_override_record_api,
    save_employee_attendance_override_record_api,
    manager_attendance_override_history_api,
    manager_attendance_override_list_api,
    manager_attendance_override_record_api,
    delete_manager_attendance_override_record_api,
    save_manager_attendance_override_record_api,
    download_employee_attendance_override_template,
    export_employee_attendance_overrides,
    import_employee_attendance_overrides,
    download_manager_attendance_override_template,
    export_manager_attendance_overrides,
    import_manager_attendance_overrides,
)
from routes.auth_helpers import admin_required


api_admin_bp = Blueprint("api_admin", __name__, url_prefix="/api/admin")
register_admin_account_routes(api_admin_bp)


@api_admin_bp.get("/bootstrap")
@admin_required
def bootstrap():
    return jsonify(
        {
            "departments": [
                {
                    "id": row.id,
                    "dept_no": row.dept_no,
                    "dept_name": row.dept_name,
                    "parent_id": row.parent_id,
                }
                for row in Department.query.order_by(Department.dept_name.asc()).all()
            ],
            "shifts": [
                {
                    "id": row.id,
                    "shift_no": row.shift_no,
                    "shift_name": row.shift_name,
                    "time_slots": row.time_slots or [],
                    "is_cross_day": row.is_cross_day,
                }
                for row in Shift.query.order_by(Shift.shift_no.asc()).all()
            ],
        }
    )


@api_admin_bp.get("/database-settings")
@admin_required
def database_settings():
    uri = current_app.config.get("SQLALCHEMY_DATABASE_URI", "") or ""
    parsed = urlparse(uri)
    dialect = parsed.scheme.split("+", 1)[0] if parsed.scheme else "unknown"

    if dialect == "sqlite":
        database_name = parsed.path.lstrip("/") or ":memory:"
        host = "-"
    else:
        database_name = parsed.path.lstrip("/") or "-"
        host = parsed.hostname or "-"

    username = parsed.username or "-"

    # 读取 .env 中已保存的 MySQL 配置（用于前端表单回填）
    from utils.env_utils import read_env, parse_mysql_url

    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    env_data = read_env(env_path)
    mysql_config = {}
    env_db_url = env_data.get("DATABASE_URL", "")
    if env_db_url.startswith("mysql"):
        mysql_config = parse_mysql_url(env_db_url)

    return jsonify(
        {
            "current": [
                {
                    "item": "数据库类型",
                    "value": dialect,
                    "description": "当前 SQLAlchemy 连接使用的数据库方言。",
                },
                {
                    "item": "数据库名称",
                    "value": database_name,
                    "description": "当前应用实际连接的数据库名称或本地文件名。",
                },
                {
                    "item": "主机地址",
                    "value": host,
                    "description": "远程数据库显示主机地址，本地 sqlite 显示为 - 。",
                },
                {
                    "item": "用户名",
                    "value": username,
                    "description": "数据库连接用户名；未配置时显示为 - 。",
                },
            ],
            "mysql_config": mysql_config,
        }
    )


@api_admin_bp.put("/database-settings")
@admin_required
def save_database_settings():
    """保存 MySQL 连接信息到 .env 文件。"""
    data = request.get_json(force=True)
    host = data.get("host", "").strip()
    port = int(data.get("port", 3306) or 3306)
    username = data.get("username", "").strip()
    password = data.get("password", "")
    database = data.get("database", "").strip()

    if not all([host, username, database]):
        return jsonify({"error": "主机地址、用户名和数据库名不能为空"}), 400

    from utils.env_utils import build_mysql_url, write_env_value

    mysql_url = build_mysql_url(host, port, username, password, database)
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    write_env_value(env_path, "DATABASE_URL", mysql_url)

    return jsonify({"message": "配置已保存，重启应用后生效。"})


@api_admin_bp.post("/database-test-connection")
@admin_required
def test_database_connection():
    """测试 MySQL 连接是否可用。"""
    data = request.get_json(force=True)
    host = data.get("host", "").strip()
    port = int(data.get("port", 3306) or 3306)
    username = data.get("username", "").strip()
    password = data.get("password", "")
    database = data.get("database", "").strip()

    if not all([host, username, database]):
        return jsonify({"error": "主机地址、用户名和数据库名不能为空"}), 400

    from utils.env_utils import build_mysql_url
    from services.migration_service import test_mysql_connection

    mysql_url = build_mysql_url(host, port, username, password, database)
    result = test_mysql_connection(mysql_url)

    if result["ok"]:
        return jsonify({"ok": True, "message": "连接成功"})
    return jsonify({"ok": False, "message": result["message"]})


@api_admin_bp.post("/database-migrate")
@admin_required
def database_migrate():
    """执行 SQLite → MySQL 数据迁移。"""
    from utils.env_utils import read_env, build_mysql_url

    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    env_data = read_env(env_path)

    # 确定 SQLite 来源
    current_uri = current_app.config.get("SQLALCHEMY_DATABASE_URI", "")
    if current_uri.startswith("sqlite"):
        sqlite_url = current_uri
    else:
        # 如果当前已经是 MySQL，尝试从 instance 目录找 SQLite 文件
        instance_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "instance")
        sqlite_path = os.path.join(instance_dir, "attendance.db")
        if not os.path.exists(sqlite_path):
            return jsonify({"error": "未找到 SQLite 数据库文件"}), 400
        sqlite_url = f"sqlite:///{sqlite_path}"

    # 确定 MySQL 目标
    db_url = env_data.get("DATABASE_URL", "")
    if not db_url.startswith("mysql"):
        return jsonify({"error": "请先保存 MySQL 连接配置"}), 400

    try:
        from services.migration_service import migrate_sqlite_to_mysql

        results = migrate_sqlite_to_mysql(sqlite_url, db_url)
        return jsonify({"ok": True, "results": results})
    except Exception as e:
        return jsonify({"ok": False, "message": str(e)}), 500


@api_admin_bp.post("/database-switch-sqlite")
@admin_required
def database_switch_sqlite():
    """切回 SQLite 数据库。"""
    from utils.env_utils import write_env_value

    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    write_env_value(env_path, "DATABASE_URL", "sqlite:///attendance.db")

    return jsonify({"message": "已切换回 SQLite，重启应用后生效。"})


@api_admin_bp.get("/accounts")
@admin_required
def accounts():
    return users_list_api()





@api_admin_bp.get("/employees")
@admin_required
def employees():
    return employees_list()


@api_admin_bp.get("/departments")
@admin_required
def departments():
    return departments_list()


@api_admin_bp.get("/shifts")
@admin_required
def shifts():
    return list_shifts()


@api_admin_bp.get("/departments/template")
@admin_required
def departments_template():
    return download_departments_template()


@api_admin_bp.post("/departments/import")
@admin_required
def departments_import():
    return import_departments_xlsx()


@api_admin_bp.get("/departments/export")
@admin_required
def departments_export():
    return export_departments_xlsx()


@api_admin_bp.get("/employees/template")
@admin_required
def employees_template():
    return download_employees_template()


@api_admin_bp.post("/employees/import")
@admin_required
def employees_import():
    return import_employees_xlsx()


@api_admin_bp.get("/employees/export")
@admin_required
def employees_export():
    return export_employees_xlsx()


@api_admin_bp.post("/shifts")
@admin_required
def shifts_create():
    return create_shift()


@api_admin_bp.put("/shifts/<int:shift_id>")
@admin_required
def shifts_update(shift_id: int):
    return update_shift(shift_id)


@api_admin_bp.delete("/shifts/<int:shift_id>")
@admin_required
def shifts_delete(shift_id: int):
    return delete_shift(shift_id)


@api_admin_bp.post("/departments")
@admin_required
def departments_create():
    return create_department()


@api_admin_bp.put("/departments/<int:dept_id>")
@admin_required
def departments_update(dept_id: int):
    return update_department(dept_id)


@api_admin_bp.delete("/departments/<int:dept_id>")
@admin_required
def departments_delete(dept_id: int):
    return delete_department(dept_id)


@api_admin_bp.post("/departments/batch")
@admin_required
def departments_batch():
    return batch_operate_departments()


@api_admin_bp.post("/departments/delete-unbound")
@admin_required
def departments_delete_unbound():
    return delete_unbound_departments()


@api_admin_bp.post("/employees")
@admin_required
def employees_create():
    return create_employee()


@api_admin_bp.put("/employees/<int:employee_id>")
@admin_required
def employees_update(employee_id: int):
    return update_employee(employee_id)


@api_admin_bp.delete("/employees/<int:employee_id>")
@admin_required
def employees_delete(employee_id: int):
    return delete_employee(employee_id)


@api_admin_bp.post("/employees/batch")
@admin_required
def employees_batch():
    return batch_operate_employees()


@api_admin_bp.get("/employee-attendance-overrides")
@admin_required
def employee_attendance_overrides():
    return employee_attendance_override_list_api()


@api_admin_bp.get("/employee-attendance-overrides/history")
@admin_required
def employee_attendance_override_history():
    return employee_attendance_override_history_api()


@api_admin_bp.get("/employee-attendance-overrides/record")
@admin_required
def employee_attendance_override_record_get():
    return employee_attendance_override_record_api()


@api_admin_bp.put("/employee-attendance-overrides/record")
@admin_required
def employee_attendance_override_record_put():
    return save_employee_attendance_override_record_api()


@api_admin_bp.delete("/employee-attendance-overrides/record")
@admin_required
def employee_attendance_override_record_delete():
    return delete_employee_attendance_override_record_api()


@api_admin_bp.get("/employee-attendance-overrides/template")
@admin_required
def employee_attendance_override_template():
    return download_employee_attendance_override_template()


@api_admin_bp.get("/employee-attendance-overrides/export")
@admin_required
def employee_attendance_override_export():
    return export_employee_attendance_overrides()


@api_admin_bp.post("/employee-attendance-overrides/import")
@admin_required
def employee_attendance_override_import():
    return import_employee_attendance_overrides()


@api_admin_bp.get("/manager-attendance-overrides")
@admin_required
def manager_attendance_overrides():
    return manager_attendance_override_list_api()


@api_admin_bp.get("/manager-attendance-overrides/history")
@admin_required
def manager_attendance_override_history():
    return manager_attendance_override_history_api()


@api_admin_bp.get("/manager-attendance-overrides/record")
@admin_required
def manager_attendance_override_record_get():
    return manager_attendance_override_record_api()


@api_admin_bp.put("/manager-attendance-overrides/record")
@admin_required
def manager_attendance_override_record_put():
    return save_manager_attendance_override_record_api()


@api_admin_bp.delete("/manager-attendance-overrides/record")
@admin_required
def manager_attendance_override_record_delete():
    return delete_manager_attendance_override_record_api()


@api_admin_bp.get("/manager-attendance-overrides/template")
@admin_required
def manager_attendance_override_template():
    return download_manager_attendance_override_template()


@api_admin_bp.get("/manager-attendance-overrides/export")
@admin_required
def manager_attendance_override_export():
    return export_manager_attendance_overrides()


@api_admin_bp.post("/manager-attendance-overrides/import")
@admin_required
def manager_attendance_override_import():
    return import_manager_attendance_overrides()


@api_admin_bp.get("/manager-overtime")
@admin_required
def manager_overtime():
    return manager_overtime_records()


@api_admin_bp.get("/manager-overtime/records")
@admin_required
def manager_overtime_records_api():
    return manager_overtime_records()


@api_admin_bp.put("/manager-overtime/records")
@admin_required
def manager_overtime_records_update():
    return update_manager_overtime_summary()


@api_admin_bp.get("/manager-overtime/template")
@admin_required
def manager_overtime_template():
    return download_manager_overtime_template()


@api_admin_bp.post("/manager-overtime/import")
@admin_required
def manager_overtime_import():
    return import_manager_overtime()


@api_admin_bp.get("/manager-overtime/export")
@admin_required
def manager_overtime_export():
    return export_manager_overtime()


@api_admin_bp.get("/manager-annual-leave")
@admin_required
def manager_annual_leave():
    return manager_annual_leave_records()


@api_admin_bp.get("/manager-annual-leave/records")
@admin_required
def manager_annual_leave_records_api():
    return manager_annual_leave_records()


@api_admin_bp.put("/manager-annual-leave/records")
@admin_required
def manager_annual_leave_records_update():
    return update_manager_annual_leave_record()


@api_admin_bp.get("/manager-annual-leave/template")
@admin_required
def manager_annual_leave_template():
    return download_manager_annual_leave_template()


@api_admin_bp.post("/manager-annual-leave/import")
@admin_required
def manager_annual_leave_import():
    return import_manager_annual_leave()


@api_admin_bp.get("/manager-annual-leave/export")
@admin_required
def manager_annual_leave_export():
    return export_manager_annual_leave()


@api_admin_bp.get("/account-sets")
@admin_required
def account_sets():
    return list_account_sets()


@api_admin_bp.post("/account-sets")
@admin_required
def account_sets_create():
    return create_account_set()


@api_admin_bp.put("/account-sets/<int:account_set_id>")
@admin_required
def account_sets_update(account_set_id: int):
    return update_account_set(account_set_id)


@api_admin_bp.post("/account-sets/<int:account_set_id>/activate")
@admin_required
def account_sets_activate(account_set_id: int):
    return activate_account_set(account_set_id)


@api_admin_bp.post("/account-sets/<int:account_set_id>/lock")
@admin_required
def account_sets_lock(account_set_id: int):
    return lock_account_set(account_set_id)


@api_admin_bp.post("/account-sets/<int:account_set_id>/unlock")
@admin_required
def account_sets_unlock(account_set_id: int):
    return unlock_account_set(account_set_id)


@api_admin_bp.delete("/account-sets/<int:account_set_id>")
@admin_required
def account_sets_delete(account_set_id: int):
    return delete_account_set(account_set_id)


@api_admin_bp.post("/account-sets/<int:account_set_id>/calculate")
@admin_required
def account_sets_calculate(account_set_id: int):
    return calculate_account_set(account_set_id)


@api_admin_bp.get("/account-sets/<int:account_set_id>/imports")
@admin_required
def account_set_imports(account_set_id: int):
    from routes import admin_core as admin_module

    row = admin_module._require_model(AccountSet, account_set_id)
    records = (
        AccountSetImport.query.filter_by(account_set_id=row.id)
        .order_by(AccountSetImport.id.desc())
        .all()
    )
    return jsonify(
        [
            {
                "id": record.id,
                "source_filename": record.source_filename,
                "stored_path": record.stored_path,
                "file_type": record.file_type,
                "status": record.status,
                "imported_count": record.imported_count,
                "error_message": record.error_message,
                "created_at": record.created_at.isoformat() if record.created_at else None,
            }
            for record in records
        ]
    )


@api_admin_bp.post("/import/raw-files")
@admin_required
def import_raw_files():
    return admin_import_raw_files()
