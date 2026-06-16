import tempfile
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest import mock

from flask import Flask

from models import db
import app  # noqa: F401 —— 触发全部模型注册到 metadata，使 db.create_all() 建全表
from models.employee import Employee
from models.leave import LeaveRecord
from services.attendance_service import AttendanceService
from services.attendance_source_service import EMPLOYEE_STATS_CONTEXT
from services.attendance_summary_service import batch_monthly_summaries


def monthly_totals(**overrides) -> SimpleNamespace:
    defaults = {
        "expected_hours": 0,
        "actual_hours": 0,
        "absent_hours": 0,
        "leave_hours": 0,
        "overtime_hours": 0,
        "late_minutes": 0,
        "early_leave_minutes": 0,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class BatchMonthlySummariesTests(unittest.TestCase):
    def test_requires_explicit_context(self) -> None:
        with self.assertRaises(TypeError):
            batch_monthly_summaries("2026-05", [])

    def test_batches_employee_month_lookup_once_and_aggregates_totals(self) -> None:
        employees = [SimpleNamespace(id=1), SimpleNamespace(id=2)]
        rows_by_employee = {
            1: [
                monthly_totals(
                    expected_hours=8,
                    actual_hours=7.5,
                    absent_hours=0.5,
                    leave_hours=1.0,
                    overtime_hours=0.5,
                    late_minutes=15,
                    early_leave_minutes=5,
                ),
                monthly_totals(
                    expected_hours=8,
                    actual_hours=8,
                    overtime_hours=1.5,
                    late_minutes=5,
                ),
            ]
        }

        with mock.patch("services.attendance_summary_service.attendance_views_by_employee", return_value=rows_by_employee) as lookup:
            summaries = batch_monthly_summaries("2026-05", employees, EMPLOYEE_STATS_CONTEXT)

        lookup.assert_called_once_with("2026-05", employees, EMPLOYEE_STATS_CONTEXT)
        self.assertEqual(
            summaries[1],
            {
                "expected_hours": 16.0,
                "actual_hours": 15.5,
                "absent_hours": 0.5,
                "leave_hours": 1.0,
                "overtime_hours": 2.0,
                "late_minutes": 20,
                "early_leave_minutes": 5,
            },
        )
        self.assertEqual(
            summaries[2],
            {
                "expected_hours": 0.0,
                "actual_hours": 0.0,
                "absent_hours": 0.0,
                "leave_hours": 0.0,
                "overtime_hours": 0.0,
                "late_minutes": 0,
                "early_leave_minutes": 0,
            },
        )


class AttendanceServiceMonthlySummaryTests(unittest.TestCase):
    def test_monthly_summary_uses_batched_lookup_and_preserves_summary_shape(self) -> None:
        employee = SimpleNamespace(id=7)
        employee_model = mock.Mock()
        employee_model.query.get.return_value = employee
        rows_by_employee = {
            7: [
                monthly_totals(
                    expected_hours=8,
                    actual_hours=7.5,
                    absent_hours=0.5,
                    leave_hours=1.0,
                    overtime_hours=0.5,
                    late_minutes=15,
                    early_leave_minutes=5,
                ),
                monthly_totals(
                    expected_hours=2,
                    actual_hours=1.5,
                    absent_hours=0.5,
                    overtime_hours=0.0,
                    late_minutes=0,
                    early_leave_minutes=1,
                ),
            ]
        }

        with mock.patch("services.attendance_service.Employee", employee_model):
            with mock.patch("services.attendance_summary_service.attendance_views_by_employee", return_value=rows_by_employee) as lookup:
                summary = AttendanceService.monthly_summary(7, "2026-05")

        lookup.assert_called_once_with("2026-05", [employee], EMPLOYEE_STATS_CONTEXT)
        self.assertEqual(
            summary,
            {
                "expected_hours": 10.0,
                "actual_hours": 9.0,
                "absent_hours": 1.0,
                "leave_hours": 1.0,
                "overtime_hours": 0.5,
                "late_minutes": 15,
                "early_leave_minutes": 6,
            },
        )

    def test_monthly_summary_returns_zeroes_when_employee_does_not_exist(self) -> None:
        employee_model = mock.Mock()
        employee_model.query.get.return_value = None

        with mock.patch("services.attendance_service.Employee", employee_model):
            with mock.patch("services.attendance_service.batch_monthly_summaries") as batch_lookup:
                summary = AttendanceService.monthly_summary(99, "2026-05")

        batch_lookup.assert_not_called()
        self.assertEqual(
            summary,
            {
                "expected_hours": 0.0,
                "actual_hours": 0.0,
                "absent_hours": 0.0,
                "leave_hours": 0.0,
                "overtime_hours": 0.0,
                "late_minutes": 0,
                "early_leave_minutes": 0,
            },
        )


class AttendanceServiceYearlySummaryLeaveTests(unittest.TestCase):
    """yearly_summary 的请假时长应仅统计目标年份的记录。

    用真实 SQLite 库写入跨年 LeaveRecord，覆盖原 func.strftime("%Y", ...)
    过滤逻辑，确保改写为跨库写法后行为一致。
    """

    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{self.tmpdir.name}/yearly.db",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
        )
        db.init_app(self.app)
        self.app_context = self.app.app_context()
        self.app_context.push()
        self.addCleanup(self.app_context.pop)
        db.create_all()
        employee = Employee(emp_no="E001", name="测试员工")
        db.session.add(employee)
        db.session.commit()
        self.employee = employee

    def tearDown(self) -> None:
        db.session.remove()
        db.drop_all()

    def _add_leave(self, start_time: str, duration: float) -> None:
        db.session.add(
            LeaveRecord(
                emp_id=self.employee.id,
                leave_no=f"LN-{start_time}",
                leave_type="事假",
                start_time=datetime.strptime(start_time, "%Y-%m-%d"),
                end_time=datetime.strptime(start_time, "%Y-%m-%d"),
                duration=duration,
            )
        )

    def test_yearly_summary_counts_only_leave_records_of_target_year(self) -> None:
        self._add_leave("2025-06-01", 8.0)   # 上一年，应排除
        self._add_leave("2026-01-15", 4.0)   # 目标年
        self._add_leave("2026-06-16", 6.0)   # 目标年
        self._add_leave("2027-03-01", 8.0)   # 下一年，应排除
        db.session.commit()

        with mock.patch("services.attendance_service._get_employee", return_value=self.employee):
            with mock.patch("services.attendance_service.attendance_views_by_employee", return_value={}):
                summary = AttendanceService.yearly_summary(self.employee.id, 2026)

        self.assertEqual(summary["leave_duration"], 10.0)


if __name__ == "__main__":
    unittest.main()
