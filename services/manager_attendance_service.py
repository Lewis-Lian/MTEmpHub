from __future__ import annotations

import calendar
import math
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from models import db
from models.account_set import AccountSet
from models.employee import Employee
from models.leave import LeaveRecord
from models.manager_attendance_override import ManagerAttendanceOverride
from models.monthly_report import MonthlyReport
from models.manager_month_stat import ManagerMonthStat
from models.overtime import OvertimeRecord
from services.attendance_source_service import (
    MANAGER_STATS_CONTEXT,
    attendance_views_by_employee,
    selected_monthly_report_raw,
)
from sqlalchemy.orm import joinedload
from utils.helpers import overlap_duration_days


MANAGER_HEADERS = [
    "部   门",
    "员工编号",
    "姓名",
    "出勤天数",
    "实际出勤天数",
    "事/病假",
    "工伤",
    "出差",
    "婚假",
    "丧假",
    "迟到\\早退",
    "汇总",
    "福利天数",
    "加班变化",
    "备注",
]


def manager_headers(include_actual_attendance_days: bool = True, include_emp_no: bool = False) -> list[str]:
    headers = list(MANAGER_HEADERS)
    if not include_actual_attendance_days:
        headers = [h for h in headers if h != "实际出勤天数"]
    if not include_emp_no:
        headers = [h for h in headers if h != "员工编号"]
    return headers


def _month_date_range(month: str) -> tuple[date, date] | None:
    try:
        start = datetime.strptime(month, "%Y-%m").date().replace(day=1)
    except ValueError:
        return None
    if start.month == 12:
        return start, date(start.year + 1, 1, 1)
    return start, date(start.year, start.month + 1, 1)


def _month_datetime_range(month: str) -> tuple[datetime, datetime] | None:
    bounds = _month_date_range(month)
    if not bounds:
        return None
    start, end = bounds
    return datetime.combine(start, time.min), datetime.combine(end, time.min)


@dataclass
class ManagerAttendanceOptions:
    month: str
    factory_rest_days: float = 0.0
    monthly_benefit_days: float = 0.0


def _round2(value: float) -> float:
    return round(float(value or 0), 2)


def _float_value(value: object) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _int_value(value: object) -> int:
    return int(round(_float_value(value)))


def _raw_float(raw: dict, *keys: str) -> float | None:
    for key in keys:
        value = raw.get(key)
        if value not in (None, ""):
            return _float_value(value)
    return None


def _raw_minutes(raw: dict, *keys: str) -> int:
    return sum(_int_value(raw.get(key)) for key in keys)


def _manager_raw_score(raw: dict) -> int:
    score = 0
    for key in (
        "出勤天数",
        "工作时长",
        "迟到时长",
        "严重迟到时长",
        "早退时长",
        "出差时长",
        "请假/年假(天)",
        "请假/事假(小时)",
        "请假/病假(小时)",
        "请假/调休(小时)",
        "请假/婚假(天)",
        "请假/丧假(天)",
        "加班时长-按加班规则计算/工作日加班",
    ):
        if raw.get(key) not in (None, ""):
            score += 10
    score += sum(1 for value in raw.values() if value not in (None, ""))
    return score


def _month_days(month: str) -> int:
    year, month_no = [int(x) for x in month.split("-", 1)]
    return calendar.monthrange(year, month_no)[1]


def _stat_year_key(month: str) -> tuple[int, str]:
    year, month_no = [int(x) for x in month.split("-", 1)]
    return year, f"m{month_no}"


def normalize_days(value: float | int | None) -> float:
    """Convert decimal hours to days using the rule:
    <0.084 -> 0 days, >=0.084 and <0.209 -> 0.5 days, >=0.209 -> 1 day.
    """
    raw = float(value or 0)
    if raw <= 0:
        return 0.0

    integer = math.floor(raw)
    fraction = round(raw - integer, 5)

    # >= 0.209 means 1 day for this fraction
    if fraction >= 0.209:
        return float(integer + 1)
    # >= 0.084 and < 0.209 means 0.5 day
    if fraction >= 0.084:
        return float(integer) + 0.5
    # < 0.084 means 0 day
    return float(integer)


