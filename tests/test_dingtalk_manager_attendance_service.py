import os
import tempfile
import unittest
from datetime import date

from flask import Flask

from models import db
from models.account_set import AccountSet
from models.annual_leave import AnnualLeave
from models.department import Department
from models.daily_record import DailyRecord
from models.dingtalk_sync_run import DingTalkSyncRun
from models.employee import Employee
from models.employee_shift import EmployeeShiftAssignment
from models.leave import LeaveRecord
from models.manager_attendance_override import ManagerAttendanceOverride
from models.manager_month_stat import ManagerMonthStat
from models.monthly_report import MonthlyReport
from models.overtime import OvertimeRecord
from models.shift import Shift
from models.system_setting import SystemSetting
from models.user import User, UserDepartmentAssignment, UserEmployeeAssignment
from services.dingtalk_client import DingTalkClientError
from services.dingtalk_manager_attendance_service import sanitize_dingtalk_error, sync_dingtalk_manager_attendance
from services.manager_attendance_service import ManagerAttendanceOptions, build_manager_rows, manager_day_late_minutes
from services.migration_service import MIGRATION_ORDER


class FakeDingTalkClient:
    def __init__(self, records=None, error=None, directory=None, directory_error=None):
        self.records = records or []
        self.error = error
        self.directory = directory or []
        self.directory_error = directory_error
        self.calls = []
        self.directory_calls = 0

    def directory_users(self):
        self.directory_calls += 1
        if self.directory_error:
            raise self.directory_error
        return self.directory

    def attendance_records(self, user_ids, start_date, end_date):
        self.calls.append((list(user_ids), start_date, end_date))
        if self.error:
            raise self.error
        return self.records


class DingTalkManagerAttendanceServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmpdir.name, "dingtalk-manager.db")
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
            manager = Employee(
                emp_no=" M001 ",
                name="经理甲",
                is_manager=True,
                dingtalk_user_id="user-1",
            )
            other_manager = Employee(
                emp_no="M002",
                name="经理乙",
                is_manager=True,
                dingtalk_user_id="user-2",
            )
            non_manager = Employee(
                emp_no="E001",
                name="员工甲",
                is_manager=False,
                dingtalk_user_id="user-3",
            )
            db.session.add_all([account_set, manager, other_manager, non_manager])
            db.session.commit()
            self.account_set_id = account_set.id
            self.manager_id = manager.id

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.tmpdir.cleanup()

    @staticmethod
    def record(emp_no, day="2026-08-03", **values):
        record = {
            "employee_no": emp_no,
            "employee_user_id": values.pop("employee_user_id", "user-1"),
            "employee_name": values.pop("employee_name", "钉钉姓名"),
            "date": day,
            "punch_in": values.pop("punch_in", None),
            "punch_out": values.pop("punch_out", None),
            "result": values.pop("result", "Normal"),
            "time_result": values.pop("time_result", "Normal"),
            "location_result": values.pop("location_result", "Normal"),
            "is_late": values.pop("is_late", False),
            "is_early_leave": values.pop("is_early_leave", False),
            "raw_payload": values.pop("raw_payload", {"recordId": "raw-1"}),
        }
        record.update(values)
        return record

    def test_sync_imports_matched_manager_and_deduplicates_unmatched_rows(self):
        client = FakeDingTalkClient(
            [
                self.record("m001", punch_in="2026-08-03 08:05:00", raw_payload={"recordId": "matched"}),
                self.record("X009", employee_name="外部经理", punch_in="08:00", raw_payload={"recordId": "missing-in"}),
                self.record(" X009 ", employee_name="外部经理", punch_out="17:00", raw_payload={"recordId": "missing-out"}),
            ]
        )

        with self.app.app_context():
            result = sync_dingtalk_manager_attendance(self.account_set_id, "2026-08", client)
            rows = DailyRecord.query.all()
            run = db.session.get(DingTalkSyncRun, result["sync_run_id"])

            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].emp_id, self.manager_id)
            self.assertEqual(rows[0].manager_payload["check_in_times"], ["08:05"])
            self.assertEqual(result["status"], "partial")
            self.assertEqual(result["read_count"], 3)
            self.assertEqual(result["imported_count"], 1)
            self.assertEqual(result["unmatched_count"], 1)
            self.assertEqual(
                result["unmatched"],
                [{"emp_no": "X009", "name": "外部经理", "record_date": "2026-08-03"}],
            )
            self.assertEqual(run.unmatched, result["unmatched"])
            self.assertEqual(client.calls, [(["user-1", "user-2"], date(2026, 8, 1), date(2026, 8, 31))])

    def test_repeated_sync_updates_the_same_daily_record(self):
        first = FakeDingTalkClient([self.record("M001", punch_in="08:10", result="Late", is_late=True)])
        second = FakeDingTalkClient([self.record("M001", punch_in="07:55", result="Normal")])

        with self.app.app_context():
            sync_dingtalk_manager_attendance(self.account_set_id, "2026-08", first)
            sync_dingtalk_manager_attendance(self.account_set_id, "2026-08", second)

            rows = DailyRecord.query.filter_by(emp_id=self.manager_id, record_date=date(2026, 8, 3)).all()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].manager_payload["check_in_times"], ["07:55"])
            self.assertEqual(DingTalkSyncRun.query.count(), 2)

    def test_directory_job_number_maps_user_id_without_mutating_employee(self):
        client = FakeDingTalkClient(
            records=[
                self.record(
                    None,
                    employee_user_id="directory-user-1",
                    employee_name="经理甲",
                    punch_in="08:02",
                )
            ],
            directory=[
                {
                    "employee_no": "ｍ００１",
                    "employee_user_id": "directory-user-1",
                    "employee_name": "经理甲",
                }
            ],
        )

        with self.app.app_context():
            manager = db.session.get(Employee, self.manager_id)
            manager.dingtalk_user_id = None
            db.session.commit()

            result = sync_dingtalk_manager_attendance(self.account_set_id, "2026-08", client)
            row = DailyRecord.query.one()
            manager = db.session.get(Employee, self.manager_id)

            self.assertEqual(result["status"], "success")
            self.assertEqual(row.emp_id, self.manager_id)
            self.assertEqual(row.manager_payload["check_in_times"], ["08:02"])
            self.assertIsNone(manager.dingtalk_user_id)
            self.assertEqual(client.directory_calls, 1)
            self.assertEqual(
                client.calls,
                [(["user-2", "directory-user-1"], date(2026, 8, 1), date(2026, 8, 31))],
            )

    def test_api_failure_preserves_existing_records_and_persists_failed_run(self):
        client = FakeDingTalkClient(error=DingTalkClientError("DingTalk request failed"))

        with self.app.app_context():
            existing = DailyRecord(
                emp_id=self.manager_id,
                record_date=date(2026, 8, 2),
                manager_payload={"raw_data": {"marker": "keep"}},
            )
            db.session.add(existing)
            db.session.commit()

            result = sync_dingtalk_manager_attendance(self.account_set_id, "2026-08", client)

            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["error"], "DingTalk request failed")
            self.assertEqual(DailyRecord.query.count(), 1)
            self.assertEqual(DailyRecord.query.one().manager_payload["raw_data"]["marker"], "keep")
            run = DingTalkSyncRun.query.one()
            self.assertEqual(run.status, "failed")
            self.assertIsNotNone(run.finished_at)

    def test_directory_job_number_mismatches_are_reported_without_requesting_their_attendance(self):
        client = FakeDingTalkClient(
            records=[self.record(None, employee_user_id="directory-user-1", punch_in="08:00")],
            directory=[
                {"employee_no": "ｍ００１", "employee_user_id": "directory-user-1", "employee_name": "经理甲"},
                {"employee_no": "X009", "employee_user_id": "unknown-user", "employee_name": "未匹配经理"},
                {"employee_no": " X009 ", "employee_user_id": "unknown-user", "employee_name": "未匹配经理"},
            ],
        )
        with self.app.app_context():
            db.session.get(Employee, self.manager_id).dingtalk_user_id = None
            db.session.commit()
            result = sync_dingtalk_manager_attendance(self.account_set_id, "2026-08", client)

            self.assertEqual(result["status"], "partial")
            self.assertEqual(result["imported_count"], 1)
            self.assertEqual(result["unmatched_count"], 1)
            self.assertEqual(result["unmatched"], [{"emp_no": "X009", "name": "未匹配经理", "record_date": ""}])
            self.assertEqual(DingTalkSyncRun.query.one().unmatched, result["unmatched"])
            self.assertEqual(DailyRecord.query.one().emp_id, self.manager_id)
            self.assertEqual(client.calls[0][0], ["user-2", "directory-user-1"])

    def test_directory_entries_matching_local_employees_are_not_reported(self):
        client = FakeDingTalkClient(
            records=[self.record(None, employee_user_id="directory-user-1", punch_in="08:00")],
            directory=[
                {"employee_no": "ｍ００１", "employee_user_id": "directory-user-1", "employee_name": "经理甲"},
                {"employee_no": "E001", "employee_user_id": "staff-user", "employee_name": "员工甲"},
                {"employee_no": "X009", "employee_user_id": "unknown-user", "employee_name": "陌生工号"},
            ],
        )
        with self.app.app_context():
            db.session.get(Employee, self.manager_id).dingtalk_user_id = None
            db.session.commit()
            result = sync_dingtalk_manager_attendance(self.account_set_id, "2026-08", client)

            self.assertEqual(result["status"], "partial")
            self.assertEqual(result["unmatched"], [{"emp_no": "X009", "name": "陌生工号", "record_date": ""}])
            self.assertEqual(client.calls[0][0], ["user-2", "directory-user-1"])

    def test_sanitized_directory_error_names_the_directory_permission(self):
        self.assertIn(
            "通讯录",
            sanitize_dingtalk_error(DingTalkClientError("DingTalk directory request returned an error")),
        )

    def test_successful_dingtalk_sync_uses_daily_stats_instead_of_stale_excel_monthly_summary(self):
        for report_month in ("2026-08", "1970-01"):
            with self.subTest(report_month=report_month), self.app.app_context():
                MonthlyReport.query.delete()
                db.session.add(MonthlyReport(
                    emp_id=self.manager_id,
                    report_month=report_month,
                    manager_raw_data={"出勤天数": 23},
                ))
                SystemSetting.set_value("manager_attendance_source", "dingtalk")
                db.session.commit()
                sync_dingtalk_manager_attendance(
                    self.account_set_id,
                    "2026-08",
                    FakeDingTalkClient([self.record("M001", punch_in="08:00", punch_out="17:00")]),
                )

                row = build_manager_rows(ManagerAttendanceOptions(month="2026-08"), emp_ids=[self.manager_id])[0]

                self.assertEqual(row["actual_attendance_days"], 1)
                self.assertEqual(row["attendance_days"], 1)
                self.assertEqual(row["punch_days"], 1)
                self.assertEqual(MonthlyReport.query.one().manager_raw_data["出勤天数"], 23)

    def test_partial_dingtalk_sync_uses_matched_daily_stats(self):
        with self.app.app_context():
            SystemSetting.set_value("manager_attendance_source", "dingtalk")
            db.session.add(MonthlyReport(emp_id=self.manager_id, report_month="2026-08", manager_raw_data={"出勤天数": 23}))
            db.session.commit()
            result = sync_dingtalk_manager_attendance(
                self.account_set_id, "2026-08",
                FakeDingTalkClient([self.record("M001", punch_in="08:00"), self.record("X009", punch_in="08:00")]),
            )
            row = build_manager_rows(ManagerAttendanceOptions(month="2026-08"), emp_ids=[self.manager_id])[0]

            self.assertEqual(result["status"], "partial")
            self.assertEqual(row["attendance_days"], 1)

    def test_local_source_or_failed_initial_sync_retains_excel_monthly_summary(self):
        for source, sync_error in (("local", None), ("dingtalk", DingTalkClientError("DingTalk request failed"))):
            with self.subTest(source=source), self.app.app_context():
                DingTalkSyncRun.query.delete()
                MonthlyReport.query.delete()
                SystemSetting.set_value("manager_attendance_source", source)
                db.session.add(MonthlyReport(emp_id=self.manager_id, report_month="2026-08", manager_raw_data={"出勤天数": 23}))
                db.session.commit()
                sync_dingtalk_manager_attendance(
                    self.account_set_id, "2026-08",
                    FakeDingTalkClient([self.record("M001", punch_in="08:00")], error=sync_error),
                )
                row = build_manager_rows(ManagerAttendanceOptions(month="2026-08"), emp_ids=[self.manager_id])[0]

                self.assertEqual(row["attendance_days"], 23)

    def test_records_outside_requested_month_are_ignored(self):
        client = FakeDingTalkClient(
            [
                self.record("M001", day="2026-08-31", punch_in="08:00"),
                self.record("M001", day="2026-09-01", punch_in="08:00"),
            ]
        )

        with self.app.app_context():
            result = sync_dingtalk_manager_attendance(self.account_set_id, "2026-08", client)

            self.assertEqual(result["read_count"], 2)
            self.assertEqual(result["imported_count"], 1)
            self.assertEqual([row.record_date for row in DailyRecord.query.all()], [date(2026, 8, 31)])

    def test_raw_dingtalk_fields_are_preserved_in_manager_payload(self):
        raw = {
            "id": 7788,
            "checkType": "OffDuty",
            "userCheckTime": 1785778200000,
            "timeResult": "Early",
            "locationResult": "Outside",
            "nested": {"device": "turnstile-4"},
        }
        client = FakeDingTalkClient(
            [
                self.record(
                    "M001",
                    punch_out=1785778200000,
                    result="Early",
                    time_result="Early",
                    location_result="Outside",
                    is_early_leave=True,
                    early_leave_minutes=7,
                    raw_payload=raw,
                )
            ]
        )

        with self.app.app_context():
            sync_dingtalk_manager_attendance(self.account_set_id, "2026-08", client)
            row = DailyRecord.query.one()

            self.assertEqual(row.manager_payload["raw_data"]["dingtalk_records"], [raw])
            self.assertEqual(row.raw_data["nested"], {"device": "turnstile-4"})
            self.assertEqual(row.manager_payload["early_leave_minutes"], 7)

    def test_duration_minutes_only_compare_the_matching_scheduled_slot(self):
        client = FakeDingTalkClient(
            [
                self.record(
                    "M001",
                    punch_in="07:50",
                    raw_payload={
                        "checkType": "OnDuty",
                        "userCheckTime": "07:50",
                        "baseCheckTime": "08:00",
                    },
                ),
                self.record(
                    "M001",
                    punch_out="18:10",
                    raw_payload={
                        "checkType": "OffDuty",
                        "userCheckTime": "18:10",
                        "baseCheckTime": "17:00",
                    },
                ),
                self.record(
                    "M001",
                    punch_in="08:07",
                    result="Late",
                    time_result="Late",
                    is_late=True,
                    raw_payload={
                        "checkType": "OnDuty",
                        "userCheckTime": "08:07",
                        "baseCheckTime": "08:00",
                    },
                ),
                self.record(
                    "M001",
                    punch_out="16:55",
                    result="Early",
                    time_result="Early",
                    is_early_leave=True,
                    raw_payload={
                        "checkType": "OffDuty",
                        "userCheckTime": "16:55",
                        "baseCheckTime": "17:00",
                    },
                ),
            ]
        )

        with self.app.app_context():
            sync_dingtalk_manager_attendance(self.account_set_id, "2026-08", client)
            row = DailyRecord.query.one()

            self.assertEqual(row.manager_payload["late_minutes"], 7)
            self.assertEqual(row.manager_payload["early_leave_minutes"], 5)

    def test_not_signed_zero_check_time_is_missing_in_manager_payload(self):
        client = FakeDingTalkClient(
            [
                self.record(
                    "M001",
                    punch_in=0,
                    result="NotSigned",
                    time_result="NotSigned",
                    raw_payload={
                        "checkType": "OnDuty",
                        "userCheckTime": 0,
                        "baseCheckTime": 1785724800000,
                        "timeResult": "NotSigned",
                    },
                )
            ]
        )

        with self.app.app_context():
            sync_dingtalk_manager_attendance(self.account_set_id, "2026-08", client)
            payload = DailyRecord.query.one().manager_payload

            self.assertEqual(payload["check_in_times"], [])
            self.assertEqual(payload["actual_hours"], 0)
            self.assertEqual(payload["late_minutes"], 0)
            self.assertNotIn("刷卡时间数据", payload["raw_data"])
            self.assertNotIn("上班1打卡时间", payload["raw_data"])

    def test_missing_earlier_punch_preserves_valid_later_slot_hours(self):
        for missing_side in ("OnDuty", "OffDuty"):
            for missing_time in (0, "0", None):
                with self.subTest(missing_side=missing_side, missing_time=missing_time), self.app.app_context():
                    records = []
                    for check_type, expected in (("OnDuty", "08:00"), ("OffDuty", "12:00"), ("OnDuty", "13:00"), ("OffDuty", "17:00")):
                        missing = check_type == missing_side and expected in ("08:00", "12:00")
                        actual = missing_time if missing else expected
                        result = "NotSigned" if missing else "Normal"
                        records.append(self.record(
                            "M001",
                            **{"punch_in" if check_type == "OnDuty" else "punch_out": actual},
                            result=result,
                            time_result=result,
                            raw_payload={"checkType": check_type, "baseCheckTime": expected, "userCheckTime": actual, "timeResult": result},
                        ))
                    sync_dingtalk_manager_attendance(
                        self.account_set_id, "2026-08", FakeDingTalkClient(list(reversed(records))),
                    )

                    self.assertEqual(DailyRecord.query.one().manager_payload["actual_hours"], 4)

    def test_dingtalk_results_are_translated_for_manager_statistics(self):
        client = FakeDingTalkClient(
            [
                self.record(
                    "M001",
                    day="2026-08-04",
                    punch_in="08:07",
                    result="Late",
                    time_result="Late",
                    is_late=True,
                    late_minutes=7,
                ),
                self.record(
                    "M001",
                    day="2026-08-05",
                    punch_in="08:20",
                    result="SeriousLate",
                    time_result="SeriousLate",
                    is_late=True,
                    late_minutes=20,
                ),
                self.record(
                    "M001",
                    day="2026-08-06",
                    punch_out="16:55",
                    result="Early",
                    time_result="Early",
                    is_early_leave=True,
                    early_leave_minutes=5,
                ),
                self.record(
                    "M001",
                    day="2026-08-07",
                    punch_in="10:00",
                    result="Absenteeism",
                    time_result="Absenteeism",
                    is_late=True,
                    late_minutes=120,
                ),
            ]
        )

        with self.app.app_context():
            sync_dingtalk_manager_attendance(self.account_set_id, "2026-08", client)
            rows = {row.record_date: row for row in DailyRecord.query.all()}

            self.assertEqual(rows[date(2026, 8, 4)].raw_data["上班1打卡结果"], "迟到")
            self.assertEqual(rows[date(2026, 8, 5)].raw_data["上班1打卡结果"], "严重迟到")
            self.assertEqual(rows[date(2026, 8, 6)].raw_data["下班1打卡结果"], "早退")
            self.assertEqual(rows[date(2026, 8, 7)].raw_data["上班1打卡结果"], "旷工迟到")
            self.assertEqual(manager_day_late_minutes(rows[date(2026, 8, 4)]), 7)

    def test_deleting_account_set_cascades_its_sync_runs(self):
        with self.app.app_context():
            sync_dingtalk_manager_attendance(
                self.account_set_id,
                "2026-08",
                FakeDingTalkClient(),
            )
            account_set = db.session.get(AccountSet, self.account_set_id)
            db.session.delete(account_set)
            db.session.commit()

            self.assertEqual(DingTalkSyncRun.query.count(), 0)

    def test_database_migration_order_keeps_sync_runs_after_account_sets(self):
        self.assertLess(MIGRATION_ORDER.index("account_sets"), MIGRATION_ORDER.index("dingtalk_sync_runs"))


if __name__ == "__main__":
    unittest.main()
