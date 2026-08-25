import os
import tempfile
import unittest
from datetime import date, datetime
from types import SimpleNamespace

from flask import Flask

from models import db
from models.account_set import AccountSet, AccountSetFactoryRestDay  # noqa: F401 —— 注册外键关联表
from models.annual_leave import AnnualLeave  # noqa: F401 —— 注册外键关联表
from models.attendance_override_history import AttendanceOverrideHistory  # noqa: F401 —— 注册外键关联表
from models.daily_attendance_override import DailyAttendanceOverride
from models.daily_record import DailyRecord
from models.department import Department
from models.employee import Employee
from models.employee_attendance_override import EmployeeAttendanceOverride  # noqa: F401 —— 注册外键关联表
from models.employee_shift import EmployeeShiftAssignment  # noqa: F401 —— 注册外键关联表
from models.leave import LeaveRecord
from models.manager_attendance_override import ManagerAttendanceOverride  # noqa: F401 —— 注册外键关联表
from models.manager_month_stat import ManagerMonthStat  # noqa: F401 —— 注册外键关联表
from models.monthly_report import MonthlyReport
from models.overtime import OvertimeRecord  # noqa: F401 —— 注册外键关联表
from models.shift import Shift  # noqa: F401 —— 注册外键关联表
from models.user import User  # noqa: F401 —— 注册外键关联表
from models.user import UserDepartmentAssignment, UserEmployeeAssignment  # noqa: F401 —— 注册外键关联表
from services.late_offset_service import (
    LATE_OFFSET_MAX_MINUTES,
    late_offset_candidates,
    late_offset_minutes,
    confirm_late_offset,
)
from services.manager_attendance_service import ManagerAttendanceOptions, build_manager_rows


class LateOffsetMinutesTests(unittest.TestCase):
    def test_extracts_minutes_from_reason_text(self) -> None:
        leave = SimpleNamespace(leave_type="事假", reason="迟到冲抵20分钟")
        self.assertEqual(late_offset_minutes(leave), 20)

    def test_extracts_minutes_from_leave_type_text(self) -> None:
        leave = SimpleNamespace(leave_type="事假（迟到冲抵15分钟）", reason="")
        self.assertEqual(late_offset_minutes(leave), 15)

    def test_returns_none_when_text_has_no_minutes(self) -> None:
        leave = SimpleNamespace(leave_type="事假", reason="家中有事")
        self.assertIsNone(late_offset_minutes(leave))

    def test_returns_none_when_minutes_exceed_limit(self) -> None:
        leave = SimpleNamespace(leave_type="事假", reason=f"请假{LATE_OFFSET_MAX_MINUTES + 5}分钟")
        self.assertIsNone(late_offset_minutes(leave))

    def test_limit_boundary_is_included(self) -> None:
        leave = SimpleNamespace(leave_type="事假", reason=f"冲抵{LATE_OFFSET_MAX_MINUTES}分钟")
        self.assertEqual(late_offset_minutes(leave), LATE_OFFSET_MAX_MINUTES)

    def test_one_hour_leave_counts_as_offset(self) -> None:
        leave = SimpleNamespace(leave_type="事假", reason="请假60分钟")
        self.assertEqual(late_offset_minutes(leave), 60)

    def test_one_hour_text_in_hour_unit(self) -> None:
        leave = SimpleNamespace(leave_type="事假", reason="请假1小时")
        self.assertEqual(late_offset_minutes(leave), 60)

    def test_one_hour_text_in_chinese_number(self) -> None:
        leave = SimpleNamespace(leave_type="事假", reason="请假一小时")
        self.assertEqual(late_offset_minutes(leave), 60)

    def test_half_hour_text(self) -> None:
        leave = SimpleNamespace(leave_type="事假", reason="半小时")
        self.assertEqual(late_offset_minutes(leave), 30)

    def test_hour_with_h_suffix(self) -> None:
        leave = SimpleNamespace(leave_type="事假", reason="外出1h")
        self.assertEqual(late_offset_minutes(leave), 60)

    def test_two_hours_exceeds_limit(self) -> None:
        leave = SimpleNamespace(leave_type="事假", reason="请假2小时")
        self.assertIsNone(late_offset_minutes(leave))

    def test_same_day_time_span_fallback(self) -> None:
        leave = SimpleNamespace(
            leave_type="事假",
            reason="有事",
            start_time=datetime(2026, 7, 16, 8, 0),
            end_time=datetime(2026, 7, 16, 8, 59),
        )
        self.assertEqual(late_offset_minutes(leave), 59)

    def test_time_span_text_takes_priority(self) -> None:
        leave = SimpleNamespace(
            leave_type="事假",
            reason="迟到冲抵20分钟",
            start_time=datetime(2026, 7, 16, 8, 0),
            end_time=datetime(2026, 7, 16, 8, 59),
        )
        self.assertEqual(late_offset_minutes(leave), 20)

    def test_time_span_over_one_hour_not_offset(self) -> None:
        leave = SimpleNamespace(
            leave_type="事假",
            reason="有事",
            start_time=datetime(2026, 7, 16, 8, 0),
            end_time=datetime(2026, 7, 16, 12, 0),
        )
        self.assertIsNone(late_offset_minutes(leave))

    def test_cross_day_time_span_not_offset(self) -> None:
        leave = SimpleNamespace(
            leave_type="事假",
            reason="有事",
            start_time=datetime(2026, 7, 16, 8, 0),
            end_time=datetime(2026, 7, 17, 8, 30),
        )
        self.assertIsNone(late_offset_minutes(leave))


class LateOffsetCandidateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmpdir.name, "late-offset.db")

        app = Flask(__name__)
        app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.db_path}",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
        )
        db.init_app(app)
        self.app = app

        with self.app.app_context():
            db.create_all()
            dept = Department(dept_no="D001", dept_name="品质部")
            manager = Employee(emp_no="M001", name="张管理", is_manager=True)
            staff = Employee(emp_no="E001", name="李员工", is_manager=False)
            db.session.add_all([dept, manager, staff])
            db.session.flush()
            manager.dept_id = dept.id
            db.session.add(
                MonthlyReport(
                    emp_id=manager.id,
                    report_month="2026-04",
                    manager_raw_data={"出勤天数": 23, "迟到时长": 20},
                )
            )
            db.session.add(
                DailyRecord(
                    emp_id=manager.id,
                    record_date=date(2026, 4, 18),
                    late_minutes=20,
                    raw_data={"上班1打卡结果": "迟到", "迟到时长": 20},
                    manager_payload={
                        "late_minutes": 20,
                        "early_leave_minutes": 0,
                        "raw_data": {"上班1打卡结果": "迟到", "迟到时长": 20},
                    },
                )
            )
            db.session.add(
                LeaveRecord(
                    leave_no="L0001",
                    emp_id=manager.id,
                    leave_type="事假",
                    start_time=datetime(2026, 4, 18, 8, 30),
                    end_time=datetime(2026, 4, 18, 8, 50),
                    duration=0.33,
                    reason="迟到冲抵20分钟",
                )
            )
            db.session.commit()
            self.manager_id = manager.id
            self.staff_id = staff.id

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.tmpdir.cleanup()

    def _candidates(self, month: str = "2026-04"):
        with self.app.app_context():
            return late_offset_candidates(month)

    def test_lists_candidate_with_offset(self) -> None:
        rows = self._candidates()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["emp_id"], self.manager_id)
        self.assertEqual(row["emp_no"], "M001")
        self.assertEqual(row["emp_name"], "张管理")
        self.assertEqual(row["date"], "2026-04-18")
        self.assertEqual(row["late_minutes"], 20)
        self.assertEqual(row["offset_minutes"], 20)
        self.assertEqual(row["effective_late_minutes"], 0)

    def test_includes_day_over_thirty(self) -> None:
        with self.app.app_context():
            record = DailyRecord.query.filter_by(emp_id=self.manager_id).first()
            record.late_minutes = 40
            record.raw_data = {"上班1打卡结果": "迟到", "迟到时长": 40}
            record.manager_payload = {
                "late_minutes": 40,
                "early_leave_minutes": 0,
                "raw_data": {"上班1打卡结果": "迟到", "迟到时长": 40},
            }
            db.session.commit()
        rows = self._candidates()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["late_minutes"], 40)
        self.assertEqual(rows[0]["offset_minutes"], 20)
        self.assertEqual(rows[0]["effective_late_minutes"], 20)

    def test_excludes_day_with_manual_late_override(self) -> None:
        with self.app.app_context():
            db.session.add(
                DailyAttendanceOverride(
                    emp_id=self.manager_id,
                    record_date=date(2026, 4, 18),
                    late_minutes=10,
                )
            )
            db.session.commit()
        self.assertEqual(self._candidates(), [])

    def test_excludes_non_manager_employees(self) -> None:
        with self.app.app_context():
            db.session.add(
                DailyRecord(
                    emp_id=self.staff_id,
                    record_date=date(2026, 4, 18),
                    late_minutes=15,
                    raw_data={},
                )
            )
            db.session.add(
                LeaveRecord(
                    leave_no="L0002",
                    emp_id=self.staff_id,
                    leave_type="事假",
                    start_time=datetime(2026, 4, 18, 8, 30),
                    end_time=datetime(2026, 4, 18, 8, 45),
                    duration=0.25,
                    reason="迟到冲抵15分钟",
                )
            )
            db.session.commit()
        rows = self._candidates()
        self.assertEqual([row["emp_id"] for row in rows], [self.manager_id])

    def test_accumulates_multiple_leaves_on_same_day(self) -> None:
        with self.app.app_context():
            db.session.add(
                DailyRecord(
                    emp_id=self.manager_id,
                    record_date=date(2026, 4, 19),
                    late_minutes=25,
                    raw_data={"上班1打卡结果": "迟到", "迟到时长": 25},
                )
            )
            db.session.add_all(
                [
                    LeaveRecord(
                        leave_no="L0010",
                        emp_id=self.manager_id,
                        leave_type="事假",
                        start_time=datetime(2026, 4, 19, 8, 30),
                        end_time=datetime(2026, 4, 19, 8, 40),
                        duration=0.17,
                        reason="冲抵10分钟",
                    ),
                    LeaveRecord(
                        leave_no="L0011",
                        emp_id=self.manager_id,
                        leave_type="事假",
                        start_time=datetime(2026, 4, 19, 10, 0),
                        end_time=datetime(2026, 4, 19, 10, 10),
                        duration=0.17,
                        reason="冲抵10分钟",
                    ),
                ]
            )
            db.session.commit()
        rows = self._candidates()
        row = next(item for item in rows if item["date"] == "2026-04-19")
        self.assertEqual(row["late_minutes"], 25)
        self.assertEqual(row["offset_minutes"], 20)
        self.assertEqual(row["effective_late_minutes"], 5)

    def test_candidates_filter_by_emp_ids(self) -> None:
        with self.app.app_context():
            staff_only = late_offset_candidates("2026-04", [self.staff_id])
            manager_only = late_offset_candidates("2026-04", [self.manager_id])
            none_scope = late_offset_candidates("2026-04", [])
        self.assertEqual(staff_only, [])
        self.assertEqual([row["emp_id"] for row in manager_only], [self.manager_id])
        self.assertEqual(none_scope, [])

    def test_late_day_without_leave_shows_zero_offset(self) -> None:
        with self.app.app_context():
            LeaveRecord.query.filter_by(leave_no="L0001").delete()
            db.session.add(
                DailyRecord(
                    emp_id=self.manager_id,
                    record_date=date(2026, 4, 19),
                    late_minutes=25,
                    raw_data={"上班1打卡结果": "迟到", "迟到时长": 25},
                )
            )
            db.session.commit()
        rows = self._candidates()
        self.assertEqual(len(rows), 2)
        by_date = {row["date"]: row for row in rows}
        self.assertEqual(by_date["2026-04-18"]["offset_minutes"], 0)
        self.assertEqual(by_date["2026-04-18"]["effective_late_minutes"], 20)
        self.assertEqual(by_date["2026-04-19"]["offset_minutes"], 0)
        self.assertEqual(by_date["2026-04-19"]["effective_late_minutes"], 25)

    def test_confirm_without_leave_uses_edited_offset(self) -> None:
        with self.app.app_context():
            LeaveRecord.query.filter_by(leave_no="L0001").delete()
            db.session.commit()
            row = confirm_late_offset(self.manager_id, date(2026, 4, 18), offset_minutes=15)
            db.session.commit()
            self.assertEqual(row["late_minutes"], 5)

    def test_confirm_without_leave_and_offset_keeps_late(self) -> None:
        with self.app.app_context():
            LeaveRecord.query.filter_by(leave_no="L0001").delete()
            db.session.commit()
            row = confirm_late_offset(self.manager_id, date(2026, 4, 18))
            db.session.commit()
            self.assertEqual(row["late_minutes"], 20)

    def test_leaves_without_minutes_text_do_not_match(self) -> None:
        with self.app.app_context():
            leave = LeaveRecord.query.filter_by(leave_no="L0001").first()
            leave.reason = "上午外出办事"
            # 起止改为半天（超一小时），文本与时间差都不命中冲抵口径
            leave.start_time = datetime(2026, 4, 18, 8, 30)
            leave.end_time = datetime(2026, 4, 18, 12, 0)
            db.session.commit()
        rows = self._candidates()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["offset_minutes"], 0)
        self.assertEqual(rows[0]["effective_late_minutes"], 20)


