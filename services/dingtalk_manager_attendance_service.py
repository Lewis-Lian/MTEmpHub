"""Synchronize DingTalk punch records into the manager attendance payload."""

from __future__ import annotations

import calendar
import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timezone, timedelta

from models import db
from models.account_set import AccountSet
from models.daily_record import DailyRecord
from models.dingtalk_sync_run import DingTalkSyncRun
from models.employee import Employee


_RESULT_LABELS = {
    "Normal": "正常",
    "Late": "迟到",
    "SeriousLate": "严重迟到",
    "Early": "早退",
    "EarlyLeave": "早退",
    "Absenteeism": "旷工迟到",
    "Absence": "旷工",
    "Absent": "旷工",
    "NotSigned": "缺卡",
}


_DINGTALK_CONFIG_ERROR = "钉钉配置缺失，请检查 DINGTALK_CLIENT_ID、DINGTALK_CLIENT_SECRET 和 DINGTALK_CORP_ID"
_DINGTALK_SENSITIVE_FIELDS = (
    r"client[_ -]?(?:secret|id)|app[_ -]?(?:secret|key)|"
    r"access[_ -]?token|corp[_ -]?(?:secret|id)|token|secret|password"
)


def sanitize_dingtalk_error(error: Exception | str | None) -> str:
    """Return an actionable sync error without exposing credential values."""
    message = str(error or "").strip()
    normalized = message.casefold()
    if "configuration is missing" in normalized:
        return _DINGTALK_CONFIG_ERROR
    if "token request returned an error" in normalized:
        return "钉钉认证失败，请检查应用配置和权限"
    if "token response was invalid" in normalized:
        return "钉钉认证响应无效，请检查应用配置"
    if "attendance request returned an error" in normalized:
        return "钉钉考勤接口请求失败，请检查应用权限"
    if "directory request returned an error" in normalized:
        return "钉钉通讯录接口请求失败，请检查应用的通讯录读取权限"
    if "dingtalk request failed" in normalized:
        return "钉钉请求失败，请检查配置、权限和网络后重试"
    if not message:
        return "钉钉同步失败，请查看服务端日志后重试"

    # Keep useful non-secret context while removing credential-shaped values
    # from older persisted runs and unexpected client exceptions.
    sanitized = re.sub(
        rf"(?i)([\"'](?:{_DINGTALK_SENSITIVE_FIELDS})[\"']\s*:\s*)(\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*')",
        r'\1"[REDACTED]"',
        message,
    )
    sanitized = re.sub(
        rf"(?i)(\b(?:{_DINGTALK_SENSITIVE_FIELDS})\b\s*[:=]\s*)(?:\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|[^\s,;}}]+)",
        r"\1[REDACTED]",
        sanitized,
    )
    return sanitized or "钉钉同步失败，请查看服务端日志后重试"


def _month_bounds(month: str) -> tuple[date, date]:
    start = datetime.strptime(month, "%Y-%m").date().replace(day=1)
    return start, start.replace(day=calendar.monthrange(start.year, start.month)[1])


def _normalized_emp_no(value) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).strip().casefold()


def _record_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def _punch_datetime(value, record_date: date) -> datetime | None:
    if value in (None, "", 0, "0"):
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, (int, float)):
        return (datetime.fromtimestamp(value / 1000, timezone.utc) + timedelta(hours=8)).replace(tzinfo=None)
    text = str(value).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%H:%M:%S", "%H:%M"):
        try:
            parsed = datetime.strptime(text[:19], fmt)
            if fmt.startswith("%H"):
                return datetime.combine(record_date, parsed.time())
            return parsed
        except ValueError:
            continue
    match = re.search(r"(\d{1,2}):(\d{2})", text)
    if match:
        return datetime.combine(record_date, datetime.strptime(f"{match.group(1)}:{match.group(2)}", "%H:%M").time())
    return None


def _punch_text(value, record_date: date) -> str:
    parsed = _punch_datetime(value, record_date)
    return parsed.strftime("%H:%M") if parsed else str(value or "").strip()


def _record_name(record: dict) -> str:
    raw = record.get("raw_payload")
    raw = raw if isinstance(raw, dict) else {}
    return str(
        record.get("employee_name")
        or record.get("name")
        or raw.get("userName")
        or raw.get("employeeName")
        or raw.get("name")
        or ""
    ).strip()


def _result_label(record: dict) -> str | None:
    value = record.get("result") or record.get("time_result")
    if value in (None, ""):
        return None
    return _RESULT_LABELS.get(str(value), str(value))


def _normalized_punches(record: dict) -> dict:
    normalized = dict(record)
    raw = record.get("raw_payload")
    raw = raw if isinstance(raw, dict) else {}
    result = record.get("time_result") or record.get("result") or raw.get("timeResult")
    for key in ("punch_in", "punch_out"):
        if result == "NotSigned" or normalized.get(key) in (None, "", 0, "0"):
            normalized[key] = None
    return normalized


