"""Synchronize STCard 考勤机 punches into the employee daily attendance payload."""

from __future__ import annotations

import calendar
import unicodedata
from collections import defaultdict
from datetime import date, datetime

from models import db
from models.account_set import AccountSet
from models.daily_record import DailyRecord
from models.dingtalk_sync_run import DingTalkSyncRun
from models.employee import Employee
from services.import_service import ImportService


CARD_SYNC_SOURCE = "card"


def _month_bounds(month: str) -> tuple[date, date]:
    start = datetime.strptime(month, "%Y-%m").date().replace(day=1)
    return start, start.replace(day=calendar.monthrange(start.year, start.month)[1])


def _normalized_emp_no(value) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).strip().casefold()


def _actual_hours(times: list[str]) -> float | None:
    """Pair alternating in/out punch times and sum the covered hours.

    考勤机按自然日存行，夜班的下班打卡会落在次日行里；跨零点的班次
    本日配对不足时按 0 计，工时以考勤计算口径为准，此处仅作参考值。
    """
    punches = []
    for text in times:
        try:
            punches.append(datetime.strptime(text, "%H:%M"))
        except ValueError:
            continue
    hours = sum(
        max(0.0, (out - inn).total_seconds())
        for inn, out in zip(punches[::2], punches[1::2])
    ) / 3600
    return round(hours, 2) if punches else None


def _employee_payload(employee: Employee, item: dict, record_date: date) -> dict:
    times = list(item.get("times") or [])
    check_in_times = times[::2]
    check_out_times = times[1::2]
    raw_data = {
        "人员编号": employee.emp_no.strip(),
        "人员名称": employee.name,
        "考勤日期": record_date.isoformat(),
        "card_person_no": str(item.get("person_no") or "").strip(),
        "card_dept_name": str(item.get("dept_name") or "").strip(),
    }
    if times:
        raw_data["刷卡时间数据"] = ",".join(times)
    return {
        "expected_hours": None,
        "actual_hours": _actual_hours(times),
        "absent_hours": None,
        "check_in_times": check_in_times,
        "check_out_times": check_out_times,
        "leave_hours": None,
        "leave_type": None,
        "overtime_hours": None,
        "overtime_type": None,
        "late_minutes": None,
        "early_leave_minutes": None,
        "exception_reason": None,
        "raw_data": raw_data,
    }


def _result(run: DingTalkSyncRun) -> dict:
    result = run.to_dict()
    if run.status == "partial":
        result["message"] = "考勤机考勤同步完成，存在未匹配记录"
    elif run.status == "failed":
        result["message"] = "考勤机考勤同步失败"
    else:
        result["message"] = "考勤机考勤同步成功"
    return result


def _failed_run(account_set_id: int, month: str, started_at: datetime, error: Exception) -> dict:
    db.session.rollback()
    run = DingTalkSyncRun(
        account_set_id=account_set_id,
        month=month,
        source=CARD_SYNC_SOURCE,
        status="failed",
        error_message=str(error),
        started_at=started_at,
        finished_at=datetime.utcnow(),
    )
    db.session.add(run)
    db.session.commit()
    return _result(run)


