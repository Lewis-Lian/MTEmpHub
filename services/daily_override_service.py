"""逐日考勤修正：状态枚举、修正表查询与口径映射。

供 query_core（员工月度聚合/日历）、manager_attendance_service（管理人员聚合）、
admin_attendance_overrides（端点校验）共用。本模块不依赖 routes.*，避免循环引用。
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from models import db
from models.daily_attendance_override import DailyAttendanceOverride
from models.employee import Employee
from models.overtime import OvertimeRecord

# 出勤类状态 + 假种状态。员工假种与查询页 6 类请假列对齐（无年假/出差列）；
# 管理人员假种与月度字段（工伤/出差/婚假/丧假）对齐。
EMPLOYEE_DAILY_STATUSES = (
    "全勤",
    "上午出勤",
    "下午出勤",
    "缺勤",
    "病假",
    "工伤",
    "丧假",
    "事假",
    "补休（调休）",
    "婚假",
)
MANAGER_DAILY_STATUSES = ("全勤", "上午出勤", "下午出勤", "缺勤", "工伤", "出差", "婚假", "丧假")

HALF_DAY_STATUSES = ("上午出勤", "下午出勤")

# 员工修正假种 → 查询页请假列 bucket（次数不并入，只并天数）
EMPLOYEE_LEAVE_BUCKETS = ("病假", "工伤", "丧假", "事假", "补休（调休）", "婚假")
# 管理人员修正假种 → build_manager_rows 字段
MANAGER_LEAVE_FIELD_BY_STATUS = {
    "工伤": "injury_days",
    "出差": "business_trip_days",
    "婚假": "marriage_days",
    "丧假": "funeral_days",
}

DAILY_OVERRIDE_FIELDS = (
    "status",
    "is_evening_overtime",
    "work_hours",
    "late_minutes",
    "early_leave_minutes",
    "remark",
)

EVENING_OVERTIME_START = time(17, 0)


def daily_statuses_for(employee: Employee) -> tuple[str, ...]:
    return MANAGER_DAILY_STATUSES if employee.is_manager else EMPLOYEE_DAILY_STATUSES


def status_attendance_days(status: str) -> float:
    """状态 → 当日考勤天数：全勤 1；上午/下午出勤 0.5；缺勤与假种 0。"""
    if status == "全勤":
        return 1.0
    if status in HALF_DAY_STATUSES:
        return 0.5
    return 0.0


def month_date_bounds(month: str) -> tuple[date, date] | None:
    try:
        start = datetime.strptime(month, "%Y-%m").date().replace(day=1)
    except ValueError:
        return None
    if start.month == 12:
        end = date(start.year + 1, 1, 1)
    else:
        end = date(start.year, start.month + 1, 1)
    return start, end


def daily_override_maps(month: str, emp_ids: list[int]) -> dict[int, dict[date, DailyAttendanceOverride]]:
    """按员工分组返回当月逐日修正：{emp_id: {record_date: override}}。"""
    if not emp_ids:
        return {}
    bounds = month_date_bounds(month)
    if not bounds:
        return {}
    start, end = bounds
    rows = (
        DailyAttendanceOverride.query.filter(DailyAttendanceOverride.emp_id.in_(emp_ids))
        .filter(DailyAttendanceOverride.record_date >= start, DailyAttendanceOverride.record_date < end)
        .all()
    )
    maps: dict[int, dict[date, DailyAttendanceOverride]] = {}
    for row in rows:
        maps.setdefault(row.emp_id, {})[row.record_date] = row
    return maps


def evening_overtime_dates_by_emp(month: str, emp_ids: list[int]) -> dict[int, set[date]]:
    """晚加班条（start_time ≥ 17:00，条级属性继承到覆盖的每一天，排除已拒绝）覆盖的日期集合。

    口径与 query_core._split_overtime_by_day 的 is_evening 判定一致。
    """
    if not emp_ids:
        return {}
    bounds = month_date_bounds(month)
    if not bounds:
        return {}
    month_start, month_end = bounds
    rows = (
        OvertimeRecord.query.filter(OvertimeRecord.emp_id.in_(emp_ids))
        .filter(
            OvertimeRecord.start_time < datetime.combine(month_end, time.min),
            OvertimeRecord.end_time >= datetime.combine(month_start, time.min),
        )
        .all()
    )
    result: dict[int, set[date]] = {}
    for record in rows:
        if not record.start_time or not record.end_time:
            continue
        if (record.approval_status or "") == "已拒绝":
            continue
        if record.start_time.time() < EVENING_OVERTIME_START:
            continue
        day = max(record.start_time.date(), month_start)
        while day < month_end and day <= record.end_time.date():
            result.setdefault(record.emp_id, set()).add(day)
            day += timedelta(days=1)
    return result


def effective_late_minutes(record_value: int | None, override: DailyAttendanceOverride | None) -> int:
    """当日迟到分钟：修正值优先，否则记录原值。"""
    if override is not None and override.late_minutes is not None:
        return int(override.late_minutes)
    return int(record_value or 0)


def effective_early_leave_minutes(record_value: int | None, override: DailyAttendanceOverride | None) -> int:
    if override is not None and override.early_leave_minutes is not None:
        return int(override.early_leave_minutes)
    return int(record_value or 0)


def serialize_daily_override(row: DailyAttendanceOverride | None) -> dict | None:
    if row is None:
        return None
    payload = {field: getattr(row, field) for field in DAILY_OVERRIDE_FIELDS if field != "remark"}
    payload["remark"] = row.remark or ""
    payload["updated_at"] = row.updated_at.isoformat() if row.updated_at else None
    payload["updated_by_name"] = row.updated_by_user.username if row.updated_by_user else ""
    return payload


