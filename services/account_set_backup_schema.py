"""Versioned, explicit business fields for portable account-set backups."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
import hashlib
import json

from models.account_set import AccountSetFactoryRestDay, AccountSetImport
from models.department import Department
from models.employee import Employee
from models.shift import Shift
from models.employee_shift import EmployeeShiftAssignment
from models.daily_record import DailyRecord
from models.monthly_report import MonthlyReport
from models.leave import LeaveRecord
from models.overtime import OvertimeRecord
from models.daily_attendance_override import DailyAttendanceOverride
from models.employee_attendance_override import EmployeeAttendanceOverride
from models.manager_attendance_override import ManagerAttendanceOverride
from models.attendance_override_history import AttendanceOverrideHistory
from models.annual_leave import AnnualLeave
from models.manager_month_stat import ManagerMonthStat
from models.dingtalk_sync_run import DingTalkSyncRun
from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketAdjustment, MealTicketPayment, MealTicketImport, MealTicketImportRow
from models.meal_ledger import MealLedgerRecord, MealLedgerImport


class BackupError(ValueError):
    pass


class BackupTargetChanged(BackupError):
    pass


@dataclass(frozen=True)
class Dataset:
    model: type
    fields: tuple
    key: tuple
    scope: str
    option: str = ''


def spec(model, fields, key, scope, option=''):
    return Dataset(model, tuple(fields.split()), tuple(key.split()), scope, option)


DATASETS = {
    'departments': spec(Department, 'dept_no dept_name is_locked', 'dept_no', 'shared', 'departments'),
    'shifts': spec(Shift, 'shift_no shift_name time_slots is_cross_day', 'shift_no', 'shared', 'shifts'),
    'employees': spec(Employee, 'emp_no name card_no dingtalk_user_id is_manager is_nursing include_in_manager_stats employee_stats_attendance_source manager_stats_attendance_source resigned_at', 'emp_no', 'shared', 'employees'),
    'employee_shift_assignments': spec(EmployeeShiftAssignment, '', 'emp_no', 'shared', 'shifts'),
    'factory_rest': spec(AccountSetFactoryRestDay, 'rest_date rest_period', 'rest_date rest_period', 'account'),
    'daily_records': spec(DailyRecord, 'record_date expected_hours actual_hours absent_hours check_in_times check_out_times leave_hours leave_type overtime_hours overtime_type late_minutes early_leave_minutes exception_reason raw_data employee_payload manager_payload', 'emp_no record_date', 'date'),
    'monthly_reports': Dataset(MonthlyReport, tuple(['report_month'] + ['agg_%02d' % n for n in range(1, 85)] + ['raw_data', 'employee_raw_data', 'manager_raw_data']), ('emp_no', 'report_month'), 'report_month'),
    'leave_records': spec(LeaveRecord, 'leave_no apply_date leave_type start_time end_time duration reason approval_status approval_comment is_revoked is_manual_edited', 'leave_no', 'interval'),
    'overtime_records': spec(OvertimeRecord, 'overtime_no start_time end_time is_weekend is_holiday salary_option effective_hours reason approval_status approval_comment is_revoked is_manual_edited', 'overtime_no', 'interval'),
    'daily_overrides': spec(DailyAttendanceOverride, 'record_date status is_evening_overtime is_actual_attendance work_hours late_minutes early_leave_minutes remark', 'emp_no record_date', 'date'),
    'employee_overrides': spec(EmployeeAttendanceOverride, 'month attendance_days work_hours half_days actual_attendance_days late_early_minutes remark', 'emp_no month', 'month'),
    'manager_overrides': spec(ManagerAttendanceOverride, 'month attendance_days injury_days business_trip_days marriage_days funeral_days late_early_minutes remark', 'emp_no month', 'month'),
    'annual_leave': spec(AnnualLeave, 'year total_days used_days remaining_days', 'emp_no year', 'year', 'annual_stats'),
    'manager_stats': spec(ManagerMonthStat, 'year stat_type prev_dec m1 m2 m3 m4 m5 m6 m7 m8 m9 m10 m11 m12 remaining remark automatic_values manual_values', 'emp_no year stat_type', 'year', 'annual_stats'),
    'override_history': spec(AttendanceOverrideHistory, 'override_type month action_type changed_fields_json before_values_json after_values_json remark source_file_name created_at', 'origin_key', 'month'),
    'sync_history': spec(DingTalkSyncRun, 'month source status read_count imported_count unmatched_count unmatched error_message started_at finished_at', 'origin_key', 'account'),
    'imports': spec(AccountSetImport, 'source_filename file_type status imported_count error_message created_at', 'origin_key', 'account'),
    'meal_batches': spec(MealTicketBatch, 'key month recharge_month rule_version rate_cents status version source_digest created_by confirmed_by created_at confirmed_at reconciliation', 'month', 'account'),
    'meal_items': spec(MealTicketItem, 'key batch_key month emp_no_snapshot name dept_name is_manager days base_cents source error', 'key', 'month'),
    'meal_adjustments': spec(MealTicketAdjustment, 'key item_key month amount_cents reason operator created_at', 'key', 'month'),
    'meal_payments': spec(MealTicketPayment, 'key item_key month kind amount_cents payment_date reference operator request_key request_digest reversal_of created_at', 'key', 'month'),
    'meal_imports': spec(MealTicketImport, 'key month recharge_month source_filename file_digest status operator created_at', 'key', 'month'),
    'meal_import_rows': spec(MealTicketImportRow, 'key import_key month data', 'key', 'month'),
    'meal_ledger_records': spec(MealLedgerRecord, 'key kind month record_date amount_cents data active_slot request_key request_digest source_key operator created_at voided void_reason void_operator voided_at', 'key', 'month'),
    'meal_ledger_imports': spec(MealLedgerImport, 'key kind month source_filename file_digest data status operator created_at', 'key', 'month'),
}
MEAL_DATASETS = {name for name in DATASETS if name.startswith('meal_')}
FILE_DATASETS = {'imports', 'meal_imports', 'meal_ledger_imports'}
ACCOUNT_FIELDS = ('name', 'factory_rest_days', 'monthly_benefit_days')
OPTION_KEYS = ('employees', 'departments', 'shifts', 'annual_stats', 'delete_month_only')
REFS = {
    'employees': {'dept_id': ('dept_no', Department, 'dept_no')},
    'departments': {'parent_id': ('parent_no', Department, 'dept_no')},
    'daily_records': {'shift_id': ('shift_no', Shift, 'shift_no')},
    'employee_shift_assignments': {'shift_id': ('shift_no', Shift, 'shift_no')},
}
HISTORY = {'override_history', 'sync_history', 'imports'}
DELETE_ALLOWED = {'factory_rest', 'daily_records', 'monthly_reports', 'daily_overrides', 'employee_overrides', 'manager_overrides', 'imports'}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def serial(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def business_key(dataset, row):
    if dataset == 'imports':
        # Existing uploader maintains one archive per classified input slot.
        return canonical(['slot', row['file_type']] if row['file_type'] else ['filename', row['source_filename']])
    return canonical([row[field] for field in DATASETS[dataset].key])


def options_checked(options):
    if not isinstance(options, dict) or set(options) - set(OPTION_KEYS):
        raise BackupError('导入选项无效')
    if any(type(value) is not bool for value in options.values()):
        raise BackupError('导入选项必须是布尔值')
    return {key: options.get(key, False) for key in OPTION_KEYS}