def _has_half_day_component(days: float) -> bool:
    return days > 0 and abs(days % 1 - 0.5) < 1e-9


def _leave_bucket(value: str | None) -> str:
    text = (value or "").strip()
    if "工伤" in text:
        return "injury"
    if "出差" in text:
        return "business_trip"
    if "婚" in text:
        return "marriage"
    if "丧" in text:
        return "funeral"
    if "补休" in text or "调休" in text:
        return "time_off"
    if "事假" in text or "病假" in text or "请假" in text:
        return "personal_sick"
    return ""


def _monthly_report_raw(employee: Employee, month: str) -> dict:
    raw = selected_monthly_report_raw(employee, month, MANAGER_STATS_CONTEXT)
    if raw:
        return raw

    fallback_rows = (
        MonthlyReport.query.filter_by(emp_id=employee.id, report_month="1970-01")
        .filter(MonthlyReport.manager_raw_data.isnot(None))
        .all()
    )
    fallback_candidates = [
        row.manager_raw_data
        for row in fallback_rows
        if isinstance(row.manager_raw_data, dict) and "出勤天数" in row.manager_raw_data
    ]
    if fallback_candidates:
        return max(fallback_candidates, key=_manager_raw_score)
    return {}


def _leave_rows_by_employee(employee_ids: list[int], month: str) -> dict[int, list[LeaveRecord]]:
    if not employee_ids:
        return {}
    datetime_range = _month_datetime_range(month)
    if not datetime_range:
        return {employee_id: [] for employee_id in employee_ids}
    start_dt, end_dt = datetime_range
    rows = (
        LeaveRecord.query.filter(LeaveRecord.emp_id.in_(employee_ids))
        .filter(LeaveRecord.start_time < end_dt, LeaveRecord.end_time > start_dt)
        .all()
    )
    rows_by_employee = {employee_id: [] for employee_id in employee_ids}
    for row in rows:
        rows_by_employee.setdefault(row.emp_id, []).append(row)
    return rows_by_employee


def _overtime_rows_by_employee(employee_ids: list[int], month: str) -> dict[int, list[OvertimeRecord]]:
    if not employee_ids:
        return {}
    datetime_range = _month_datetime_range(month)
    if not datetime_range:
        return {employee_id: [] for employee_id in employee_ids}
    start_dt, end_dt = datetime_range
    rows = (
        OvertimeRecord.query.filter(OvertimeRecord.emp_id.in_(employee_ids))
        .filter(OvertimeRecord.start_time >= start_dt, OvertimeRecord.start_time < end_dt)
        .all()
    )
    rows_by_employee = {employee_id: [] for employee_id in employee_ids}
    for row in rows:
        rows_by_employee.setdefault(row.emp_id, []).append(row)
    return rows_by_employee


def _leave_days_in_month(leave: LeaveRecord, month: str) -> float:
    datetime_range = _month_datetime_range(month)
    if not datetime_range:
        return 0.0
    start_dt, end_dt = datetime_range
    return overlap_duration_days(leave.start_time, leave.end_time, start_dt, end_dt)


def _factory_rest_periods_by_date(month: str) -> dict[date, set[str]]:
    account_set = AccountSet.query.filter_by(month=month).first()
    if not account_set:
        return {}

    periods_by_date: dict[date, set[str]] = {}
    for entry in account_set.factory_rest_entries:
        periods = periods_by_date.setdefault(entry.rest_date, set())
        if entry.rest_period == "full":
            periods.update({"am", "pm"})
        elif entry.rest_period in {"am", "pm"}:
            periods.add(entry.rest_period)
    return periods_by_date


def _day_periods_covered(start_dt: datetime, end_dt: datetime, day: date) -> set[str]:
    day_start = datetime.combine(day, time.min)
    noon = datetime.combine(day, time(hour=12))
    next_day_start = datetime.combine(day + timedelta(days=1), time.min)
    covered: set[str] = set()

    if start_dt < noon and end_dt > day_start:
        covered.add("am")
    if start_dt < next_day_start and end_dt > noon:
        covered.add("pm")
    return covered


