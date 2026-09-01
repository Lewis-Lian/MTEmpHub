"""迟到冲抵：识别 OA 请假单中的分钟级冲抵单，确认后写入逐日修正的迟到分钟。

候选口径：
- 仅管理人员；列出当月所有迟到日（无冲抵请假单的冲抵分钟记 0，可在页面编辑）；
- 请假类型/事由文本中可提取"N分钟"且 0 < N ≤ 60（含请假一小时）的作为默认冲抵分钟，
  按 start_time 日期对应当日迟到；
- 当日已有人工修正 late_minutes 的不再生成候选（人工优先）。

确认冲抵 = 写入当天的 DailyAttendanceOverride.late_minutes（仅该字段），
统计侧沿用"修正值优先"，原有审计/锁定/撤销机制全部生效。
"""
from __future__ import annotations

import re
from datetime import date

from models import db
from models.daily_attendance_override import DailyAttendanceOverride
from models.employee import Employee
from models.leave import LeaveRecord
from services.attendance_source_service import (
    EMPLOYEE_STATS_CONTEXT,
    MANAGER_STATS_CONTEXT,
    attendance_views_by_employee,
)
from services.daily_override_service import daily_override_maps
from services.manager_attendance_service import (
    _leave_rows_by_employee,
    manager_day_late_minutes,
)

LATE_OFFSET_MAX_MINUTES = 60
LATE_OFFSET_REMARK_PREFIX = "迟到冲抵："
_LATE_OFFSET_MINUTES_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*分钟")
_LATE_OFFSET_HOURS_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*(?:小时|[hH])")
_LATE_OFFSET_CN_HOURS_PATTERN = re.compile(r"([一二两三四五六七八九十半])\s*小时")
_CN_HOUR_VALUES = {
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
    "半": 0.5,
}


def late_offset_minutes(leave: LeaveRecord) -> int | None:
    """从请假单提取冲抵分钟，0 < N ≤ 60 才视为冲抵单。

    优先取类型/事由文本中的时长说明（"N分钟"、"N小时"/"Nh"、中文数字小时）；
    文本提取不到时，用起止时间差兜底——同一天内不超过一小时的短请假
    （如 8:00-8:59 的事假）同样视为冲抵单。半天/全天假时长超限不会命中。
    """
    text = f"{leave.leave_type or ''} {leave.reason or ''}"
    minutes: int | None = None
    match = _LATE_OFFSET_MINUTES_PATTERN.search(text)
    if match:
        minutes = int(round(float(match.group(1))))
    else:
        hours_match = _LATE_OFFSET_HOURS_PATTERN.search(text)
        if hours_match:
            minutes = int(round(float(hours_match.group(1)) * 60))
        else:
            cn_match = _LATE_OFFSET_CN_HOURS_PATTERN.search(text)
            if cn_match:
                minutes = int(round(_CN_HOUR_VALUES[cn_match.group(1)] * 60))
    if minutes is None:
        start = getattr(leave, "start_time", None)
        end = getattr(leave, "end_time", None)
        if start and end and start.date() == end.date():
            span = int(round((end - start).total_seconds() / 60))
            if 0 < span <= LATE_OFFSET_MAX_MINUTES:
                minutes = span
    if minutes is not None and 0 < minutes <= LATE_OFFSET_MAX_MINUTES:
        return minutes
    return None


def _leave_offsets_by_employee(employee_ids: list[int], month: str) -> dict[int, dict[date, int]]:
    """{emp_id: {日期: 当日冲抵分钟合计}}，无冲抵单的员工不占键。"""
    result: dict[int, dict[date, int]] = {}
    for emp_id, leaves in _leave_rows_by_employee(employee_ids, month).items():
        for leave in leaves:
            minutes = late_offset_minutes(leave)
            if minutes is None or not leave.start_time:
                continue
            day = leave.start_time.date()
            buckets = result.setdefault(emp_id, {})
            buckets[day] = buckets.get(day, 0) + minutes
    return result


def _day_late_minutes(employee: Employee, view: object) -> int:
    """当日迟到分钟：管理人员按管理口径（打卡结果/迟到时长），普通员工按员工口径。"""
    if employee.is_manager:
        return manager_day_late_minutes(view)
    return int(view.late_minutes or 0)


