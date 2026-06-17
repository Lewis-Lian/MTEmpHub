from __future__ import annotations

import os
import re
import shutil
from typing import Any

from models import db
from services.import_pipeline import classify_import_file, normalize_import_rows
from models.department import Department
from models.employee import ATTENDANCE_SOURCE_EMPLOYEE, ATTENDANCE_SOURCE_MANAGER, Employee
from models.shift import Shift
from models.daily_record import DailyRecord
from models.monthly_report import MonthlyReport
from models.overtime import OvertimeRecord
from models.leave import LeaveRecord
from models.annual_leave import AnnualLeave
from utils.helpers import (
    clean_text,
    parse_bool_zh,
    parse_date,
    parse_datetime,
    parse_float,
    parse_int,
    split_time_cells,
)


class ImportService:
    @staticmethod
    def _can_receive_manager_source(employee: Employee | None) -> bool:
        if not employee:
            return False
        return bool(employee.is_manager) or (
            employee.employee_stats_attendance_source == ATTENDANCE_SOURCE_MANAGER
        )

    @staticmethod
    def _can_receive_employee_source(employee: Employee | None) -> bool:
        if not employee:
            return False
        return (not bool(employee.is_manager)) or (
            employee.manager_stats_attendance_source == ATTENDANCE_SOURCE_EMPLOYEE
        )

    @staticmethod
    def import_file(file_path: str) -> dict:
        filename = os.path.basename(file_path)
        file_type = classify_import_file(filename)
        normalized = normalize_import_rows(file_path, file_type=file_type)

        try:
            rows = normalized.rows
            if not rows:
                return {"status": "error", "message": "Empty file or unsupported xls structure"}

            if file_type == "overtime":
                stats = ImportService._import_overtime(rows)
                return {"status": "ok", "file_type": "overtime", **stats}
            if file_type == "leave":
                stats = ImportService._import_leave(rows)
                return {"status": "ok", "file_type": "leave", **stats}
            if file_type == "manager_monthly":
                stats = ImportService._import_manager_monthly_report(rows, filename)
                return {"status": "ok", "file_type": "manager_monthly", **stats}
            if file_type == "manager_daily":
                stats = ImportService._import_manager_daily_records(rows)
                return {"status": "ok", "file_type": "manager_daily", **stats}
            if file_type == "monthly":
                stats = ImportService._import_monthly_report(rows, filename)
                return {"status": "ok", "file_type": "monthly", **stats}
            stats = ImportService._import_daily_records(rows)
            return {"status": "ok", "file_type": "daily", **stats}
        finally:
            if normalized.cleanup_dir and os.path.isdir(normalized.cleanup_dir):
                shutil.rmtree(normalized.cleanup_dir, ignore_errors=True)

    @staticmethod
    def _build_header_map(header: list[Any]) -> dict[str, int]:
        result: dict[str, int] = {}
        for i, h in enumerate(header):
            text = clean_text(h)
            if text:
                result[text] = i
        return result

    @staticmethod
    def _find_col(header_map: dict[str, int], *names: str) -> int:
        for n in names:
            if n in header_map:
                return header_map[n]
        return -1

    @staticmethod
    def _find_header_row(rows: list[list[Any]], required_cols: list[str], probe_rows: int = 8) -> int:
        limit = min(len(rows), probe_rows)
        best_idx = 0
        best_score = -1
        for idx in range(limit):
            header_map = ImportService._build_header_map(rows[idx])
            score = sum(1 for col in required_cols if col in header_map)
            if score > best_score:
                best_idx = idx
                best_score = score
        return best_idx

    @staticmethod
    def _build_manager_header_map(rows: list[list[Any]]) -> tuple[int, dict[str, int]]:
        header_idx = ImportService._find_header_row(rows, ["姓名", "部门"])
        first = rows[header_idx] if header_idx < len(rows) else []
        second = rows[header_idx + 1] if header_idx + 1 < len(rows) else []
        result: dict[str, int] = {}
        current = ""
        width = max(len(first), len(second))
        for idx in range(width):
            top = clean_text(first[idx] if idx < len(first) else "")
            bottom = clean_text(second[idx] if idx < len(second) else "")
            if top:
                current = top
                result.setdefault(top, idx)
            if bottom:
                result.setdefault(bottom, idx)
                if current and current != bottom:
                    result.setdefault(f"{current}/{bottom}", idx)
        return header_idx, result

    @staticmethod
    def _find_manager_by_name(name: str) -> Employee | None:
        clean_name = clean_text(name)
        if not clean_name:
            return None
        candidates = (
            Employee.query.filter(Employee.name == clean_name)
            .order_by(Employee.is_manager.desc(), Employee.emp_no.asc())
            .all()
        )
        for employee in candidates:
            if ImportService._can_receive_manager_source(employee):
                return employee
        return None

    @staticmethod
    def _find_manager_by_emp_no(emp_no: str) -> Employee | None:
        clean_emp_no = clean_text(emp_no)
        if not clean_emp_no:
            return None
        employee = Employee.query.filter(Employee.emp_no == clean_emp_no).first()
        if ImportService._can_receive_manager_source(employee):
            return employee
        return None

    @staticmethod
    def _resolve_manager_employee(header_map: dict[str, int], row: list[Any]) -> tuple[Employee | None, str, str]:
        emp_no = clean_text(
            ImportService._get_row_value(row, ImportService._find_col(header_map, "工号", "人员编号"))
        )
        name = clean_text(ImportService._get_row_value(row, ImportService._find_col(header_map, "姓名")))

        employee = ImportService._find_manager_by_emp_no(emp_no) if emp_no else None
        if not employee and name:
            employee = ImportService._find_manager_by_name(name)
        return employee, emp_no, name

    @staticmethod
    def _bulk_lookup_managers(
        emp_nos: list[str], names: list[str]
    ) -> tuple[dict[str, Employee], dict[str, Employee]]:
        """批量预查管理人员，返回 {emp_no: Employee} 和 {name: Employee}。

        复用与单条查询相同的过滤逻辑（_can_receive_manager_source），
        但用一次查询拉取所有候选，在内存中按优先级筛选。
        """
        unique_emp_nos = {n for n in emp_nos if n}
        unique_names = {n for n in names if n}
        query_filter = db.or_(Employee.emp_no.in_(unique_emp_nos), Employee.name.in_(unique_names))
        candidates = Employee.query.filter(query_filter).order_by(
            Employee.is_manager.desc(), Employee.emp_no.asc()
        ).all()

        emp_by_no: dict[str, Employee] = {}
        emp_by_name: dict[str, Employee] = {}
        for emp in candidates:
            if ImportService._can_receive_manager_source(emp):
                if emp.emp_no and emp.emp_no not in emp_by_no:
                    emp_by_no[emp.emp_no] = emp
                if emp.name and emp.name not in emp_by_name:
                    emp_by_name[emp.name] = emp
        return emp_by_no, emp_by_name

    @staticmethod
    def _raw_dict_from_header_map(row: list[Any], header_map: dict[str, int]) -> dict[str, Any]:
        raw: dict[str, Any] = {}
        for header, idx in header_map.items():
            if header in raw:
                continue
            raw[header] = row[idx] if idx < len(row) else None
        return raw

    @staticmethod
    def _manager_raw_score(raw: dict[str, Any]) -> int:
        score = 0
        for key in ("出勤天数", "工作时长", "迟到时长", "早退时长"):
            value = raw.get(key)
            if value not in (None, ""):
                score += 10
        score += sum(1 for value in raw.values() if value not in (None, ""))
        return score

    @staticmethod
    def _is_manager_daily_raw(raw: dict[str, Any]) -> bool:
        return "日期" in raw and (
            "考勤组" in raw
            or "上班1打卡时间" in raw
            or "下班1打卡时间" in raw
            or "上班2打卡时间" in raw
            or "下班2打卡时间" in raw
        )

    @staticmethod
    def _parse_manager_record_date(value: Any):
        text = clean_text(value)
        m = re.search(r"(\d{2,4})[-/](\d{1,2})[-/](\d{1,2})", text)
        if not m:
            return parse_date(value)
        year = int(m.group(1))
        if year < 100:
            year += 2000
        month = int(m.group(2))
        day = int(m.group(3))
        try:
            return parse_date(f"{year:04d}-{month:02d}-{day:02d}")
        except Exception:
            return None

    @staticmethod
    def _get_row_value(row: list[Any], idx: int) -> Any:
        if idx < 0:
            return None
        return row[idx] if idx < len(row) else None

    @staticmethod
    def _get_or_create_department(dept_no: str, dept_name: str) -> Department:
        dept_no = dept_no or dept_name or "UNKNOWN"
        dept = Department.query.filter_by(dept_no=dept_no).first()
        if not dept:
            dept = Department(dept_no=dept_no, dept_name=dept_name or dept_no)
            db.session.add(dept)
            db.session.flush()
        elif dept_name and dept.dept_name != dept_name:
            dept.dept_name = dept_name
        return dept

    @staticmethod
    def _get_or_create_employee(emp_no: str, name: str, dept: Department | None) -> Employee:
        emp = Employee.query.filter_by(emp_no=emp_no).first()
        if not emp:
            emp = Employee(emp_no=emp_no, name=name or emp_no, dept_id=dept.id if dept else None)
            db.session.add(emp)
            db.session.flush()
        else:
            if name:
                emp.name = name
            if dept:
                emp.dept_id = dept.id
        return emp

    @staticmethod
    def _get_or_create_shift(shift_no: str, shift_name: str, shift_time_text: Any) -> Shift | None:
        if not shift_no and not shift_name:
            return None
        key = shift_no or shift_name
        shift = Shift.query.filter_by(shift_no=key).first()
        slots = ImportService._parse_shift_slots(shift_time_text)
        is_cross_day = any(s[0] > s[1] for s in slots if len(s) == 2)
        if not shift:
            shift = Shift(
                shift_no=key,
                shift_name=shift_name or key,
                time_slots=slots,
                is_cross_day=is_cross_day,
            )
            db.session.add(shift)
            db.session.flush()
        else:
            if shift_name:
                shift.shift_name = shift_name
            if slots:
                shift.time_slots = slots
                shift.is_cross_day = is_cross_day
        return shift

    @staticmethod
    def _find_existing_employee(emp_no: str) -> Employee | None:
        key = clean_text(emp_no)
        if not key:
            return None
        return Employee.query.filter_by(emp_no=key).first()

    @staticmethod
    def _find_existing_shift(shift_no: str, shift_name: str) -> Shift | None:
        no_key = clean_text(shift_no)
        name_key = clean_text(shift_name)
        if no_key:
            shift = Shift.query.filter_by(shift_no=no_key).first()
            if shift:
                return shift
        if name_key:
            return Shift.query.filter_by(shift_name=name_key).first()
        return None

    @staticmethod
    def _parse_shift_slots(value: Any) -> list[list[str]]:
        text = clean_text(value)
        if not text:
            return []
        normalized = text.replace("；", ";").replace("，", ",").replace("~", "-")
        parts = re.split(r"[;\n]", normalized)
        slots: list[list[str]] = []
        for p in parts:
            seg = p.strip()
            if not seg:
                continue
            if "-" in seg:
                a, b = seg.split("-", 1)
                slots.append([a.strip(), b.strip()])
        return slots

    @staticmethod
    def _import_overtime(rows: list[list[Any]]) -> dict[str, int]:
        header_idx = ImportService._find_header_row(rows, ["加班单号", "工号", "开始时间", "结束时间"])
        header_map = ImportService._build_header_map(rows[header_idx])
        imported = 0
        scanned = 0
        skipped_no_key = 0
        skipped_unknown_employee = 0

        # Bulk Select 批量预查加班记录
        overtime_col_idx = ImportService._find_col(header_map, "加班单号")
        overtime_nos = []
        if overtime_col_idx >= 0:
            for row in rows[header_idx + 1 :]:
                val = clean_text(ImportService._get_row_value(row, overtime_col_idx))
                if val:
                    overtime_nos.append(val)

        existing_records = {}
        if overtime_nos:
            existing_records = {
                r.overtime_no: r
                for r in OvertimeRecord.query.filter(OvertimeRecord.overtime_no.in_(overtime_nos)).all()
            }

        # 批量预查 Employee（按工号 + 姓名）
        emp_nos_in_rows: list[str] = []
        names_in_rows: list[str] = []
        emp_no_col = ImportService._find_col(header_map, "工号")
        name_col = ImportService._find_col(header_map, "姓名")
        for row in rows[header_idx + 1 :]:
            en = clean_text(ImportService._get_row_value(row, emp_no_col)) if emp_no_col >= 0 else ""
            nm = clean_text(ImportService._get_row_value(row, name_col)) if name_col >= 0 else ""
            if en:
                emp_nos_in_rows.append(en)
            if nm:
                names_in_rows.append(nm)
        emp_by_no, emp_by_name = ImportService._bulk_lookup_managers(emp_nos_in_rows, names_in_rows)
        # 非管理人员也按工号查
        non_manager_by_no: dict[str, Employee] = {}
        unique_emp_nos = {n for n in emp_nos_in_rows if n}
        if unique_emp_nos:
            for e in Employee.query.filter(Employee.emp_no.in_(unique_emp_nos)).all():
                non_manager_by_no.setdefault(e.emp_no, e)

        for row in rows[header_idx + 1 :]:
            overtime_no = clean_text(ImportService._get_row_value(row, overtime_col_idx))
            if not overtime_no:
                skipped_no_key += 1
                continue
            scanned += 1
            emp_name = clean_text(ImportService._get_row_value(row, name_col)) if name_col >= 0 else ""
            emp_no = clean_text(ImportService._get_row_value(row, emp_no_col)) if emp_no_col >= 0 else ""
            if not emp_no and not emp_name:
                skipped_no_key += 1
                continue

            emp = non_manager_by_no.get(emp_no) if emp_no else None
            if not emp and emp_name:
                emp = emp_by_name.get(emp_name)
            if not emp:
                skipped_unknown_employee += 1
                continue

            record = existing_records.get(overtime_no)
            if not record:
                record = OvertimeRecord(overtime_no=overtime_no, emp_id=emp.id)
                db.session.add(record)
                existing_records[overtime_no] = record

            record.emp_id = emp.id
            record.start_time = parse_datetime(ImportService._get_row_value(row, ImportService._find_col(header_map, "开始时间")))
            record.end_time = parse_datetime(ImportService._get_row_value(row, ImportService._find_col(header_map, "结束时间")))
            record.is_weekend = parse_bool_zh(ImportService._get_row_value(row, ImportService._find_col(header_map, "是否周末加班")))
            record.is_holiday = parse_bool_zh(ImportService._get_row_value(row, ImportService._find_col(header_map, "是否法定加班")))
            record.salary_option = clean_text(ImportService._get_row_value(row, ImportService._find_col(header_map, "计薪选项")))
            record.effective_hours = parse_float(ImportService._get_row_value(row, ImportService._find_col(header_map, "有效工时")))
            record.reason = clean_text(ImportService._get_row_value(row, ImportService._find_col(header_map, "加班事由")))
            record.approval_comment = clean_text(ImportService._get_row_value(row, ImportService._find_col(header_map, "部门主管意见")))
            record.approval_status = "已审批" if record.approval_comment else "未知"
            imported += 1

        db.session.commit()
        return {
            "total_rows": max(len(rows) - header_idx - 1, 0),
            "scanned": scanned,
            "imported": imported,
            "skipped": scanned - imported,
            "skipped_no_key": skipped_no_key,
            "skipped_unknown_employee": skipped_unknown_employee,
        }

    @staticmethod
    def _import_leave(rows: list[list[Any]]) -> dict[str, int]:
        header_idx = ImportService._find_header_row(rows, ["请假单号", "工号", "请假类型", "开始时间", "结束时间"])
        header_map = ImportService._build_header_map(rows[header_idx])
        imported = 0
        scanned = 0
        skipped_no_key = 0
        skipped_unknown_employee = 0

        # Bulk Select 批量预查请假记录
        leave_col_idx = ImportService._find_col(header_map, "请假单号")
        leave_nos = []
        if leave_col_idx >= 0:
            for row in rows[header_idx + 1 :]:
                val = clean_text(ImportService._get_row_value(row, leave_col_idx))
                if val:
                    leave_nos.append(val)

        existing_records = {}
        if leave_nos:
            existing_records = {
                r.leave_no: r
                for r in LeaveRecord.query.filter(LeaveRecord.leave_no.in_(leave_nos)).all()
            }

        # 批量预查 Employee（按工号 + 姓名）
        emp_nos_in_rows: list[str] = []
        names_in_rows: list[str] = []
        emp_no_col = ImportService._find_col(header_map, "工号")
        name_col = ImportService._find_col(header_map, "请假人")
        for row in rows[header_idx + 1 :]:
            en = clean_text(ImportService._get_row_value(row, emp_no_col)) if emp_no_col >= 0 else ""
            nm = clean_text(ImportService._get_row_value(row, name_col)) if name_col >= 0 else ""
            if en:
                emp_nos_in_rows.append(en)
            if nm:
                names_in_rows.append(nm)
        emp_by_no_mgr, emp_by_name_mgr = ImportService._bulk_lookup_managers(emp_nos_in_rows, names_in_rows)
        non_manager_by_no: dict[str, Employee] = {}
        unique_emp_nos = {n for n in emp_nos_in_rows if n}
        if unique_emp_nos:
            for e in Employee.query.filter(Employee.emp_no.in_(unique_emp_nos)).all():
                non_manager_by_no.setdefault(e.emp_no, e)

        # 批量预查 AnnualLeave（调休余额，按 emp_id 拉取全部年份记录）
        all_leave_emp_ids: set[int] = {e.id for e in non_manager_by_no.values()}
        all_leave_emp_ids |= {e.id for e in emp_by_no_mgr.values()}
        all_leave_emp_ids |= {e.id for e in emp_by_name_mgr.values()}
        annual_leave_by_key: dict[tuple[int, int], AnnualLeave] = {}
        if all_leave_emp_ids:
            for bal in AnnualLeave.query.filter(AnnualLeave.emp_id.in_(all_leave_emp_ids)).all():
                annual_leave_by_key[(bal.emp_id, bal.year)] = bal

        for row in rows[header_idx + 1 :]:
            leave_no = clean_text(ImportService._get_row_value(row, leave_col_idx))
            if not leave_no:
                skipped_no_key += 1
                continue
            scanned += 1

            emp_no = clean_text(ImportService._get_row_value(row, emp_no_col)) if emp_no_col >= 0 else ""
            emp_name = clean_text(ImportService._get_row_value(row, name_col)) if name_col >= 0 else ""
            if not emp_no and not emp_name:
                skipped_no_key += 1
                continue

            emp = non_manager_by_no.get(emp_no) if emp_no else None
            if not emp and emp_name:
                emp = emp_by_name_mgr.get(emp_name)
            if not emp:
                skipped_unknown_employee += 1
                continue

            record = existing_records.get(leave_no)
            is_new = record is None
            old_duration = 0.0
            old_year = None
            old_is_time_off = False
            if not is_new:
                old_duration = record.duration or 0.0
                old_year = record.apply_date.year if record.apply_date else None
                old_is_time_off = (record.leave_type == "补休（调休）")
            else:
                record = LeaveRecord(leave_no=leave_no, emp_id=emp.id)
                db.session.add(record)
                existing_records[leave_no] = record

            record.emp_id = emp.id
            record.apply_date = parse_date(ImportService._get_row_value(row, ImportService._find_col(header_map, "申请日期")))
            record.leave_type = clean_text(ImportService._get_row_value(row, ImportService._find_col(header_map, "请假类型")))
            record.start_time = parse_datetime(ImportService._get_row_value(row, ImportService._find_col(header_map, "开始时间")))
            record.end_time = parse_datetime(ImportService._get_row_value(row, ImportService._find_col(header_map, "结束时间")))
            record.duration = parse_float(ImportService._get_row_value(row, ImportService._find_col(header_map, "时长")))
            record.reason = clean_text(ImportService._get_row_value(row, ImportService._find_col(header_map, "事由文本")))
            record.approval_comment = clean_text(ImportService._get_row_value(row, ImportService._find_col(header_map, "部门主管意见")))
            record.approval_status = "已审批" if record.approval_comment else "未知"
            imported += 1

            new_year = record.apply_date.year if record.apply_date else None
            new_is_time_off = (record.leave_type == "补休（调休）")

            # 调休已用余额修正（数学差值）
            if not is_new and old_is_time_off and old_year is not None:
                old_balance = annual_leave_by_key.get((emp.id, old_year))
                if old_balance:
                    old_balance.used_days = max((old_balance.used_days or 0) - old_duration / 8, 0.0)
                    old_balance.remaining_days = (old_balance.total_days or 0) - (old_balance.used_days or 0)

            if new_is_time_off and new_year is not None:
                new_balance = annual_leave_by_key.get((emp.id, new_year))
                if not new_balance:
                    new_balance = AnnualLeave(emp_id=emp.id, year=new_year, total_days=0, used_days=0, remaining_days=0)
                    db.session.add(new_balance)
                    annual_leave_by_key[(emp.id, new_year)] = new_balance
                new_balance.used_days = (new_balance.used_days or 0) + (record.duration or 0) / 8
                new_balance.remaining_days = (new_balance.total_days or 0) - (new_balance.used_days or 0)

        db.session.commit()
        return {
            "total_rows": max(len(rows) - header_idx - 1, 0),
            "scanned": scanned,
            "imported": imported,
            "skipped": scanned - imported,
            "skipped_no_key": skipped_no_key,
            "skipped_unknown_employee": skipped_unknown_employee,
        }

    @staticmethod
    def _import_daily_records(rows: list[list[Any]]) -> dict[str, int]:
        header_idx = ImportService._find_header_row(rows, ["人员编号", "人员名称", "考勤日期"])
        header_map = ImportService._build_header_map(rows[header_idx])
        imported = 0
        scanned = 0
        skipped_no_key = 0
        skipped_unknown_employee = 0
        header_row = rows[header_idx]

        emp_no_idx = ImportService._find_col(header_map, "人员编号", "工号")
        shift_no_idx = ImportService._find_col(header_map, "班次编号")
        shift_name_idx = ImportService._find_col(header_map, "班次名称")
        date_idx = ImportService._find_col(header_map, "考勤日期")

        # ---- 批量预查：Employee / Shift / DailyRecord ----
        emp_no_col = emp_no_idx if emp_no_idx >= 0 else -1
        emp_nos: list[str] = []
        for row in rows[header_idx + 1 :]:
            val = clean_text(ImportService._get_row_value(row, emp_no_col))
            if val:
                emp_nos.append(val)
        emp_by_no: dict[str, Employee] = (
            {e.emp_no: e for e in Employee.query.filter(Employee.emp_no.in_(emp_nos)).all()}
            if emp_nos
            else {}
        )

        shift_keys: set[str] = set()
        for row in rows[header_idx + 1 :]:
            no_val = clean_text(ImportService._get_row_value(row, shift_no_idx))
            name_val = clean_text(ImportService._get_row_value(row, shift_name_idx))
            if no_val:
                shift_keys.add(no_val)
            if name_val:
                shift_keys.add(name_val)
        all_shifts: dict[str, Shift] = {}
        if shift_keys:
            for s in Shift.query.filter(
                db.or_(Shift.shift_no.in_(shift_keys), Shift.shift_name.in_(shift_keys))
            ).all():
                all_shifts[s.shift_no] = s
                all_shifts[s.shift_name] = s

        # 预查 DailyRecord：需先确定 emp_id + record_date 才能精确预查，
        # 但 record_date 在循环内解析。改为按 emp_id 批量预查该批的所有记录。
        resolved_emp_ids: set[int] = {
            e.id for e in emp_by_no.values() if ImportService._can_receive_employee_source(e)
        }
        existing_records: dict[tuple[int, Any], DailyRecord] = {}
        if resolved_emp_ids:
            for r in DailyRecord.query.filter(DailyRecord.emp_id.in_(resolved_emp_ids)).all():
                existing_records[(r.emp_id, r.record_date)] = r

        for row in rows[header_idx + 1 :]:
            emp_no = clean_text(ImportService._get_row_value(row, emp_no_idx))
            if not emp_no:
                skipped_no_key += 1
                continue
            scanned += 1
            emp = emp_by_no.get(emp_no)
            if not emp or not ImportService._can_receive_employee_source(emp):
                skipped_unknown_employee += 1
                continue

            shift_no = clean_text(ImportService._get_row_value(row, shift_no_idx))
            shift_name = clean_text(ImportService._get_row_value(row, shift_name_idx))
            shift = all_shifts.get(shift_no) or all_shifts.get(shift_name)

            record_date = parse_date(ImportService._get_row_value(row, date_idx))
            if not record_date:
                continue

            record = existing_records.get((emp.id, record_date))
            if not record:
                record = DailyRecord(emp_id=emp.id, record_date=record_date)
                db.session.add(record)
                existing_records[(emp.id, record_date)] = record

            check_raw = clean_text(ImportService._get_row_value(row, ImportService._find_col(header_map, "刷卡时间数据")))
            times = split_time_cells(check_raw)
            check_in_times = times[::2]
            check_out_times = times[1::2]

            for idx in range(1, 6):
                in_key = f"段{idx}实际上班时间"
                out_key = f"段{idx}实际下班时间"
                in_val = clean_text(ImportService._get_row_value(row, ImportService._find_col(header_map, in_key)))
                out_val = clean_text(ImportService._get_row_value(row, ImportService._find_col(header_map, out_key)))
                if in_val:
                    check_in_times.append(in_val)
                if out_val:
                    check_out_times.append(out_val)

            employee_payload = {
                "expected_hours": parse_float(ImportService._get_row_value(row, ImportService._find_col(header_map, "应出勤小时"))),
                "actual_hours": parse_float(ImportService._get_row_value(row, ImportService._find_col(header_map, "实出勤小时"))),
                "absent_hours": parse_float(ImportService._get_row_value(row, ImportService._find_col(header_map, "旷工小时"))),
                "check_in_times": check_in_times,
                "check_out_times": check_out_times,
                "leave_hours": parse_float(ImportService._get_row_value(row, ImportService._find_col(header_map, "请假小时"))),
                "leave_type": clean_text(ImportService._get_row_value(row, ImportService._find_col(header_map, "假种名称"))),
                "overtime_hours": parse_float(ImportService._get_row_value(row, ImportService._find_col(header_map, "加班小时"))),
                "overtime_type": clean_text(ImportService._get_row_value(row, ImportService._find_col(header_map, "加班类型"))),
                "late_minutes": parse_int(ImportService._get_row_value(row, ImportService._find_col(header_map, "迟到分钟"))),
                "early_leave_minutes": parse_int(ImportService._get_row_value(row, ImportService._find_col(header_map, "早退分钟"))),
                "exception_reason": clean_text(ImportService._get_row_value(row, ImportService._find_col(header_map, "异常原因"))),
                "raw_data": {str(header_row[i]): row[i] if i < len(row) else None for i in range(len(header_row))},
            }
            record.shift_id = shift.id if shift else None
            record.expected_hours = employee_payload["expected_hours"]
            record.actual_hours = employee_payload["actual_hours"]
            record.absent_hours = employee_payload["absent_hours"]
            record.check_in_times = employee_payload["check_in_times"]
            record.check_out_times = employee_payload["check_out_times"]
            record.leave_hours = employee_payload["leave_hours"]
            record.leave_type = employee_payload["leave_type"]
            record.overtime_hours = employee_payload["overtime_hours"]
            record.overtime_type = employee_payload["overtime_type"]
            record.late_minutes = employee_payload["late_minutes"]
            record.early_leave_minutes = employee_payload["early_leave_minutes"]
            record.exception_reason = employee_payload["exception_reason"]
            record.raw_data = employee_payload["raw_data"]
            record.employee_payload = employee_payload
            imported += 1

        db.session.commit()
        return {
            "total_rows": max(len(rows) - header_idx - 1, 0),
            "scanned": scanned,
            "imported": imported,
            "skipped": scanned - imported,
            "skipped_no_key": skipped_no_key,
            "skipped_unknown_employee": skipped_unknown_employee,
        }

    @staticmethod
    def _import_manager_monthly_report(rows: list[list[Any]], filename: str) -> dict[str, int]:
        header_idx, header_map = ImportService._build_manager_header_map(rows)
        report_month = ImportService._extract_report_month(filename)
        imported = 0
        scanned = 0
        skipped_no_key = 0
        skipped_unknown_employee = 0

        emp_no_idx = ImportService._find_col(header_map, "工号", "人员编号")
        name_idx = ImportService._find_col(header_map, "姓名")
        if emp_no_idx < 0 and name_idx < 0:
            return {
                "total_rows": 0,
                "scanned": 0,
                "imported": 0,
                "skipped": 0,
                "skipped_no_key": 0,
                "skipped_unknown_employee": 0,
            }

        # ---- 批量预查：Employee（按工号+姓名）/ MonthlyReport ----
        emp_nos: list[str] = []
        names: list[str] = []
        for row in rows[header_idx + 2 :]:
            en = clean_text(ImportService._get_row_value(row, emp_no_idx)) if emp_no_idx >= 0 else ""
            nm = clean_text(ImportService._get_row_value(row, name_idx)) if name_idx >= 0 else ""
            if en:
                emp_nos.append(en)
            if nm:
                names.append(nm)
        emp_by_no, emp_by_name = ImportService._bulk_lookup_managers(emp_nos, names)
        resolved_emp_ids: set[int] = set(emp_by_no.values()) | set(emp_by_name.values())
        existing_reports: dict[int, MonthlyReport] = {}
        if resolved_emp_ids:
            for r in MonthlyReport.query.filter(
                MonthlyReport.emp_id.in_(resolved_emp_ids), MonthlyReport.report_month == report_month
            ).all():
                existing_reports[r.emp_id] = r

        for row in rows[header_idx + 2 :]:
            emp_no = clean_text(ImportService._get_row_value(row, emp_no_idx)) if emp_no_idx >= 0 else ""
            name = clean_text(ImportService._get_row_value(row, name_idx)) if name_idx >= 0 else ""
            if not emp_no and not name:
                skipped_no_key += 1
                continue
            scanned += 1

            emp = emp_by_no.get(emp_no) if emp_no else None
            if not emp and name:
                emp = emp_by_name.get(name)
            if not emp:
                skipped_unknown_employee += 1
                continue

            report = existing_reports.get(emp.id)
            if not report:
                report = MonthlyReport(emp_id=emp.id, report_month=report_month)
                db.session.add(report)
                existing_reports[emp.id] = report

            raw_data = ImportService._raw_dict_from_header_map(row, header_map)
            existing_raw = report.manager_raw_data if isinstance(report.manager_raw_data, dict) else {}
            if ImportService._manager_raw_score(existing_raw) > ImportService._manager_raw_score(raw_data):
                continue
            report.raw_data = raw_data
            report.manager_raw_data = raw_data
            imported += 1

        db.session.commit()
        return {
            "total_rows": max(len(rows) - header_idx - 2, 0),
            "scanned": scanned,
            "imported": imported,
            "skipped": scanned - imported,
            "skipped_no_key": skipped_no_key,
            "skipped_unknown_employee": skipped_unknown_employee,
        }

    @staticmethod
    def _import_manager_daily_records(rows: list[list[Any]]) -> dict[str, int]:
        header_idx, header_map = ImportService._build_manager_header_map(rows)
        imported = 0
        scanned = 0
        skipped_no_key = 0
        skipped_unknown_employee = 0

        emp_no_idx = ImportService._find_col(header_map, "工号", "人员编号")
        name_idx = ImportService._find_col(header_map, "姓名")
        date_idx = ImportService._find_col(header_map, "日期")
        if (emp_no_idx < 0 and name_idx < 0) or date_idx < 0:
            return {
                "total_rows": 0,
                "scanned": 0,
                "imported": 0,
                "skipped": 0,
                "skipped_no_key": 0,
                "skipped_unknown_employee": 0,
            }

        # ---- 批量预查：Employee（按工号+姓名）/ DailyRecord ----
        emp_nos: list[str] = []
        names: list[str] = []
        for row in rows[header_idx + 2 :]:
            en = clean_text(ImportService._get_row_value(row, emp_no_idx)) if emp_no_idx >= 0 else ""
            nm = clean_text(ImportService._get_row_value(row, name_idx)) if name_idx >= 0 else ""
            if en:
                emp_nos.append(en)
            if nm:
                names.append(nm)
        emp_by_no, emp_by_name = ImportService._bulk_lookup_managers(emp_nos, names)
        resolved_emp_ids: set[int] = set(emp_by_no.values()) | set(emp_by_name.values())
        existing_records: dict[tuple[int, Any], DailyRecord] = {}
        if resolved_emp_ids:
            for r in DailyRecord.query.filter(DailyRecord.emp_id.in_(resolved_emp_ids)).all():
                existing_records[(r.emp_id, r.record_date)] = r

        for row in rows[header_idx + 2 :]:
            emp_no = clean_text(ImportService._get_row_value(row, emp_no_idx)) if emp_no_idx >= 0 else ""
            name = clean_text(ImportService._get_row_value(row, name_idx)) if name_idx >= 0 else ""
            record_date = ImportService._parse_manager_record_date(ImportService._get_row_value(row, date_idx))
            if (not emp_no and not name) or not record_date:
                skipped_no_key += 1
                continue
            scanned += 1

            emp = emp_by_no.get(emp_no) if emp_no else None
            if not emp and name:
                emp = emp_by_name.get(name)
            if not emp:
                skipped_unknown_employee += 1
                continue

            record = existing_records.get((emp.id, record_date))
            if not record:
                record = DailyRecord(emp_id=emp.id, record_date=record_date)
                db.session.add(record)
                existing_records[(emp.id, record_date)] = record

            raw_data = ImportService._raw_dict_from_header_map(row, header_map)
            existing_raw = record.manager_payload if isinstance(record.manager_payload, dict) else {}
            is_manager_raw = ImportService._is_manager_daily_raw(raw_data)
            existing_is_manager_raw = ImportService._is_manager_daily_raw(existing_raw)
            if existing_is_manager_raw and not is_manager_raw:
                continue
            if (
                not (is_manager_raw and not existing_is_manager_raw)
                and ImportService._manager_raw_score(existing_raw) > ImportService._manager_raw_score(raw_data)
            ):
                continue
            manager_payload = {
                "actual_hours": parse_float(ImportService._get_row_value(row, ImportService._find_col(header_map, "工作时长"))),
                "late_minutes": parse_int(ImportService._get_row_value(row, ImportService._find_col(header_map, "迟到时长"))),
                "early_leave_minutes": parse_int(ImportService._get_row_value(row, ImportService._find_col(header_map, "早退时长"))),
                "check_in_times": [],
                "check_out_times": [],
                "raw_data": raw_data,
            }
            record.actual_hours = manager_payload["actual_hours"]
            record.late_minutes = manager_payload["late_minutes"]
            record.early_leave_minutes = manager_payload["early_leave_minutes"]
            record.raw_data = raw_data
            record.manager_payload = manager_payload
            imported += 1

        db.session.commit()
        return {
            "total_rows": max(len(rows) - header_idx - 2, 0),
            "scanned": scanned,
            "imported": imported,
            "skipped": scanned - imported,
            "skipped_no_key": skipped_no_key,
            "skipped_unknown_employee": skipped_unknown_employee,
        }

    @staticmethod
    def _extract_report_month(filename: str) -> str:
        # e.g. 2026_3月员工基础数据(月报).xls -> 2026-03
        m = re.search(r"(\d{4})年?[_-]?(\d{1,2})月", filename)
        if m:
            y = m.group(1)
            mm = int(m.group(2))
            return f"{y}-{mm:02d}"
        return "1970-01"

    @staticmethod
    def _import_monthly_report(rows: list[list[Any]], filename: str) -> dict[str, int]:
        header_idx = ImportService._find_header_row(rows, ["人员编号", "人员名称", "部门编号", "部门名称"])
        header = rows[header_idx]
        header_map = ImportService._build_header_map(header)
        report_month = ImportService._extract_report_month(filename)
        imported = 0
        scanned = 0
        skipped_no_key = 0
        skipped_unknown_employee = 0

        emp_no_idx = ImportService._find_col(header_map, "人员编号", "工号")
        emp_name_idx = ImportService._find_col(header_map, "人员名称", "姓名")
        dept_no_idx = ImportService._find_col(header_map, "部门编号")
        dept_name_idx = ImportService._find_col(header_map, "部门名称", "部门")

        base_idx = {i for i in [emp_no_idx, emp_name_idx, dept_no_idx, dept_name_idx] if i >= 0}

        # ---- 批量预查：Employee / MonthlyReport ----
        emp_nos: list[str] = []
        for row in rows[header_idx + 1 :]:
            val = clean_text(ImportService._get_row_value(row, emp_no_idx))
            if val:
                emp_nos.append(val)
        emp_by_no: dict[str, Employee] = (
            {e.emp_no: e for e in Employee.query.filter(Employee.emp_no.in_(emp_nos)).all()}
            if emp_nos
            else {}
        )
        resolved_emp_ids: set[int] = {
            e.id for e in emp_by_no.values() if ImportService._can_receive_employee_source(e)
        }
        existing_reports: dict[int, MonthlyReport] = {}
        if resolved_emp_ids:
            for r in MonthlyReport.query.filter(
                MonthlyReport.emp_id.in_(resolved_emp_ids), MonthlyReport.report_month == report_month
            ).all():
                existing_reports[r.emp_id] = r

        for row in rows[header_idx + 1 :]:
            emp_no = clean_text(ImportService._get_row_value(row, emp_no_idx))
            if not emp_no:
                skipped_no_key += 1
                continue
            scanned += 1

            emp = emp_by_no.get(emp_no)
            if not emp or not ImportService._can_receive_employee_source(emp):
                skipped_unknown_employee += 1
                continue

            metric_values: list[float | None] = []
            for i in range(len(header)):
                if i in base_idx:
                    continue
                metric_values.append(parse_float(ImportService._get_row_value(row, i), default=0.0))
                if len(metric_values) >= 84:
                    break
            while len(metric_values) < 84:
                metric_values.append(0.0)

            report = existing_reports.get(emp.id)
            if not report:
                report = MonthlyReport(emp_id=emp.id, report_month=report_month)
                db.session.add(report)
                existing_reports[emp.id] = report

            for i in range(84):
                setattr(report, f"agg_{i+1:02d}", metric_values[i])

            employee_raw_data = {
                clean_text(header[i]) or f"COL_{i+1}": (row[i] if i < len(row) else None)
                for i in range(len(header))
            }
            report.raw_data = employee_raw_data
            report.employee_raw_data = employee_raw_data
            imported += 1

        db.session.commit()
        return {
            "total_rows": max(len(rows) - header_idx - 1, 0),
            "scanned": scanned,
            "imported": imported,
            "skipped": scanned - imported,
            "skipped_no_key": skipped_no_key,
            "skipped_unknown_employee": skipped_unknown_employee,
        }
