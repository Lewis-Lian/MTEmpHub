# -*- coding: utf-8 -*-
"""只读排查3：汇总「刷卡3次但个人考勤页显示4条时间」的人员名单（按月），
并导出完整明细到 scripts/punch_mismatch_report.txt。"""
import sys
from collections import defaultdict

sys.path.insert(0, ".")

from app import create_app  # noqa: E402
from models import db  # noqa: E402
from models.daily_record import DailyRecord  # noqa: E402
from models.employee import Employee  # noqa: E402
from routes.query_core import _calendar_punch_times  # noqa: E402
from services.attendance_source_service import (  # noqa: E402
    _extract_raw_punch_data,
    _normalize_punch_token,
    _raw_punch_count,
)


def front_display_times(record):
    times = _calendar_punch_times(record)
    merged = list(times.get("check_in_times") or []) + list(times.get("check_out_times") or [])
    seen, out = set(), []
    for token in merged:
        token = _normalize_punch_token(token)
        if token and token not in seen:
            seen.add(token)
            out.append(token)
    return sorted(out)


def main():
    app = create_app()
    with app.app_context():
        employees = {e.id: e for e in Employee.query.all()}
        months = sorted({str(r[0])[:7] for r in db.session.query(DailyRecord.record_date).distinct().all()})
        lines = []
        for month in months:
            records = DailyRecord.query.filter(DailyRecord.record_date.like(f"{month}-%")).all()
            by_emp = defaultdict(list)
            for r in records:
                raw_str = _extract_raw_punch_data(r)
                raw_count = _raw_punch_count(r)
                display = front_display_times(r)
                if raw_count == 3 and len(display) == 4:
                    e = employees.get(r.emp_id)
                    by_emp[r.emp_id].append((r.record_date, raw_str, display))
            lines.append(f"\n### {month}：刷卡3次但个人页显示4条 的人数 {len(by_emp)}，天数 {sum(len(v) for v in by_emp.values())}")
            for emp_id, items in sorted(by_emp.items(), key=lambda kv: -len(kv[1])):
                e = employees.get(emp_id)
                dept = getattr(e.department, "dept_name", "") if e else ""
                lines.append(f"\n  {e.name if e else '?'}（工号{e.emp_no if e else emp_id}，id={emp_id}，{dept}）共 {len(items)} 天:")
                for d, raw_str, display in items:
                    lines.append(f"    {d}  刷卡:{raw_str}  →  个人页显示:{'、'.join(display)}")
        report = "\n".join(lines)
        with open("scripts/punch_mismatch_report.txt", "w", encoding="utf-8") as f:
            f.write(report + "\n")
        print(report[:6000])
        print(f"\n（完整明细已写入 scripts/punch_mismatch_report.txt，共 {len(lines)} 行）")


if __name__ == "__main__":
    main()
