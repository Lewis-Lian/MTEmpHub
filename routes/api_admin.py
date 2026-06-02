from flask import Blueprint, jsonify

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
    update_department,
    update_employee,
    update_account_set,
    update_shift,
    unlock_account_set,
)
from routes.admin_imports import (
    download_departments_template,
    download_employees_template,
    import_departments_xlsx,
    export_departments_xlsx,
    import_employees_xlsx,
    export_employees_xlsx,
    import_raw_files as admin_import_raw_files,
)
from routes.admin_accounts import disabled_users_list_api, unlock_disabled_user_api, users_list_api
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


@api_admin_bp.get("/accounts")
@admin_required
def accounts():
    return users_list_api()


@api_admin_bp.get("/disabled-users")
@admin_required
def disabled_users():
    return disabled_users_list_api()


@api_admin_bp.post("/disabled-users/<int:user_id>/unlock")
@admin_required
def unlock_disabled_user(user_id: int):
    return unlock_disabled_user_api(user_id)


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


@api_admin_bp.get("/manager-annual-leave")
@admin_required
def manager_annual_leave():
    return manager_annual_leave_records()


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