def _late_views_by_employee(month: str, employees: list[Employee]) -> dict[int, list[object]]:
    """按员工类型选择考勤视图数据源：管理人员用管理口径，其余用员工口径。"""
    managers = [employee for employee in employees if employee.is_manager]
    staff = [employee for employee in employees if not employee.is_manager]
    views: dict[int, list[object]] = {}
    if managers:
        views.update(attendance_views_by_employee(month, managers, MANAGER_STATS_CONTEXT))
    if staff:
        views.update(attendance_views_by_employee(month, staff, EMPLOYEE_STATS_CONTEXT))
    return views


def _day_offset_target(
    employee: Employee,
    record_date: date,
    month: str,
    offsets: dict[date, int],
) -> tuple[int, int] | None:
    """校验某员工某日是否为有效冲抵目标，返回 (当日迟到, 当日冲抵)。

    条件与候选列表一致：哺乳期不算；无人工修正迟到；当日有迟到
    （无冲抵请假单的目标冲抵记 0，由页面编辑值决定）。
    """
    if employee.is_nursing:
        return None
    override = DailyAttendanceOverride.query.filter_by(
        emp_id=employee.id, record_date=record_date
    ).first()
    if override is not None and override.late_minutes is not None:
        return None
    views = _late_views_by_employee(month, [employee]).get(employee.id, [])
    view = next((item for item in views if item.record_date == record_date), None)
    if view is None:
        return None
    late = _day_late_minutes(employee, view)
    if late <= 0:
        return None
    return late, int(offsets.get(record_date, 0))


def late_offset_candidates(month: str, emp_ids: list[int] | None = None) -> list[dict[str, object]]:
    """管理人员当月所有迟到日的冲抵候选；emp_ids 为 None 查全部管理人员，空列表返回空。"""
    query = (
        Employee.query.filter(Employee.is_manager.is_(True), Employee.resigned_at.is_(None))
        .order_by(Employee.emp_no.asc(), Employee.name.asc())
    )
    if emp_ids is not None:
        if not emp_ids:
            return []
        query = query.filter(Employee.id.in_(emp_ids))
    employees = query.all()
    if not employees:
        return []
    employee_ids = [employee.id for employee in employees]
    views_by_employee = _late_views_by_employee(month, employees)
    offsets_by_employee = _leave_offsets_by_employee(employee_ids, month)
    overrides_by_employee = daily_override_maps(month, employee_ids)

    rows: list[dict[str, object]] = []
    for employee in employees:
        if employee.is_nursing:
            continue
        offsets = offsets_by_employee.get(employee.id, {})
        overrides = overrides_by_employee.get(employee.id, {})
        for view in views_by_employee.get(employee.id, []):
            day = view.record_date
            override = overrides.get(day)
            late = _day_late_minutes(employee, view)
            if late <= 0:
                continue
            if override is not None and override.late_minutes is not None:
                # 已有迟到修正：仅当修正来自迟到冲抵（remark 标记）时展示为已冲抵行，供清除
                if (override.remark or "").startswith(LATE_OFFSET_REMARK_PREFIX):
                    rows.append(
                        {
                            "emp_id": employee.id,
                            "emp_no": employee.emp_no,
                            "emp_name": employee.name,
                            "dept_name": employee.department.dept_name if employee.department else "",
                            "is_manager": bool(employee.is_manager),
                            "date": day.isoformat(),
                            "status": "confirmed",
                            "late_minutes": late,
                            "offset_minutes": max(0, late - int(override.late_minutes)),
                            "effective_late_minutes": int(override.late_minutes),
                            "override_late_minutes": int(override.late_minutes),
                        }
                    )
                continue
            offset = int(offsets.get(day, 0))
            rows.append(
                {
                    "emp_id": employee.id,
                    "emp_no": employee.emp_no,
                    "emp_name": employee.name,
                    "dept_name": employee.department.dept_name if employee.department else "",
                    "is_manager": bool(employee.is_manager),
                    "date": day.isoformat(),
                    "status": "pending",
                    "late_minutes": late,
                    "offset_minutes": offset,
                    "effective_late_minutes": max(0, late - offset),
                }
            )
    rows.sort(key=lambda row: (str(row["emp_no"]), str(row["date"])))
    return rows