def _factory_rest_overlap_days(leave: LeaveRecord, periods_by_date: dict[date, set[str]]) -> float:
    if not periods_by_date:
        return 0.0

    overlap_days = 0.0
    for rest_date, rest_periods in periods_by_date.items():
        leave_periods = _day_periods_covered(leave.start_time, leave.end_time, rest_date)
        overlap_days += 0.5 * len(rest_periods & leave_periods)
    return _round2(overlap_days)


def _factory_rest_days_from_periods(periods_by_date: dict[date, set[str]]) -> float:
    return _round2(sum(0.5 * len(periods) for periods in periods_by_date.values()))


def _manager_month_stats_by_employee(employee_ids: list[int], month: str) -> dict[tuple[int, str], ManagerMonthStat]:
    if not employee_ids:
        return {}
    year, _key = _stat_year_key(month)
    rows = (
        ManagerMonthStat.query.filter(ManagerMonthStat.emp_id.in_(employee_ids))
        .filter(ManagerMonthStat.year == year)
        .filter(ManagerMonthStat.stat_type.in_(("overtime", "annual_leave")))
        .all()
    )
    return {(row.emp_id, row.stat_type): row for row in rows}


def _stat_remaining_from_row(stat_type: str, row: ManagerMonthStat | None) -> float:
    if not row:
        return 12.0 if stat_type == "annual_leave" else 0.0
    return _round2(row.remaining or 0)


def _write_manager_month_stat(stat_type: str, emp_id: int, month: str, used_days: float, sync_all_months: bool = True) -> None:
    """Write the computed used_days back to the ManagerMonthStat for the given month.
    - For annual_leave: positive = used (consumed from remaining).
    - For overtime: positive = overtime earned, negative = used (consumed from remaining).
    When sync_all_months=True, also recalculates remaining across all months.
    """
    year, key = _stat_year_key(month)
    row = ManagerMonthStat.query.filter_by(emp_id=emp_id, year=year, stat_type=stat_type).first()
    if not row:
        row = ManagerMonthStat(emp_id=emp_id, year=year, stat_type=stat_type)
        db.session.add(row)

    if stat_type == "annual_leave":
        row.prev_dec = 0

    # Set the current month's value
    setattr(row, key, _round2(used_days))

    if sync_all_months:
        _recalc_remaining(row, stat_type)

    db.session.flush()


def _recalc_remaining(row: ManagerMonthStat, stat_type: str) -> None:
    """Recalculate remaining for a stat row based on all month values."""
    value_keys = _annual_leave_value_keys() if stat_type == "annual_leave" else _month_value_keys()
    total = sum(_float_value(getattr(row, key)) for key in value_keys)
    if stat_type == "annual_leave":
        row.remaining = _round2(12 - total)
    else:
        row.remaining = _round2(total)


def _annual_leave_value_keys() -> list[str]:
    return [f"m{m}" for m in range(1, 13)]


def _month_value_keys() -> list[str]:
    return ["prev_dec", *[f"m{m}" for m in range(1, 13)]]


def _compute_overtime_used_from_row(row: ManagerMonthStat | None, month: str) -> float:
    if not row:
        return 0.0

    _year, key = _stat_year_key(month)
    current = _float_value(getattr(row, key))
    remaining = _round2(_stat_remaining_from_row("overtime", row) - current)
    if remaining <= 0:
        return 0.0
    return min(remaining, 5.0)


def _compute_benefit_used_from_row(
    row: ManagerMonthStat | None,
    month: str,
    factory_rest_days: float,
) -> float:
    if not row:
        return 0.0

    _year, key = _stat_year_key(month)
    current = _float_value(getattr(row, key))
    remaining = _round2(_stat_remaining_from_row("annual_leave", row) + current)
    if remaining <= 0:
        return 0.0

    available = min(remaining, 3.0)
    max_benefit_for_rest = _round2(7.0 - factory_rest_days)
    if max_benefit_for_rest < 0:
        max_benefit_for_rest = 0.0
    return min(available, max_benefit_for_rest)


