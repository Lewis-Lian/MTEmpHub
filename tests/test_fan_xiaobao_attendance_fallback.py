import unittest
from copy import deepcopy
from datetime import date

from models.daily_record import DailyRecord
from models.employee import Employee
from routes.query_core import (
    _attendance_day_value,
    _calendar_punch_times,
    _calc_record_work_hours,
    _effective_attendance_day_value,
    _effective_is_half_day,
)
from models.daily_attendance_override import DailyAttendanceOverride
from services.attendance_source_service import (
    EMPLOYEE_STATS_CONTEXT,
    MANAGER_STATS_CONTEXT,
    _raw_punch_count,
    build_attendance_record_view,
)
from services.manager_attendance_service import manager_daily_attendance_values


class FanXiaobaoAttendanceFallbackTests(unittest.TestCase):
    def make_record(self, emp_no="101026002", source="manager", punches="07:47,11:24,16:23"):
        employee = Employee(emp_no=emp_no, name="范小宝", employee_stats_attendance_source=source)
        record = DailyRecord(
            employee=employee,
            record_date=date(2026, 9, 1),
            employee_payload={
                "check_in_times": ["07:47", "16:23", "2026-09-01 07:47", "2026-09-01 12:00"],
                "check_out_times": ["11:24", "2026-09-01 11:24", "2026-09-01 16:23"],
                "actual_hours": 7.38,
                "raw_data": {"刷卡时间数据": punches},
            },
            manager_payload={
                "check_in_times": [], "check_out_times": [], "actual_hours": 0,
                "raw_data": {"上班1打卡时间": None, "下班1打卡时间": None},
            },
        )
        return employee, record

    def test_only_fan_xiaobao_uses_real_employee_punches_when_manager_has_none(self):
        employee, record = self.make_record()
        original = deepcopy(record.employee_payload)
        manager_original = deepcopy(record.manager_payload)
        for context in (EMPLOYEE_STATS_CONTEXT, MANAGER_STATS_CONTEXT):
            view = build_attendance_record_view(record, employee, context)
            self.assertEqual(view.source, "manager")
            self.assertEqual(_raw_punch_count(view), 3)
            self.assertEqual(_calendar_punch_times(view), {
                "check_in_times": ["07:47"], "check_out_times": ["11:24", "16:23"],
            })
            self.assertEqual(_attendance_day_value(view), 1)
            self.assertEqual(_calc_record_work_hours(view)[0], 7.38)
            self.assertEqual(manager_daily_attendance_values("2026-09", [view]), {date(2026, 9, 1): 1})
        self.assertEqual(record.employee_payload, original)
        self.assertEqual(record.manager_payload, manager_original)

    def test_short_employee_punch_day_uses_manager_full_day_rule(self):
        employee, record = self.make_record(punches="08:00,09:00")
        record.employee_payload = {
            "check_in_times": ["08:00"], "check_out_times": ["09:00"],
            "actual_hours": 1, "raw_data": {"刷卡时间数据": "08:00,09:00"},
        }
        view = build_attendance_record_view(record, employee, EMPLOYEE_STATS_CONTEXT)
        self.assertEqual(_attendance_day_value(view), 1)
        self.assertFalse(_effective_is_half_day(view, None, 1))

    def test_existing_manager_punches_take_priority(self):
        employee, record = self.make_record()
        record.manager_payload["raw_data"] = {"上班1打卡时间": "08:03", "下班1打卡时间": "17:00"}
        view = build_attendance_record_view(record, employee, EMPLOYEE_STATS_CONTEXT)
        self.assertEqual(_calendar_punch_times(view), {"check_in_times": ["08:03"], "check_out_times": ["17:00"]})
        self.assertEqual(view.actual_hours, 0)

    def test_other_employee_does_not_receive_fallback(self):
        employee, record = self.make_record(emp_no="101026001")
        view = build_attendance_record_view(record, employee, EMPLOYEE_STATS_CONTEXT)
        self.assertEqual(_attendance_day_value(view), 0)
        self.assertEqual(view.check_in_times, [])

    def test_employee_source_keeps_employee_half_day_rule(self):
        employee, record = self.make_record(source="employee", punches="08:00,09:00")
        record.employee_payload = {
            "check_in_times": ["08:00"], "check_out_times": ["09:00"],
            "actual_hours": 1, "raw_data": {"刷卡时间数据": "08:00,09:00"},
        }
        view = build_attendance_record_view(record, employee, EMPLOYEE_STATS_CONTEXT)
        self.assertEqual(_attendance_day_value(view), 0.5)

    def test_empty_employee_raw_punches_do_not_use_generated_segment_times(self):
        employee, record = self.make_record(punches="")
        view = build_attendance_record_view(record, employee, EMPLOYEE_STATS_CONTEXT)
        self.assertEqual(_attendance_day_value(view), 0)
        self.assertEqual(view.check_in_times, [])

    def test_missing_manager_payload_still_uses_manager_day_rule(self):
        employee, record = self.make_record()
        record.manager_payload = {}
        view = build_attendance_record_view(record, employee, EMPLOYEE_STATS_CONTEXT)
        self.assertEqual(view.source, "manager")
        self.assertEqual(_attendance_day_value(view), 1)
        self.assertEqual(_calc_record_work_hours(view)[0], 7.38)

    def test_daily_overrides_still_take_priority(self):
        employee, record = self.make_record()
        view = build_attendance_record_view(record, employee, EMPLOYEE_STATS_CONTEXT)
        for status, expected in (("缺勤", 0), ("上午出勤", 0.5), ("全勤", 1)):
            override = DailyAttendanceOverride(status=status)
            self.assertEqual(_effective_attendance_day_value(view, override, False), expected)
        self.assertEqual(_effective_attendance_day_value(view, None, True), 1.5)
