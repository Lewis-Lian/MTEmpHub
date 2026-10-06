# -*- coding: utf-8 -*-
"""只读排查2：逐员工对比「异常查询页口径」与「个人考勤页KPI口径」的异常打卡次数，
找出两个页面数字对不上的员工（3 vs 4 之类），并给出差异日期明细。"""
import sys
from collections import defaultdict

sys.path.insert(0, ".")

from app import create_app  # noqa: E402
from models import db  # noqa: E402
from models.account_set import AccountSet  # noqa: E402
from models.daily_record import DailyRecord  # noqa: E402
from models.employee import Employee  # noqa: E402
from routes.query_core import (  # noqa: E402
    EMPLOYEE_STATS_CONTEXT,
    MANAGER_STATS_CONTEXT,
    _build_attendance_calendar_payload,
    _build_abnormal_rows,
)
from services.attendance_source_service import _raw_punch_count  # noqa: E402


def main():
    app = create_app()
    with app.app_context():
        active = AccountSet.query.filter_by(is_active=True).first()
        months = sorted({str(r[0])[:7] for r in db.session.query(DailyRecord.record_date).distinct().all()})
        print(f"活跃账套: {active.month if active else '无'}；月份: {months}")
        employees = Employee.query.all()
        print(f"员工总数: {len(employees)}")

        for month in months:
            # 异常查询页口径：_build_abnormal_rows（全员用 EMPLOYEE_STATS_CONTEXT）
            abnormal_rows = {row["emp_no"]: row["abnormal_count"] for row in _build_abnormal_rows(month, [e.id for e in employees])}
            # 个人考勤页口径：逐员工走真实日历 payload（管理人员用 MANAGER_STATS_CONTEXT）
            mismatches = []
            for e in employees:
                payload = _build_attendance_calendar_payload(e, month)
                if not payload:
                    continue
                kpi_days = [d for d in payload["days"] if d["punch_count"] in (1, 3)]
                kpi_count = len(kpi_days)
                list_count = abnormal_rows.get(e.emp_no, 0)
                if kpi_count != list_count:
                    mismatches.append((e, list_count, kpi_count, kpi_days))
            print(f"\n### 月份 {month}: 异常查询页 vs 个人页KPI 不一致的员工: {len(mismatches)} 人")
            for e, list_count, kpi_count, kpi_days in mismatches[:30]:
                print(
                    f"  {e.name}(工号{e.emp_no}, id={e.id}, {'管理人员' if e.is_manager else '员工'}) "
                    f"异常列表={list_count} 次, 个人页KPI={kpi_count} 次"
                )
                for d in kpi_days:
                    print(f"    - {d['date']} punch_count={d['punch_count']} 异常原因={d.get('exception_reason')!r}")


if __name__ == "__main__":
    main()