def sync_card_attendance(account_set_id: int, month: str, client) -> dict:
    """Fetch a month of card punches, upsert employee daily rows, and persist the run report."""
    from services.sync_progress_service import update_sync_progress

    started_at = datetime.utcnow()
    update_sync_progress(account_set_id, "employee", 5, "正在连接考勤机数据库并查询打卡记录...", "running")
    account_set = db.session.get(AccountSet, account_set_id)
    if account_set is None:
        update_sync_progress(account_set_id, "employee", 100, "账套不存在", "failed")
        raise ValueError("Account set does not exist")
    start_date, end_date = _month_bounds(month)

    employees = Employee.query.order_by(Employee.id).all()
    writable = [employee for employee in employees if ImportService._can_receive_employee_source(employee)]
    employees_by_no = {_normalized_emp_no(employee.emp_no): employee for employee in writable}
    employees_by_card = {
        str(employee.card_no).strip(): employee
        for employee in writable
        if employee.card_no and str(employee.card_no).strip()
    }
    # 未匹配报告只提示完全无法对应本地员工的工号；能对上但该员工
    # （如管理人员）不参与员工口径统计的，静默跳过即可。
    local_emp_nos = {_normalized_emp_no(employee.emp_no) for employee in employees if employee.emp_no}
    unmatched_by_key = {}

    try:
        records = list(client.attendance_records(start_date, end_date))
    except Exception as exc:
        update_sync_progress(account_set_id, "employee", 100, f"读取考勤机打卡记录失败: {exc}", "failed")
        return _failed_run(account_set_id, month, started_at, exc)

    total_records = len(records)
    update_sync_progress(
        account_set_id,
        "employee",
        20,
        f"读取到 {total_records} 条考勤机记录，正在匹配员工工号..." if total_records > 0 else "未查询到当月打卡记录",
        "running",
    )

    grouped = defaultdict(list)
    imported_count = 0
    step_records = max(1, total_records // 10) if total_records > 0 else 1
    try:
        for idx, item in enumerate(records):
            if total_records > 0 and (idx % step_records == 0 or idx == total_records - 1):
                pct = 20 + int(45 * (idx + 1) / total_records)
                update_sync_progress(
                    account_set_id,
                    "employee",
                    pct,
                    f"正在匹配员工工号与考勤记录 ({idx + 1}/{total_records})...",
                    "running",
                )
            record_date = item.get("record_date")
            if not isinstance(record_date, date):
                continue
            if not start_date <= record_date <= end_date:
                continue
            person_no = str(item.get("person_no") or "").strip()
            card_no = str(item.get("card_no") or "").strip()
            employee = employees_by_no.get(_normalized_emp_no(person_no))
            if employee is None and card_no:
                employee = employees_by_card.get(card_no)
            if employee is None:
                if _normalized_emp_no(person_no) in local_emp_nos:
                    continue
                detail = {
                    "emp_no": person_no,
                    "name": str(item.get("person_name") or "").strip(),
                    "record_date": record_date.isoformat(),
                }
                key = (_normalized_emp_no(person_no), detail["name"], detail["record_date"])
                unmatched_by_key.setdefault(key, detail)
                continue
            grouped[(employee.id, record_date)].append(item)
            imported_count += 1

        total_groups = len(grouped)
        update_sync_progress(
            account_set_id,
            "employee",
            68,
            f"正在比对已有每日考勤记录（共 {total_groups} 条日记录）...",
            "running",
        )

        existing = {}
        if grouped:
            employee_ids = {key[0] for key in grouped}
            rows = (
                DailyRecord.query.filter(DailyRecord.emp_id.in_(employee_ids))
                .filter(DailyRecord.record_date >= start_date, DailyRecord.record_date <= end_date)
                .all()
            )
            existing = {(row.emp_id, row.record_date): row for row in rows}
        employees_by_id = {employee.id: employee for employee in employees}

        step_groups = max(1, total_groups // 10) if total_groups > 0 else 1
        for g_idx, (key, daily_items) in enumerate(grouped.items()):
            if total_groups > 0 and (g_idx % step_groups == 0 or g_idx == total_groups - 1):
                pct = 70 + int(26 * (g_idx + 1) / total_groups)
                update_sync_progress(
                    account_set_id,
                    "employee",
                    pct,
                    f"正在写入员工每日考勤 ({g_idx + 1}/{total_groups})...",
                    "running",
                )
            employee_id, record_date = key
            row = existing.get(key)
            if row is None:
                row = DailyRecord(emp_id=employee_id, record_date=record_date)
                db.session.add(row)
            payload = _employee_payload(employees_by_id[employee_id], daily_items[0], record_date)
            # 覆盖 payload 拥有的全部列：来源切到考勤机后，Excel 导入残留的
            # 迟到/请假/加班等旧值必须一并清空，保持行与 payload 一致。
            row.shift_id = None
            row.expected_hours = payload["expected_hours"]
            row.actual_hours = payload["actual_hours"]
            row.absent_hours = payload["absent_hours"]
            row.check_in_times = payload["check_in_times"]
            row.check_out_times = payload["check_out_times"]
            row.leave_hours = payload["leave_hours"]
            row.leave_type = payload["leave_type"]
            row.overtime_hours = payload["overtime_hours"]
            row.overtime_type = payload["overtime_type"]
            row.late_minutes = payload["late_minutes"]
            row.early_leave_minutes = payload["early_leave_minutes"]
            row.exception_reason = payload["exception_reason"]
            row.raw_data = payload["raw_data"]
            row.employee_payload = payload

        unmatched = list(unmatched_by_key.values())
        run = DingTalkSyncRun(
            account_set_id=account_set_id,
            month=month,
            source=CARD_SYNC_SOURCE,
            status="partial" if unmatched else "success",
            read_count=len(records),
            imported_count=imported_count,
            unmatched_count=len(unmatched),
            unmatched=unmatched,
            started_at=started_at,
            finished_at=datetime.utcnow(),
        )
        db.session.add(run)
        db.session.commit()
        update_sync_progress(account_set_id, "employee", 100, "员工考勤同步完成", "finished")
        return _result(run)
    except Exception as exc:
        update_sync_progress(account_set_id, "employee", 100, f"员工考勤同步失败: {exc}", "failed")
        return _failed_run(account_set_id, month, started_at, exc)
