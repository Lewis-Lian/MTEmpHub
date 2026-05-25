from flask import Blueprint, jsonify

from models.department import Department
from models.shift import Shift
from routes.admin import (
    departments_list,
    employees_list,
    list_shifts,
    manager_annual_leave_records,
    manager_overtime_records,
)
from routes.admin_accounts import users_list_api
from routes.admin_attendance_overrides import (
    employee_attendance_override_history_api,
    employee_attendance_override_list_api,
    save_employee_attendance_override_record_api,
    manager_attendance_override_history_api,
    manager_attendance_override_list_api,
    save_manager_attendance_override_record_api,
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


@api_admin_bp.get("/manager-overtime")
@admin_required
def manager_overtime():
    return manager_overtime_records()


@api_admin_bp.get("/manager-annual-leave")
@admin_required
def manager_annual_leave():
    return manager_annual_leave_records()
