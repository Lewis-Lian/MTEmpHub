from __future__ import annotations

from datetime import date, datetime

from flask import has_app_context
from sqlalchemy import func

from models import db
from models.daily_record import DailyRecord
from models.leave import LeaveRecord
from models.annual_leave import AnnualLeave
from models.employee import Employee
from services.attendance_source_service import EMPLOYEE_STATS_CONTEXT, attendance_views_by_employee
from services.attendance_summary_service import batch_monthly_summaries, empty_monthly_summary


LEAVE_TYPES = ["病假", "事假", "工伤", "丧假", "婚假", "出差", "补休（调休）"]


def _month_date_range(month: str) -> tuple[date, date] | None:
    try:
        start = datetime.strptime(month, "%Y-%m").date().replace(day=1)
    except ValueError:
        return None
    if start.month == 12:
        return start, date(start.year + 1, 1, 1)
    return start, date(start.year, start.month + 1, 1)


def _get_employee(emp_id: int) -> Employee | None:
    if has_app_context():
        return db.session.get(Employee, emp_id)

    query = getattr(Employee, "query", None)
    getter = getattr(query, "get", None)
    if callable(getter):
        return getter(emp_id)
    return None


class AttendanceService:
    @staticmethod
    def monthly_summary(emp_id: int, month: str) -> dict:
        employee = _get_employee(emp_id)
        if not employee:
            return empty_monthly_summary()
        return batch_monthly_summaries(month, [employee], EMPLOYEE_STATS_CONTEXT).get(emp_id, empty_monthly_summary())

    @staticmethod
    def yearly_summary(emp_id: int, year: int) -> dict:
        employee = _get_employee(emp_id)
        actual_hours = 0.0
        absent_hours = 0.0
        overtime_hours = 0.0
        if employee:
            for month in range(1, 13):
                month_key = f"{year}-{month:02d}"
                rows = attendance_views_by_employee(month_key, [employee], EMPLOYEE_STATS_CONTEXT).get(emp_id, [])
                actual_hours += sum(float(row.actual_hours or 0) for row in rows)
                absent_hours += sum(float(row.absent_hours or 0) for row in rows)
                overtime_hours += sum(float(row.overtime_hours or 0) for row in rows)

        year_start = date(year, 1, 1)
        next_year_start = date(year + 1, 1, 1)
        leave_total = (
            db.session.query(func.coalesce(func.sum(LeaveRecord.duration), 0))
            .filter(LeaveRecord.emp_id == emp_id)
            .filter(LeaveRecord.start_time >= year_start)
            .filter(LeaveRecord.start_time < next_year_start)
            .scalar()
        )

        return {
            "actual_hours": float(actual_hours or 0),
            "absent_hours": float(absent_hours or 0),
            "overtime_hours": float(overtime_hours or 0),
            "leave_duration": float(leave_total or 0),
        }

    @staticmethod
    def deduction_calc(emp_id: int, month: str) -> dict:
        summary = AttendanceService.monthly_summary(emp_id, month)
        late_penalty = round(summary["late_minutes"] * 0.1, 2)
        early_penalty = round(summary["early_leave_minutes"] * 0.1, 2)
        absent_penalty = round(summary["absent_hours"] * 20, 2)
        total_penalty = round(late_penalty + early_penalty + absent_penalty, 2)
        return {
            "late_penalty": late_penalty,
            "early_penalty": early_penalty,
            "absent_penalty": absent_penalty,
            "total_penalty": total_penalty,
        }

    @staticmethod
    def annual_leave_balance(emp_id: int, year: int) -> dict:
        row = AnnualLeave.query.filter_by(emp_id=emp_id, year=year).first()
        if not row:
            return {"year": year, "total_days": 0, "used_days": 0, "remaining_days": 0}
        return {
            "year": year,
            "total_days": row.total_days,
            "used_days": row.used_days,
            "remaining_days": row.remaining_days,
        }
