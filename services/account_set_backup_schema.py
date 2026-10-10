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
from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketAdjustment, MealTicketPayment, MealTicketImport, MealTicketImportRow, MealTicketFollowupTask, MealTicketFollowupAllocation
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
    'employees': spec(Employee, 'emp_no name card_no dingtalk_user_id is_manager is_nursing meal_ticket_as_manager include_in_manager_stats employee_stats_attendance_source manager_stats_attendance_source resigned_at', 'emp_no', 'shared', 'employees'),
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


# V1 stays frozen for existing single-month collectors/restorers. V2 declares
# portable fields separately; declaring a dataset does not enable its restore.
from dataclasses import replace
from models.account_set import AccountSet
from models.user import User, UserEmployeeAssignment, UserDepartmentAssignment
from models.monthly_reference_snapshot import MonthlyReferenceSnapshot

V2_DATASETS = dict(DATASETS)
V2_DATASETS['meal_batches'] = replace(DATASETS['meal_batches'], fields=DATASETS['meal_batches'].fields + ('followup_state',))
V2_DATASETS.update({
    'meal_followup_tasks': spec(MealTicketFollowupTask, 'key month batch_key item_key kind amount_cents status version source_snapshot offset_enabled skip_order operator operation_at created_at', 'key', 'month'),
    'meal_followup_allocations': spec(MealTicketFollowupAllocation, 'key month task_key payment_key amount_cents operator created_at', 'key', 'month'),
})
for _name in ('employees', 'departments', 'shifts'):
    V2_DATASETS[_name] = replace(DATASETS[_name], fields=DATASETS[_name].fields + ('is_active',))
V2_DATASETS.update({
    'account_set': spec(AccountSet, 'month name factory_rest_days monthly_benefit_days', 'month', 'month', 'account_settings'),
    'users': spec(User, 'username profile_emp_no profile_name password_hash role page_permissions is_active login_disabled_until_admin_unlock login_disabled_reason created_at', 'username', 'shared', 'accounts'),
    'user_employee_assignments': spec(UserEmployeeAssignment, '', 'username emp_no', 'shared', 'accounts'),
    'user_department_assignments': spec(UserDepartmentAssignment, '', 'username dept_no', 'shared', 'accounts'),
    'snapshots': spec(MonthlyReferenceSnapshot, 'month kind business_key payload provenance quality schema_version created_at updated_at', 'month kind business_key', 'month'),
})
V2_REFS = {name: dict(refs) for name, refs in REFS.items()}
for _name, _dataset in V2_DATASETS.items():
    if hasattr(_dataset.model, 'emp_id'):
        V2_REFS.setdefault(_name, {})['emp_id'] = ('emp_no', Employee, 'emp_no')
    if hasattr(_dataset.model, 'account_set_id'):
        V2_REFS.setdefault(_name, {})['account_set_id'] = ('account_month', AccountSet, 'month')
V2_REFS.update({
    'users': {'profile_dept_id': ('profile_dept_no', Department, 'dept_no')},
    'user_employee_assignments': {'user_id': ('username', User, 'username'), 'emp_id': ('emp_no', Employee, 'emp_no')},
    'user_department_assignments': {'user_id': ('username', User, 'username'), 'dept_id': ('dept_no', Department, 'dept_no')},
})
# Archive paths are allocated locally, never copied from the source machine.
FILE_REFS = {name: {'stored_path': 'file_key'} for name in FILE_DATASETS}
FILE_REFS['users'] = {'avatar': 'avatar_file_key'}
# Optional portable metadata keeps built-in avatar choices without inventing a
# file. Earlier V2 documents that omit it retain their original row shape.
V2_OPTIONAL_FIELDS = {'users': ('avatar_preset',)}
DATASET_CATEGORIES = {
    **{name: 'attendance' for name in DATASETS},
    'account_set': 'account_settings', 'factory_rest': 'account_settings',
    'departments': 'departments', 'employees': 'employees',
    'shifts': 'shifts', 'employee_shift_assignments': 'shifts',
    'users': 'accounts', 'user_employee_assignments': 'accounts', 'user_department_assignments': 'accounts',
    'leave_records': 'cross_month', 'overtime_records': 'cross_month',
    'annual_leave': 'annual_stats', 'manager_stats': 'annual_stats',
    'snapshots': 'monthly_references',
    **{name: ('meal_ledgers' if name.startswith('meal_ledger') else 'meal_tickets') for name in V2_DATASETS if name.startswith('meal_')},
}
DATASET_VERSIONS = {name: 1 for name in V2_DATASETS}
DATASET_VERSIONS['meal_batches'] = 2
DELETION_POLICIES = {name: ('exit_current' if name in ('employees', 'departments', 'shifts', 'users') else 'selected_complete')
                     for name, ds in V2_DATASETS.items()}

# Every exclusion is field-specific. New columns on even an excluded table
# must receive a new decision rather than disappearing behind a table wildcard.
FIELD_EXCLUSIONS = {}

def _exclude(table, fields, reason):
    FIELD_EXCLUSIONS.setdefault(table, {}).update({field: reason for field in fields.split()})

# Explicit table list: a new ORM table with only an ID still fails coverage.
for _table in '''account_sets account_set_factory_rest_days account_set_imports
annual_leave attendance_override_histories daily_attendance_overrides daily_records
departments dingtalk_sync_runs employee_attendance_overrides employee_shift_assignments
employees leave_records manager_attendance_overrides manager_month_stats meal_ledger_imports
meal_ledger_records meal_ticket_adjustments meal_ticket_batches meal_ticket_import_rows
meal_ticket_imports meal_ticket_items meal_ticket_payments meal_ticket_followup_tasks
meal_ticket_followup_allocations monthly_reference_snapshots
monthly_reports overtime_records shifts users user_employee_assignments user_department_assignments'''.split():
    _exclude(_table, 'id', '目标本地 ID；通过业务键重建，不能导入源 ID')
_exclude('account_sets', 'is_active is_locked locked_at locked_by', '目标账套选择与锁定状态；恢复不得覆盖')
_exclude('account_sets', 'created_at updated_at', '目标账套生命周期时间')
_exclude('account_set_factory_rest_days', 'created_at', '目标行创建时间')
_exclude('employees', 'created_at', '目标人员行创建时间')
_exclude('users', 'auth_version', '目标本地令牌撤销版本；恢复仅递增，永不从包导入')
_exclude('users', 'login_failed_attempts login_locked_until', '目标临时登录失败与短期锁定状态')
for _table in ('daily_attendance_overrides', 'employee_attendance_overrides', 'manager_attendance_overrides'):
    _exclude(_table, 'updated_by updated_at', '目标最近编辑元数据；业务差异通过 override_history 保留')
_exclude('attendance_override_histories', 'operator_user_id', '源操作者信息随 provenance 保存，不作为目标用户外键导入')
_exclude('account_set_backup_origins', 'id local_id', '目标来源映射身份；由恢复重建')
_exclude('account_set_backup_origins', 'dataset origin_key provenance', '随 imports/sync_history/override_history 行携带，不整体覆盖映射表')
_exclude('account_set_backup_restores', 'id month operator_id operator_username task_id backup_digest counts created_at', '目标本地恢复审计；不属于可覆盖业务内容')
_exclude('messages', 'id sender_id recipient_id title content created_at read_at', '独立消息与已读状态，不在确认的月度备份范围')
_exclude('system_settings', 'id key value', '安装级配置可能包含凭证，不整表导出；业务使用的月度配置已冻结在 snapshots.payload')
