from __future__ import annotations

from flask import Blueprint, Response, g, jsonify
from sqlalchemy.orm import joinedload

from models.employee import Employee
from routes.auth import login_required, page_permission_required
from routes.employee import (
    _accessible_emp_ids,
    account_sets_api,
    abnormal_attendance_api,
    abnormal_attendance_export_api,
    departments_api,
    department_hours_api,
    department_hours_export_api,
    final_data_api,
    final_data_export_api,
    home_manager_summary_api,
    manager_annual_leave_query_api,
    manager_attendance_api,
    manager_attendance_export_api,
    manager_attendance_template_export_api,
    manager_department_hours_api,
    manager_department_hours_export_api,
    manager_overtime_query_api,
    punch_records_api,
    punch_records_export_api,
    summary_download_export_api,
)
from utils.app_navigation import nav_payload


api_query_bp = Blueprint("api_query", __name__, url_prefix="/api/query")


def _serialize_employee(row: Employee) -> dict[str, object]:
    return {
        "id": row.id,
        "emp_no": row.emp_no,
        "name": row.name,
        "dept_id": row.dept_id,
        "dept_name": row.department.dept_name if row.department else "",
        "is_manager": bool(row.is_manager),
    }


def _coerce_response(response: Response | tuple[Response, int]) -> tuple[Response, int]:
    if isinstance(response, tuple):
        flask_response, status_code = response
        return flask_response, status_code
    return response, response.status_code


@api_query_bp.get("/bootstrap")
@login_required
def bootstrap():
    if g.current_user.role == "admin":
        employees = Employee.query.options(joinedload(Employee.department)).order_by(Employee.emp_no.asc()).all()
    else:
        emp_ids = _accessible_emp_ids()
        if emp_ids:
            employees = (
                Employee.query.options(joinedload(Employee.department))
                .filter(Employee.id.in_(emp_ids))
                .order_by(Employee.emp_no.asc())
                .all()
            )
        else:
            employees = []

    account_sets_response, account_sets_status = _coerce_response(account_sets_api())
    if account_sets_status != 200:
        return account_sets_response, account_sets_status

    departments_response, departments_status = _coerce_response(departments_api())
    if departments_status != 200:
        return departments_response, departments_status

    return jsonify(
        {
            "employees": [_serialize_employee(row) for row in employees],
            "account_sets": account_sets_response.get_json(),
            "departments": departments_response.get_json(),
        }
    )


@api_query_bp.get("/navigation")
@login_required
def navigation():
    return jsonify({"modules": nav_payload(g.current_user)})


@api_query_bp.get("/home-summary")
@login_required
def home_summary():
    return home_manager_summary_api()


@api_query_bp.get("/employee-dashboard")
@page_permission_required("employee_dashboard")
def employee_dashboard():
    return final_data_api()


@api_query_bp.get("/employee-dashboard/export")
@page_permission_required("employee_dashboard")
def employee_dashboard_export():
    return final_data_export_api()


@api_query_bp.get("/abnormal")
@page_permission_required("abnormal_query")
def abnormal():
    return abnormal_attendance_api()


@api_query_bp.get("/abnormal/export")
@page_permission_required("abnormal_query")
def abnormal_export():
    return abnormal_attendance_export_api()


@api_query_bp.get("/punch-records")
@page_permission_required("punch_records")
def punch_records():
    return punch_records_api()


@api_query_bp.get("/punch-records/export")
@page_permission_required("punch_records")
def punch_records_export():
    return punch_records_export_api()


@api_query_bp.get("/department-hours")
@page_permission_required("department_hours_query")
def department_hours():
    return department_hours_api()


@api_query_bp.get("/department-hours/export")
@page_permission_required("department_hours_query")
def department_hours_export():
    return department_hours_export_api()


@api_query_bp.get("/manager-attendance")
@page_permission_required("manager_query")
def manager_attendance():
    return manager_attendance_api()


@api_query_bp.get("/manager-attendance/export")
@page_permission_required("manager_query")
def manager_attendance_export():
    return manager_attendance_export_api()


@api_query_bp.get("/manager-attendance/export-template")
@page_permission_required("manager_query")
def manager_attendance_export_template():
    return manager_attendance_template_export_api()


@api_query_bp.get("/manager-overtime")
@page_permission_required("manager_overtime_query")
def manager_overtime():
    return manager_overtime_query_api()


@api_query_bp.get("/manager-annual-leave")
@page_permission_required("manager_annual_leave_query")
def manager_annual_leave():
    return manager_annual_leave_query_api()


@api_query_bp.get("/manager-department-hours")
@page_permission_required("manager_department_hours_query")
def manager_department_hours():
    return manager_department_hours_api()


@api_query_bp.get("/manager-department-hours/export")
@page_permission_required("manager_department_hours_query")
def manager_department_hours_export():
    return manager_department_hours_export_api()


@api_query_bp.get("/summary-download/export")
@page_permission_required("summary_download")
def summary_download_export():
    return summary_download_export_api()
