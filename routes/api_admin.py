import os
from io import BytesIO
from datetime import datetime

import openpyxl
from flask import Blueprint, current_app, jsonify, request, send_file

from models.department import Department
from models.shift import Shift
from routes import admin as admin_module
from routes.admin import (
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
    import_departments_xlsx,
    export_departments_xlsx,
    import_employees_xlsx,
    export_employees_xlsx,
)
from routes.admin_accounts import disabled_users_list_api, unlock_disabled_user_api, users_list_api
from routes.admin_attendance_overrides import (
    employee_attendance_override_history_api,
    employee_attendance_override_list_api,
    save_employee_attendance_override_record_api,
    manager_attendance_override_history_api,
    manager_attendance_override_list_api,
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
    workbook = admin_module._build_departments_workbook(
        [
            ("D001", "行政部", "", ""),
            ("D002", "生产中心", "", ""),
            ("D003", "生产一部", "D002", ""),
        ]
    )
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return send_file(
        output,
        as_attachment=True,
        download_name="部门导入模板.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


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
    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.title = "员工导入模板"
    worksheet.append(
        [
            "人员编号",
            "人员姓名",
            "部门名称",
            "班次编号",
            "是否管理人员",
            "是否哺乳假",
            "员工考勤统计来源",
            "管理人员考勤统计来源",
        ]
    )
    worksheet.append(
        [
            "1001001",
            "张三",
            "生产中心",
            "A00001",
            "否",
            "否",
            "员工考勤源文件取值",
            "管理人员考勤源文件取值",
        ]
    )
    worksheet.append(
        [
            "1001002",
            "李四",
            "行政部",
            "A00002",
            "是",
            "是",
            "员工考勤源文件取值",
            "管理人员考勤源文件取值",
        ]
    )
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return send_file(
        output,
        as_attachment=True,
        download_name="员工导入模板.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


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


@api_admin_bp.put("/employee-attendance-overrides/record")
@admin_required
def employee_attendance_override_record():
    return save_employee_attendance_override_record_api()


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


@api_admin_bp.put("/manager-attendance-overrides/record")
@admin_required
def manager_attendance_override_record():
    return save_manager_attendance_override_record_api()


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
    from routes import admin as admin_module

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
    from routes import admin as admin_module

    account_set_id = request.form.get("account_set_id", type=int)
    account_set = (
        admin_module.db.session.get(AccountSet, account_set_id)
        if account_set_id
        else AccountSet.query.filter_by(is_active=True).first()
    )
    if not account_set:
        return jsonify({"status": "error", "message": "请先创建并选择账套"}), 400
    locked_error = admin_module._ensure_account_set_unlocked(account_set, "上传原始文件")
    if locked_error:
        return locked_error

    uploaded_files = [file for file in request.files.getlist("files") if (file.filename or "").strip()]
    if not uploaded_files:
        return jsonify({"status": "error", "message": "请至少选择一个要上传的源文件"}), 400

    results = []
    success = 0
    failed = 0
    for file in uploaded_files:
        filename = file.filename.strip()
        file_type = admin_module._account_set_file_type(filename)
        previous_record = AccountSetImport.query.filter_by(account_set_id=account_set.id, file_type=file_type).first()
        replaced = previous_record is not None

        if previous_record:
            old_path = (previous_record.stored_path or "").strip()
            if old_path and os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except Exception:
                    pass
            admin_module.db.session.delete(previous_record)
            admin_module.db.session.flush()

        account_set_dir = os.path.join(current_app.config["UPLOAD_FOLDER"], "account_sets", account_set.month)
        os.makedirs(account_set_dir, exist_ok=True)
        save_name = f"{int(datetime.now().timestamp())}_{filename}"
        save_path = os.path.join(account_set_dir, save_name)
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        file.save(save_path)

        import_record = AccountSetImport(
            account_set_id=account_set.id,
            source_filename=filename,
            stored_path=save_path,
            file_type=file_type,
            status="uploaded",
            imported_count=0,
        )
        admin_module.db.session.add(import_record)

        try:
            success += 1
            import_record.error_message = None
            results.append({"file": filename, "status": "ok", "message": "replaced" if replaced else "uploaded"})
        except Exception as exc:
            failed += 1
            import_record.status = "error"
            import_record.error_message = str(exc)
            results.append({"file": filename, "status": "error", "error": str(exc)})
        admin_module.db.session.commit()

    return jsonify(
        {
            "status": "ok" if failed == 0 else "partial",
            "account_set": admin_module._serialize_account_set(account_set),
            "total": len(uploaded_files),
            "success": success,
            "failed": failed,
            "results": results,
        }
    )