class LateOffsetConfirmTests(LateOffsetCandidateTests):
    def test_confirm_writes_daily_override(self) -> None:
        with self.app.app_context():
            row = confirm_late_offset(self.manager_id, date(2026, 4, 18))
            db.session.commit()
            self.assertEqual(row["late_minutes"], 0)
            override = DailyAttendanceOverride.query.filter_by(
                emp_id=self.manager_id, record_date=date(2026, 4, 18)
            ).first()
            self.assertIsNotNone(override)
            self.assertEqual(override.late_minutes, 0)
            self.assertIn("迟到冲抵", override.remark or "")

    def test_confirm_keeps_existing_override_fields(self) -> None:
        with self.app.app_context():
            existing = DailyAttendanceOverride(
                emp_id=self.manager_id,
                record_date=date(2026, 4, 18),
                status="病假",
                work_hours=4.0,
            )
            db.session.add(existing)
            db.session.commit()

            confirm_late_offset(self.manager_id, date(2026, 4, 18))
            db.session.commit()
            db.session.refresh(existing)
            self.assertEqual(existing.status, "病假")
            self.assertEqual(existing.work_hours, 4.0)
            self.assertEqual(existing.late_minutes, 0)

    def test_confirmed_day_no_longer_candidate(self) -> None:
        with self.app.app_context():
            confirm_late_offset(self.manager_id, date(2026, 4, 18))
            db.session.commit()
        self.assertEqual(self._candidates(), [])

    def test_confirm_reduces_manager_late_penalty(self) -> None:
        with self.app.app_context():
            before = build_manager_rows(
                ManagerAttendanceOptions(month="2026-04", factory_rest_days=7.0),
                [self.manager_id],
            )
            self.assertEqual(before[0]["late_early_minutes"], 20)
            confirm_late_offset(self.manager_id, date(2026, 4, 18))
            db.session.commit()
            after = build_manager_rows(
                ManagerAttendanceOptions(month="2026-04", factory_rest_days=7.0),
                [self.manager_id],
            )
            self.assertEqual(after[0]["late_early_minutes"], 0)

    def test_nursing_manager_excluded(self) -> None:
        with self.app.app_context():
            manager = Employee.query.get(self.manager_id)
            manager.is_nursing = True
            db.session.commit()
        self.assertEqual(self._candidates(), [])
        with self.app.app_context():
            with self.assertRaises(ValueError):
                confirm_late_offset(self.manager_id, date(2026, 4, 18))

    def test_confirm_accepts_edited_offset_minutes(self) -> None:
        with self.app.app_context():
            row = confirm_late_offset(self.manager_id, date(2026, 4, 18), offset_minutes=8)
            db.session.commit()
            self.assertEqual(row["late_minutes"], 12)
            override = DailyAttendanceOverride.query.filter_by(
                emp_id=self.manager_id, record_date=date(2026, 4, 18)
            ).first()
            self.assertEqual(override.late_minutes, 12)
            self.assertIn("冲抵8分钟", override.remark or "")

    def test_confirm_rejects_negative_offset_minutes(self) -> None:
        with self.app.app_context():
            with self.assertRaises(ValueError):
                confirm_late_offset(self.manager_id, date(2026, 4, 18), offset_minutes=-5)

    def test_confirm_skips_day_without_late(self) -> None:
        with self.app.app_context():
            DailyRecord.query.filter_by(emp_id=self.manager_id).delete()
            db.session.commit()
            with self.assertRaises(ValueError):
                confirm_late_offset(self.manager_id, date(2026, 4, 18))
