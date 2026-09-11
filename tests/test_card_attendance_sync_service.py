import os
import tempfile
import unittest
from datetime import date

from flask import Flask

from models import db
from models.account_set import AccountSet
from models.annual_leave import AnnualLeave
from models.daily_record import DailyRecord
from models.department import Department
from models.dingtalk_sync_run import DingTalkSyncRun
from models.employee import Employee
from models.employee_shift import EmployeeShiftAssignment
from models.leave import LeaveRecord
from models.manager_attendance_override import ManagerAttendanceOverride
from models.manager_month_stat import ManagerMonthStat
from models.monthly_report import MonthlyReport
from models.overtime import OvertimeRecord
from models.shift import Shift
from models.user import User, UserDepartmentAssignment, UserEmployeeAssignment
from services.card_attendance_sync_service import sync_card_attendance


class FakeCardClient:
    def __init__(self, records=None, error=None):
        self.records = records or []
        self.error = error
        self.calls = []

    def attendance_records(self, start_date, end_date):
        self.calls.append((start_date, end_date))
        if self.error:
            raise self.error
        return self.records


class CardAttendanceSyncServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmpdir.name, "card-sync.db")
        app = Flask(__name__)
        app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.db_path}",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
        )
        db.init_app(app)
        self.app = app

        with app.app_context():
            db.create_all()
            account_set = AccountSet(month="2026-08", name="2026年8月")
            emp_by_no = Employee(emp_no="100201045", name="余应长", is_manager=False, card_no="9999")
            emp_by_card = Employee(emp_no="LOCAL002", name="王金", is_manager=False, card_no="7133697")
            manager = Employee(emp_no="M001", name="经理甲", is_manager=True)
            db.session.add_all([account_set, emp_by_no, emp_by_card, manager])
            db.session.commit()
            self.account_set_id = account_set.id
            self.emp_by_no_id = emp_by_no.id
            self.emp_by_card_id = emp_by_card.id

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.tmpdir.cleanup()

    @staticmethod
    def card_record(person_no, name, day=date(2026, 8, 3), times=None, card_no="", dept="安全管理部"):
        return {
            "person_no": person_no,
            "person_name": name,
            "dept_name": dept,
            "card_no": card_no,
            "record_date": day,
            "times": times if times is not None else ["07:25", "17:09"],
        }

    def test_sync_matches_by_emp_no_then_card_no_and_reports_unmatched(self):
        client = FakeCardClient([
            self.card_record("100201045", "余应长", card_no="9999"),
            self.card_record("10020406", "王金", card_no="7133697"),
            self.card_record("M001", "经理甲"),
            self.card_record("X009", "外部人员"),
        ])

        with self.app.app_context():
            self._assert_sync_matches(client)

    def _assert_sync_matches(self, client):
        result = sync_card_attendance(self.account_set_id, "2026-08", client)

        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["read_count"], 4)
        self.assertEqual(result["imported_count"], 2)
        self.assertEqual(result["unmatched"], [
            {"emp_no": "X009", "name": "外部人员", "record_date": "2026-08-03"},
        ])

        rows = DailyRecord.query.order_by(DailyRecord.emp_id).all()
        self.assertEqual(len(rows), 2)
        row = next(r for r in rows if r.emp_id == self.emp_by_no_id)
        self.assertEqual(row.record_date, date(2026, 8, 3))
        self.assertEqual(row.check_in_times, ["07:25"])
        self.assertEqual(row.check_out_times, ["17:09"])
        self.assertEqual(row.actual_hours, 9.73)
        self.assertEqual(row.raw_data["刷卡时间数据"], "07:25,17:09")
        self.assertEqual(row.raw_data["人员编号"], "100201045")
        self.assertEqual(row.raw_data["人员名称"], "余应长")
        self.assertEqual(row.raw_data["考勤日期"], "2026-08-03")
        card_row = next(r for r in rows if r.emp_id == self.emp_by_card_id)
        self.assertEqual(card_row.raw_data["人员编号"], "LOCAL002")
        self.assertEqual(card_row.raw_data["card_person_no"], "10020406")
        self.assertEqual(set(card_row.employee_payload.keys()), {
            "expected_hours", "actual_hours", "absent_hours", "check_in_times", "check_out_times",
            "leave_hours", "leave_type", "overtime_hours", "overtime_type", "late_minutes",
            "early_leave_minutes", "exception_reason", "raw_data",
        })

        run = DingTalkSyncRun.query.one()
        self.assertEqual(run.source, "card")
        self.assertEqual(run.month, "2026-08")
        self.assertEqual(run.status, "partial")

    def test_sync_upserts_without_duplicates_on_resync(self):
        with self.app.app_context():
            client = FakeCardClient([self.card_record("100201045", "余应长", times=["07:25", "17:09"])])
            first = sync_card_attendance(self.account_set_id, "2026-08", client)
            self.assertEqual(first["status"], "success")

            client.records = [self.card_record("100201045", "余应长", times=["08:00", "18:00"])]
            second = sync_card_attendance(self.account_set_id, "2026-08", client)

            self.assertEqual(second["status"], "success")
            self.assertEqual(DailyRecord.query.count(), 1)
            row = DailyRecord.query.one()
            self.assertEqual(row.check_in_times, ["08:00"])
            self.assertEqual(row.check_out_times, ["18:00"])
            self.assertEqual(DingTalkSyncRun.query.count(), 2)

    def test_sync_skips_records_outside_month(self):
        with self.app.app_context():
            client = FakeCardClient([
                self.card_record("100201045", "余应长", day=date(2026, 7, 31)),
                self.card_record("100201045", "余应长", day=date(2026, 9, 1)),
            ])
            result = sync_card_attendance(self.account_set_id, "2026-08", client)
            self.assertEqual(result["status"], "success")
            self.assertEqual(result["imported_count"], 0)
            self.assertEqual(result["unmatched_count"], 0)
            self.assertEqual(DailyRecord.query.count(), 0)

    def test_sync_resets_stale_excel_columns_when_overwriting_existing_row(self):
        with self.app.app_context():
            db.session.add(DailyRecord(
                emp_id=self.emp_by_no_id,
                record_date=date(2026, 8, 3),
                shift_id=None,
                expected_hours=8.0,
                absent_hours=2.0,
                late_minutes=15,
                early_leave_minutes=10,
                leave_hours=4.0,
                leave_type="事假",
                overtime_hours=3.0,
                overtime_type="周末加班",
                exception_reason="迟到",
                check_in_times=["08:15"],
                check_out_times=["17:10"],
                raw_data={"人员编号": "100201045", "迟到分钟": 15},
                employee_payload={"late_minutes": 15},
            ))
            db.session.commit()

            client = FakeCardClient([self.card_record("100201045", "余应长", times=["07:25", "17:09"])])
            result = sync_card_attendance(self.account_set_id, "2026-08", client)

            self.assertEqual(result["status"], "success")
            row = DailyRecord.query.one()
            self.assertEqual(row.check_in_times, ["07:25"])
            self.assertIsNone(row.late_minutes)
            self.assertIsNone(row.early_leave_minutes)
            self.assertIsNone(row.expected_hours)
            self.assertIsNone(row.absent_hours)
            self.assertIsNone(row.leave_hours)
            self.assertIsNone(row.leave_type)
            self.assertIsNone(row.overtime_hours)
            self.assertIsNone(row.overtime_type)
            self.assertIsNone(row.exception_reason)
            self.assertEqual(row.raw_data["刷卡时间数据"], "07:25,17:09")

    def test_sync_failure_persists_failed_run(self):
        with self.app.app_context():
            client = FakeCardClient(error=RuntimeError("login failed for user 'card_user'"))
            result = sync_card_attendance(self.account_set_id, "2026-08", client)
            self.assertEqual(result["status"], "failed")
            self.assertIn("login failed", str(result["error"]))
            self.assertEqual(DailyRecord.query.count(), 0)
            run = DingTalkSyncRun.query.one()
            self.assertEqual(run.source, "card")
            self.assertEqual(run.status, "failed")

    def test_sync_requires_existing_account_set(self):
        with self.app.app_context():
            with self.assertRaises(ValueError):
                sync_card_attendance(9999, "2026-08", FakeCardClient())


if __name__ == "__main__":
    unittest.main()