def _duration_minutes(record: dict, kind: str, record_date: date) -> int:
    raw = record.get("raw_payload")
    raw = raw if isinstance(raw, dict) else {}
    if (record.get("time_result") or record.get("result") or raw.get("timeResult")) == "NotSigned":
        return 0
    check_type = raw.get("checkType")
    is_matching_slot = (
        record.get("punch_in") not in (None, "") or check_type == "OnDuty"
        if kind == "late"
        else record.get("punch_out") not in (None, "") or check_type == "OffDuty"
    )
    if not is_matching_slot:
        return 0

    direct_key = "late_minutes" if kind == "late" else "early_leave_minutes"
    direct = record.get(direct_key)
    if direct not in (None, ""):
        try:
            return max(0, int(round(float(direct))))
        except (TypeError, ValueError):
            pass

    raw_keys = ("lateMinutes", "lateMinute") if kind == "late" else ("earlyMinutes", "earlyMinute")
    for key in raw_keys:
        if raw.get(key) not in (None, ""):
            try:
                return max(0, int(round(float(raw[key]))))
            except (TypeError, ValueError):
                pass

    actual = _punch_datetime(raw.get("userCheckTime"), record_date)
    expected = _punch_datetime(raw.get("baseCheckTime"), record_date)
    if actual and expected:
        delta = actual - expected if kind == "late" else expected - actual
        return max(0, int(delta.total_seconds() // 60))
    return 1 if record.get(f"is_{kind}" if kind == "late" else "is_early_leave") else 0


def _actual_hours(records: list[dict], record_date: date) -> float:
    slots = {"OnDuty": [], "OffDuty": []}
    for item in records:
        raw = item.get("raw_payload")
        raw = raw if isinstance(raw, dict) else {}
        expected = _punch_datetime(raw.get("baseCheckTime"), record_date)
        for check_type, key in (("OnDuty", "punch_in"), ("OffDuty", "punch_out")):
            actual = _punch_datetime(item.get(key), record_date)
            if actual is not None or raw.get("checkType") == check_type:
                slots[check_type].append((expected or actual or datetime.max, actual))
    ins = [actual for _, actual in sorted(slots["OnDuty"], key=lambda slot: slot[0])]
    outs = [actual for _, actual in sorted(slots["OffDuty"], key=lambda slot: slot[0])]
    hours = sum(
        max(0, (end - start).total_seconds())
        for start, end in zip(ins, outs)
        if start is not None and end is not None
    ) / 3600
    return round(hours, 2)


def _manager_payload(records: list[dict], employee: Employee, record_date: date) -> dict:
    check_ins = [_punch_text(item.get("punch_in"), record_date) for item in records if item.get("punch_in") not in (None, "")]
    check_outs = [_punch_text(item.get("punch_out"), record_date) for item in records if item.get("punch_out") not in (None, "")]
    raw_records = [item.get("raw_payload") for item in records if isinstance(item.get("raw_payload"), dict)]
    raw_data = {}
    for raw_record in raw_records:
        for key, value in raw_record.items():
            raw_data.setdefault(key, value)
    raw_data.update(
        {
            "日期": record_date.isoformat(),
            "工号": employee.emp_no.strip(),
            "姓名": employee.name,
            "dingtalk_records": raw_records,
        }
    )
    punches = [*check_ins, *check_outs]
    if punches:
        raw_data["刷卡时间数据"] = ",".join(punches)
    for index, item in enumerate((item for item in records if item.get("punch_in") not in (None, "")), start=1):
        raw_data[f"上班{index}打卡时间"] = _punch_text(item["punch_in"], record_date)
        raw_data[f"上班{index}打卡结果"] = _result_label(item)
    for index, item in enumerate((item for item in records if item.get("punch_out") not in (None, "")), start=1):
        raw_data[f"下班{index}打卡时间"] = _punch_text(item["punch_out"], record_date)
        raw_data[f"下班{index}打卡结果"] = _result_label(item)

    exceptions = []
    for item in records:
        time_result = str(item.get("time_result") or "")
        location_result = str(item.get("location_result") or "")
        if time_result and time_result != "Normal":
            exceptions.append(time_result)
        if location_result and location_result != "Normal":
            exceptions.append(location_result)
    return {
        "actual_hours": _actual_hours(records, record_date),
        "late_minutes": sum(_duration_minutes(item, "late", record_date) for item in records),
        "early_leave_minutes": sum(_duration_minutes(item, "early", record_date) for item in records),
        "check_in_times": check_ins,
        "check_out_times": check_outs,
        "exception_reason": ", ".join(dict.fromkeys(exceptions)) or None,
        "raw_data": raw_data,
    }


def _result(run: DingTalkSyncRun) -> dict:
    result = run.to_dict()
    if run.status == "partial":
        result["message"] = "DingTalk attendance synchronized with unmatched records"
    elif run.status == "failed":
        result["message"] = "DingTalk attendance synchronization failed"
    else:
        result["message"] = "DingTalk attendance synchronized"
    return result


def _failed_run(account_set_id: int, month: str, started_at: datetime, error: Exception) -> dict:
    db.session.rollback()
    run = DingTalkSyncRun(
        account_set_id=account_set_id,
        month=month,
        status="failed",
        error_message=str(error),
        started_at=started_at,
        finished_at=datetime.utcnow(),
    )
    db.session.add(run)
    db.session.commit()
    return _result(run)


def sync_dingtalk_manager_attendance(account_set_id: int, month: str, client) -> dict:
    """Fetch a month of manager punches, upsert daily rows, and persist the run report."""
    started_at = datetime.utcnow()
    account_set = db.session.get(AccountSet, account_set_id)
    if account_set is None:
        raise ValueError("Account set does not exist")
    start_date, end_date = _month_bounds(month)
    managers = Employee.query.filter_by(is_manager=True).order_by(Employee.id).all()
    user_ids = list(dict.fromkeys(str(employee.dingtalk_user_id).strip() for employee in managers if employee.dingtalk_user_id and str(employee.dingtalk_user_id).strip()))
    employees_by_no = {_normalized_emp_no(employee.emp_no): employee for employee in managers}
    employees_by_user_id = {
        str(employee.dingtalk_user_id).strip(): employee
        for employee in managers
        if employee.dingtalk_user_id and str(employee.dingtalk_user_id).strip()
    }
    unmatched_by_key = {}

    try:
        if any(not employee.dingtalk_user_id or not str(employee.dingtalk_user_id).strip() for employee in managers):
            # 匹配范围是全量员工工号：通讯录里对应本系统任意员工的条目都不是"未匹配"，
            # 否则整个组织会被灌进未匹配报告，只有无法对应任何本地员工的工号才需要提醒。
            local_emp_nos = {
                _normalized_emp_no(emp_no)
                for (emp_no,) in db.session.query(Employee.emp_no).all()
                if emp_no
            }
            for directory_user in client.directory_users():
                normalized_no = _normalized_emp_no(directory_user.get("employee_no"))
                employee = employees_by_no.get(normalized_no)
                user_id = str(directory_user.get("employee_user_id") or "").strip()
                if employee is None:
                    if normalized_no in local_emp_nos:
                        continue
                    detail = {
                        "emp_no": str(directory_user.get("employee_no") or "").strip(),
                        "name": _record_name(directory_user),
                        "record_date": "",
                    }
                    key = (_normalized_emp_no(detail["emp_no"]), detail["name"], "")
                    unmatched_by_key.setdefault(key, detail)
                    continue
                if not user_id:
                    continue
                employees_by_user_id[user_id] = employee
                if not employee.dingtalk_user_id or not str(employee.dingtalk_user_id).strip():
                    user_ids.append(user_id)
        user_ids = list(dict.fromkeys(user_ids))
        records = list(client.attendance_records(user_ids, start_date, end_date))
    except Exception as exc:
        return _failed_run(account_set_id, month, started_at, exc)

    grouped = defaultdict(list)
    imported_count = 0
    try:
        for raw_item in records:
            item = _normalized_punches(raw_item)
            record_date = _record_date(item.get("date"))
            if not start_date <= record_date <= end_date:
                continue
            emp_no = str(item.get("employee_no") or "").strip()
            employee = employees_by_no.get(_normalized_emp_no(emp_no))
            if employee is None and not _normalized_emp_no(emp_no):
                employee = employees_by_user_id.get(str(item.get("employee_user_id") or "").strip())
            if employee is None:
                detail = {
                    "emp_no": emp_no,
                    "name": _record_name(item),
                    "record_date": record_date.isoformat(),
                }
                key = (_normalized_emp_no(emp_no), detail["name"], detail["record_date"])
                unmatched_by_key.setdefault(key, detail)
                continue
            grouped[(employee.id, record_date)].append(item)
            imported_count += 1

        existing = {}
        if grouped:
            employee_ids = {key[0] for key in grouped}
            rows = (
                DailyRecord.query.filter(DailyRecord.emp_id.in_(employee_ids))
                .filter(DailyRecord.record_date >= start_date, DailyRecord.record_date <= end_date)
                .all()
            )
            existing = {(row.emp_id, row.record_date): row for row in rows}
        managers_by_id = {employee.id: employee for employee in managers}
        for key, daily_items in grouped.items():
            employee_id, record_date = key
            row = existing.get(key)
            if row is None:
                row = DailyRecord(emp_id=employee_id, record_date=record_date)
                db.session.add(row)
            payload = _manager_payload(daily_items, managers_by_id[employee_id], record_date)
            row.actual_hours = payload["actual_hours"]
            row.check_in_times = payload["check_in_times"]
            row.check_out_times = payload["check_out_times"]
            row.late_minutes = payload["late_minutes"]
            row.early_leave_minutes = payload["early_leave_minutes"]
            row.exception_reason = payload["exception_reason"]
            row.raw_data = payload["raw_data"]
            row.manager_payload = payload

        unmatched = list(unmatched_by_key.values())
        run = DingTalkSyncRun(
            account_set_id=account_set_id,
            month=month,
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
        return _result(run)
    except Exception as exc:
        return _failed_run(account_set_id, month, started_at, exc)


class DingTalkManagerAttendanceService:
    @staticmethod
    def sync(account_set_id: int, month: str, client) -> dict:
        return sync_dingtalk_manager_attendance(account_set_id, month, client)