OVERRIDE_FIELDS = (
    "attendance_days",
    "injury_days",
    "business_trip_days",
    "marriage_days",
    "funeral_days",
    "late_early_minutes",
)


def _override_values(override: ManagerAttendanceOverride | None) -> dict[str, float | int | None]:
    return {field: getattr(override, field) if override else None for field in OVERRIDE_FIELDS}


def _override_rows_by_employee(employee_ids: list[int], month: str) -> dict[int, ManagerAttendanceOverride]:
    if not employee_ids:
        return {}
    rows = (
        ManagerAttendanceOverride.query.filter(ManagerAttendanceOverride.emp_id.in_(employee_ids))
        .filter(ManagerAttendanceOverride.month == month)
        .all()
    )
    return {row.emp_id: row for row in rows}


def _apply_override_value(value: float | int, override_value: float | int | None, as_int: bool = False) -> float | int:
    if override_value is None:
        return value
    if as_int:
        return int(round(float(override_value or 0)))
    return _round2(float(override_value or 0))


_MANAGER_PUNCH_TIME_KEYS = (
    "上班1打卡时间",
    "下班1打卡时间",
    "上班2打卡时间",
    "下班2打卡时间",
    "上班3打卡时间",
    "下班3打卡时间",
    "上班4打卡时间",
    "下班4打卡时间",
)


def _has_manager_punch_record(record) -> bool:
    raw = record.raw_data if isinstance(record.raw_data, dict) else {}
    punch_data = str(raw.get("刷卡时间数据") or "").strip()
    if punch_data:
        return True
    return any(str(raw.get(key) or "").strip() for key in _MANAGER_PUNCH_TIME_KEYS)


def _manager_attendance_days_from_views(rows: list[object]) -> float:
    return _round2(sum(1 for row in rows if _has_manager_punch_record(row)))


def _manager_schedule_late_minutes_from_views(employee: Employee, rows: list[object]) -> int:
    if employee.is_nursing:
        return 0

    total = 0
    for row in rows:
        raw = row.raw_data if isinstance(row.raw_data, dict) else {}
        nested_raw = raw.get("raw_data") if isinstance(raw.get("raw_data"), dict) else {}
        result = str(raw.get("上班1打卡结果") or nested_raw.get("上班1打卡结果") or "")
        if "迟到" not in result:
            continue
        day_minutes = (
            _raw_minutes(raw, "迟到时长", "严重迟到时长")
            or _raw_minutes(nested_raw, "迟到时长", "严重迟到时长")
            or int(row.late_minutes or 0)
        )
        if day_minutes >= 30:
            continue
        total += day_minutes
    return total


