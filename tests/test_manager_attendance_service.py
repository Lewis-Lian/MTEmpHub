import os
import tempfile
import unittest

from datetime import date, datetime

from flask import Flask

from models import db
from models.annual_leave import AnnualLeave
from models.attendance_override_history import AttendanceOverrideHistory
from models.daily_record import DailyRecord
from models.department import Department
from models.employee import Employee
from models.employee_attendance_override import EmployeeAttendanceOverride
from models.employee_shift import EmployeeShiftAssignment
from models.leave import LeaveRecord
from models.manager_attendance_override import ManagerAttendanceOverride
from models.manager_month_stat import ManagerMonthStat
from models.monthly_report import MonthlyReport
from models.overtime import OvertimeRecord
from models.shift import Shift
from models.user import User
from models.user import UserDepartmentAssignment, UserEmployeeAssignment
from services.manager_attendance_service import ManagerAttendanceOptions, build_manager_rows, normalize_days
from utils.helpers import overlap_duration_days


class NormalizeDaysTests(unittest.TestCase):
    def test_duration_over_three_is_still_treated_as_days(self) -> None:
        self.assertEqual(normalize_days(23.375), 24.0)

    def test_fractional_day_thresholds_still_apply(self) -> None:
        self.assertEqual(normalize_days(0.1), 0.5)
        self.assertEqual(normalize_days(0.25), 1.0)


class OverlapDurationDaysTests(unittest.TestCase):
    def test_splits_cross_month_leave_by_actual_overlap(self) -> None:
        start = datetime(2026, 4, 8, 8, 0, 0)
        end = datetime(2026, 5, 1, 17, 0, 0)

        april_days = overlap_duration_days(
            start,
            end,
            datetime(2026, 4, 1, 0, 0, 0),
            datetime(2026, 5, 1, 0, 0, 0),
        )
        may_days = overlap_duration_days(
            start,
            end,
            datetime(2026, 5, 1, 0, 0, 0),
            datetime(2026, 6, 1, 0, 0, 0),
        )

        self.assertAlmostEqual(april_days, 22.66667, places=5)
        self.assertAlmostEqual(may_days, 0.70833, places=5)
        self.assertEqual(normalize_days(april_days), 23.0)
        self.assertEqual(normalize_days(may_days), 1.0)


class ManagerLateSummaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmpdir.name, "manager-attendance.db")

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
            manager = Employee(emp_no="M001", name="吴利蓉", is_manager=True)
            db.session.add_all([dept, manager])
            db.session.flush()
            manager.dept_id = dept.id
            db.session.add(
                MonthlyReport(
                    emp_id=manager.id,
                    report_month="2026-04",
                    manager_raw_data={"出勤天数": 23, "迟到时长": 6},
                )
            )
            db.session.add_all(
                [
                    DailyRecord(
                        emp_id=manager.id,
                        record_date=date(2026, 4, 18),
                        late_minutes=3,
                        raw_data={"上班1打卡结果": "迟到", "迟到时长": 3},
                        manager_payload={
                            "late_minutes": 3,
                            "early_leave_minutes": 0,
                            "raw_data": {"上班1打卡结果": "迟到", "迟到时长": 3},
                        },
                    ),
                    DailyRecord(
                        emp_id=manager.id,
                        record_date=date(2026, 4, 30),
                        late_minutes=3,
                        raw_data={"上班1打卡结果": "迟到", "迟到时长": 3},
                        manager_payload={
                            "late_minutes": 3,
                            "early_leave_minutes": 0,
                            "raw_data": {"上班1打卡结果": "迟到", "迟到时长": 3},
                        },
                    ),
                ]
            )
            db.session.commit()
            self.manager_id = manager.id

    def tearDown(self) -> None:
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.tmpdir.cleanup()

    def test_manager_summary_counts_late_minutes_from_nested_manager_raw_data(self) -> None:
        with self.app.app_context():
            rows = build_manager_rows(
                ManagerAttendanceOptions(month="2026-04", factory_rest_days=7.0),
                [self.manager_id],
            )

        self.assertEqual(rows[0]["late_early_minutes"], 6)
        self.assertEqual(rows[0]["summary"], "6元")

    def test_manager_summary_ignores_single_day_late_minutes_when_day_reaches_thirty(self) -> None:
        with self.app.app_context():
            record = DailyRecord.query.filter_by(emp_id=self.manager_id, record_date=date(2026, 4, 18)).first()
            record.late_minutes = 30
            record.raw_data = {"上班1打卡结果": "迟到", "迟到时长": 30}
            record.manager_payload = {
                "late_minutes": 30,
                "early_leave_minutes": 0,
                "raw_data": {"上班1打卡结果": "迟到", "迟到时长": 30},
            }
            monthly = MonthlyReport.query.filter_by(emp_id=self.manager_id, report_month="2026-04").first()
            monthly.manager_raw_data = {"出勤天数": 23, "迟到时长": 33}
            db.session.commit()

            rows = build_manager_rows(
                ManagerAttendanceOptions(month="2026-04", factory_rest_days=7.0),
                [self.manager_id],
            )

        self.assertEqual(rows[0]["late_early_minutes"], 3)
        self.assertEqual(rows[0]["summary"], "3元")

    def test_manager_summary_ignores_all_late_penalty_when_every_late_day_reaches_thirty(self) -> None:
        with self.app.app_context():
            for record_date in (date(2026, 4, 18), date(2026, 4, 30)):
                record = DailyRecord.query.filter_by(emp_id=self.manager_id, record_date=record_date).first()
                record.late_minutes = 30
                record.raw_data = {"上班1打卡结果": "迟到", "迟到时长": 30}
                record.manager_payload = {
                    "late_minutes": 30,
                    "early_leave_minutes": 0,
                    "raw_data": {"上班1打卡结果": "迟到", "迟到时长": 30},
                }
            monthly = MonthlyReport.query.filter_by(emp_id=self.manager_id, report_month="2026-04").first()
            monthly.manager_raw_data = {"出勤天数": 23, "迟到时长": 60}
            db.session.commit()

            rows = build_manager_rows(
                ManagerAttendanceOptions(month="2026-04", factory_rest_days=7.0),
                [self.manager_id],
            )

        self.assertEqual(rows[0]["late_early_minutes"], 0)
        self.assertEqual(rows[0]["summary"], "")


if __name__ == "__main__":
    unittest.main()