def late_offset_leaves(emp_id: int, month: str) -> list[dict[str, object]]:
    """某员工在账套月的全部请假单（时间区间口径与冲抵候选一致），按开始时间排序。"""
    rows = _leave_rows_by_employee([emp_id], month).get(emp_id, [])
    return [
        {
            "leave_no": row.leave_no,
            "leave_type": row.leave_type,
            "start_time": row.start_time.strftime("%Y-%m-%d %H:%M") if row.start_time else "",
            "end_time": row.end_time.strftime("%Y-%m-%d %H:%M") if row.end_time else "",
            "duration": float(row.duration or 0),
            "approval_status": row.approval_status or "",
            "reason": row.reason or "",
        }
        for row in sorted(rows, key=lambda item: (item.start_time, item.leave_no))
    ]


def confirm_late_offset(
    emp_id: int,
    record_date: date,
    offset_minutes: int | None = None,
) -> dict[str, object]:
    """确认冲抵：把当日迟到分钟替换为 max(0, 迟到-冲抵)，写入逐日修正的 late_minutes。

    offset_minutes 为管理员在页面上编辑后的冲抵分钟（默认用请假单提取值），
    负数拒绝。仅更新 late_minutes 与空 remark，不触碰已有修正的其他字段。
    条件不满足时抛 ValueError（候选可能已过期）。
    只 flush 不 commit，由调用方（路由层）在同一事务内记录历史后统一提交。
    """
    employee = db.session.get(Employee, emp_id)
    if not employee or not employee.is_manager:
        raise ValueError("员工不存在或不是管理人员")
    month = record_date.strftime("%Y-%m")
    offsets = _leave_offsets_by_employee([emp_id], month).get(emp_id, {})
    target = _day_offset_target(employee, record_date, month, offsets)
    if target is None:
        raise ValueError("当日无可冲抵的迟到记录")

    late, offset = target
    if offset_minutes is not None:
        if offset_minutes < 0:
            raise ValueError("冲抵分钟不能为负数")
        offset = int(offset_minutes)

    override = DailyAttendanceOverride.query.filter_by(
        emp_id=emp_id, record_date=record_date
    ).first()
    if not override:
        override = DailyAttendanceOverride(emp_id=emp_id, record_date=record_date)
        db.session.add(override)
    override.late_minutes = max(0, late - offset)
    if not (override.remark or "").strip():
        override.remark = f"{LATE_OFFSET_REMARK_PREFIX}迟到{late}分钟-冲抵{offset}分钟"
    try:
        from flask import g

        current_user = getattr(g, "current_user", None)
    except RuntimeError:
        current_user = None
    if current_user is not None:
        override.updated_by = current_user.id
    db.session.flush()
    return {
        "emp_id": emp_id,
        "date": record_date.isoformat(),
        "late_minutes": override.late_minutes,
    }


def clear_late_offset(emp_id: int, record_date: date) -> dict[str, object]:
    """清除冲抵：清空当日修正的迟到分钟，迟到恢复系统原始值。

    仅作用于迟到冲抵写入的修正（remark 标记），人工修正拒绝清除。
    若清除后修正记录其余字段全空，则整条删除，不留孤儿记录。
    只 flush 不 commit，由调用方（路由层）在同一事务内记录历史后统一提交。
    """
    override = DailyAttendanceOverride.query.filter_by(
        emp_id=emp_id, record_date=record_date
    ).first()
    if (
        override is None
        or override.late_minutes is None
        or not (override.remark or "").startswith(LATE_OFFSET_REMARK_PREFIX)
    ):
        raise ValueError("当日没有可清除的迟到冲抵")

    override.late_minutes = None
    override.remark = ""
    other_fields = (
        override.status,
        override.is_evening_overtime,
        override.work_hours,
        override.early_leave_minutes,
    )
    if all(value is None for value in other_fields):
        db.session.delete(override)
    else:
        try:
            from flask import g

            current_user = getattr(g, "current_user", None)
        except RuntimeError:
            current_user = None
        if current_user is not None:
            override.updated_by = current_user.id
    db.session.flush()
    return {
        "emp_id": emp_id,
        "date": record_date.isoformat(),
        "late_minutes": None,
    }