def build_manager_rows(
    options: ManagerAttendanceOptions,
    emp_ids: list[int] | None = None,
    include_overrides: bool = True,
    sync_month_stats: bool = False,
) -> list[dict[str, object]]:
    """计算管理人员月度考勤及扣薪。

    各类假期扣薪规则：
    - 计入「出勤天数」（不扣薪）：出差、婚假、丧假。
    - 不计入「出勤天数」（扣薪，等同普通缺勤）：工伤、事/病假、调休。
      其中工伤不计入出勤天数，会扩大扣薪缺口，并按「加班额度 → 年假额度 → 事/病假」
      顺序扣减；厂休重叠不减免工伤天数。
    """
    query = Employee.query.options(joinedload(Employee.department)).filter(Employee.is_manager.is_(True))
    if emp_ids is not None:
        if not emp_ids:
            return []
        query = query.filter(Employee.id.in_(emp_ids))
    employees = query.order_by(Employee.dept_id.asc(), Employee.emp_no.asc(), Employee.name.asc()).all()
    rows: list[dict[str, object]] = []
    month_days = _month_days(options.month)
    employee_ids = [employee.id for employee in employees]
    attendance_rows_by_employee = attendance_views_by_employee(options.month, employees, MANAGER_STATS_CONTEXT)
    leave_rows_by_employee = _leave_rows_by_employee(employee_ids, options.month)
    overtime_rows_by_employee = _overtime_rows_by_employee(employee_ids, options.month)
    override_rows_by_employee = _override_rows_by_employee(employee_ids, options.month) if include_overrides else {}
    month_stats_by_employee = _manager_month_stats_by_employee(employee_ids, options.month)
    factory_rest_periods_by_date = _factory_rest_periods_by_date(options.month)
    factory_rest_days = _factory_rest_days_from_periods(factory_rest_periods_by_date)
    # 日期级厂休重叠只能以账套厂休明细为准。
    # 若当月没有账套或没有厂休明细，则无法判断具体重叠日期，本次计算不做重叠扣减。
    can_subtract_factory_rest_overlap = bool(factory_rest_periods_by_date)

    for employee in employees:
        raw = _monthly_report_raw(employee, options.month)
        raw_attendance_days = _raw_float(raw, "出勤天数")
        attendance_rows = attendance_rows_by_employee.get(employee.id, [])

        late_early_minutes = _manager_schedule_late_minutes_from_views(employee, attendance_rows)

        # Accumulate leave record days by category
        half_leave_days = 0.0
        half_time_off_days = 0.0
        half_overtime_days = 0.0
        injury_days = 0.0
        business_trip_days = 0.0
        marriage_days = 0.0
        funeral_days = 0.0

        for leave in leave_rows_by_employee.get(employee.id, []):
            bucket = _leave_bucket(leave.leave_type)
            days = normalize_days(_leave_days_in_month(leave, options.month))
            if can_subtract_factory_rest_overlap and bucket in {"business_trip", "marriage", "funeral"}:
                overlap_days = _factory_rest_overlap_days(leave, factory_rest_periods_by_date)
                days = max(_round2(days - overlap_days), 0.0)
            if bucket == "injury":
                injury_days += days
            elif bucket == "business_trip":
                business_trip_days += days
            elif bucket == "marriage":
                marriage_days += days
            elif bucket == "funeral":
                funeral_days += days
            elif bucket == "personal_sick" and _has_half_day_component(days):
                half_leave_days += 0.5
            elif bucket == "time_off" and _has_half_day_component(days):
                half_time_off_days += 0.5
        for overtime in overtime_rows_by_employee.get(employee.id, []):
            days = normalize_days(overtime.effective_hours)
            if _has_half_day_component(days):
                half_overtime_days += 0.5

        base_attendance_days = (
            raw_attendance_days
            if raw_attendance_days is not None
            else _manager_attendance_days_from_views(attendance_rows)
        )

        # 实际出勤天数 = 月报出勤天数(失败时按刷卡天数兜底) - 请假半天的天数 - 调休半天的天数 - 加班半天的天数
        actual_attendance_days = _round2(
            base_attendance_days - half_leave_days - half_time_off_days - half_overtime_days
        )
        # 出勤天数 = 实际出勤天数 + 出差 + 婚假 + 丧假
        attendance_days = _round2(
            actual_attendance_days + business_trip_days + marriage_days + funeral_days
        )

        override = override_rows_by_employee.get(employee.id)
        override_data = _override_values(override)
        injury_days = _apply_override_value(injury_days, override_data["injury_days"])
        business_trip_days = _apply_override_value(business_trip_days, override_data["business_trip_days"])
        marriage_days = _apply_override_value(marriage_days, override_data["marriage_days"])
        funeral_days = _apply_override_value(funeral_days, override_data["funeral_days"])
        late_early_minutes = _apply_override_value(
            late_early_minutes,
            override_data["late_early_minutes"],
            as_int=True,
        )
        if override_data["attendance_days"] is not None:
            attendance_days = _round2(float(override_data["attendance_days"] or 0))
            actual_attendance_days = _round2(
                attendance_days - business_trip_days - marriage_days - funeral_days
            )
        else:
            attendance_days = _round2(
                actual_attendance_days + business_trip_days + marriage_days + funeral_days
            )

        # 事/病假 = 需要扣除工资的天数
        # 出勤天数已包含出差、婚假、丧假；缺口不再重复扣婚丧假。
        absence_gap = _round2(
            month_days
            - attendance_days
            - factory_rest_days
        )

        if absence_gap < 0:
            # 出勤天数 + 厂休 + 婚假 + 丧假 > 本月天数 → 本月有加班！
            overtime_earned = _round2(abs(absence_gap))
            used_overtime = 0.0
            used_benefit = 0.0
            personal_sick_days = 0.0
            overtime_change = overtime_earned
            if sync_month_stats:
                _write_manager_month_stat("overtime", employee.id, options.month, overtime_earned)
                _write_manager_month_stat("annual_leave", employee.id, options.month, used_benefit)
        else:
            overtime_earned = 0.0

            # Step 1: use overtime days (from remaining balance, max 5)
            available_overtime = _compute_overtime_used_from_row(
                month_stats_by_employee.get((employee.id, "overtime")),
                options.month,
            )
            overtime_for_deduction = min(absence_gap, available_overtime) if absence_gap > 0 else 0.0
            used_overtime = _round2(overtime_for_deduction)

            # Step 2: use benefit days (annual leave, from remaining, with constraints)
            remaining_after_overtime = _round2(max(absence_gap - used_overtime, 0.0))
            available_benefit = _compute_benefit_used_from_row(
                month_stats_by_employee.get((employee.id, "annual_leave")),
                options.month,
                factory_rest_days,
            )
            benefit_for_deduction = min(remaining_after_overtime, available_benefit) if remaining_after_overtime > 0 else 0.0
            used_benefit = _round2(benefit_for_deduction)

            # Step 3: anything left is 事/病假 (deductible)
            personal_sick_days = _round2(max(remaining_after_overtime - used_benefit, 0.0))

            if sync_month_stats:
                _write_manager_month_stat("overtime", employee.id, options.month, -used_overtime)
                _write_manager_month_stat("annual_leave", employee.id, options.month, used_benefit)

            # 加班变化 = 使用了剩余加班天数用负数表示
            overtime_change = -used_overtime if used_overtime > 0 else 0.0

        # 汇总 = 扣除天数 + 迟到罚款(1元/分钟)
        summary_parts: list[str] = []
        if personal_sick_days > 0:
            summary_parts.append(f"扣{personal_sick_days:g}天")
        if late_early_minutes > 0:
            summary_parts.append(f"{late_early_minutes}元")

        # 备注
        remark_parts: list[str] = []
        if late_early_minutes > 0:
            remark_parts.append("迟到")
        if injury_days > 0:
            remark_parts.append(f"工伤{injury_days:g}天")

        rows.append(
            {
                "emp_id": employee.id,
                "dept_name": employee.department.dept_name if employee.department else "",
                "emp_no": employee.emp_no,
                "name": employee.name,
                "attendance_days": attendance_days,
                "actual_attendance_days": actual_attendance_days,
                "personal_sick_days": personal_sick_days,
                "injury_days": _round2(injury_days),
                "business_trip_days": _round2(business_trip_days),
                "marriage_days": _round2(marriage_days),
                "funeral_days": _round2(funeral_days),
                "late_early_minutes": late_early_minutes,
                "summary": "，".join(summary_parts),
                "benefit_days": used_benefit,
                "overtime_change": overtime_change,
                "remark": "，".join(remark_parts),
            }
        )

    return rows


def rows_as_table(rows: list[dict[str, object]], include_actual_attendance_days: bool = True, include_emp_no: bool = False) -> list[list[object]]:
    table_rows = []
    for row in rows:
        item = [row.get("dept_name", "")]
        if include_emp_no:
            item.append(row.get("emp_no", ""))
        item.append(row.get("name", ""))
        item.append(row.get("attendance_days", 0))
        if include_actual_attendance_days:
            item.append(row.get("actual_attendance_days", 0))
        item.extend([
            row.get("personal_sick_days", 0),
            row.get("injury_days", 0),
            row.get("business_trip_days", 0),
            row.get("marriage_days", 0),
            row.get("funeral_days", 0),
            row.get("late_early_minutes", 0),
            row.get("summary", ""),
            row.get("benefit_days", 0),
            row.get("overtime_change", 0),
            row.get("remark", ""),
        ])
        table_rows.append(item)
    return table_rows
