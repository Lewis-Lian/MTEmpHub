"""Stage 10 acceptance: real ZIP and ORM writes, synthetic SQLite only."""
from datetime import date, datetime

from models import db
from models.account_set import AccountSet
from models.annual_leave import AnnualLeave
from models.daily_record import DailyRecord
from models.department import Department
from models.employee import Employee
from models.leave import LeaveRecord
from models.user import User, UserDepartmentAssignment, UserEmployeeAssignment
from services.account_set_backup_service import export_multi_backup, read_backup
from services.account_set_restore_service import build_multi_preview, restore_multi_backup
from services.monthly_reference_service import ensure_month_reference
from tests.test_account_set_backup import backup_app


def cross_year_zip():
    AccountSet.query.one().month = '2026-12'
    DailyRecord.query.one().record_date = date(2026, 12, 3)
    leave = LeaveRecord.query.one()
    leave.start_time, leave.end_time = datetime(2026, 12, 31), datetime(2027, 1, 2)
    User.query.one().set_password('synthetic-backup-password')
    User.query.one().profile_dept_id = 1
    db.session.add_all([
        AccountSet(month='2027-01', name='次年一月'),
        DailyRecord(emp_id=1, record_date=date(2027, 1, 3), actual_hours=7),
        AnnualLeave(emp_id=1, year=2026, total_days=5),
        AnnualLeave(emp_id=1, year=2027, total_days=6),
        UserEmployeeAssignment(user_id=1, emp_id=1),
        UserDepartmentAssignment(user_id=1, dept_id=1),
    ])
    ensure_month_reference('2026-12')
    ensure_month_reference('2027-01')
    db.session.commit()
    return read_backup(export_multi_backup([1, 2]), normalized=True)


def test_cross_year_zip_restores_fresh_schema_and_explicit_rows(backup_app):
    document = cross_year_zip()
    assert document['months'] == ['2026-12', '2027-01']
    assert len(document['cross_month']['leave_records']) == 1
    db.session.remove()
    db.drop_all()
    db.create_all()
    # A new installation needs an authenticated administrator to perform restore.
    db.session.add(User(id=901, username='operator', role='admin', password_hash='synthetic'))
    db.session.commit()
    selection = {'months': document['months'], 'categories': [
        'account_settings', 'attendance', 'departments', 'employees', 'shifts',
        'accounts', 'meal_tickets', 'meal_ledgers', 'archives', 'cross_month', 'annual_stats',
    ]}
    initial = build_multi_preview(document, selection)
    assert all(not r['enabled'] for r in initial['rows'] if r['scope'].startswith(('cross_month/', 'year/')))
    selection['cross_month_keys'] = [r['row_key'] for r in initial['rows'] if r['scope'].startswith('cross_month/')]
    selection['annual_keys'] = [r['row_key'] for r in initial['rows'] if r['scope'].startswith('year/')]
    assert len(selection['cross_month_keys']) == 1
    assert len(selection['annual_keys']) == 2
    preview = build_multi_preview(document, selection)
    assert preview['blockers'] == []
    result = restore_multi_backup(document, selection, {}, preview['fingerprint'], 901)
    admin = User.query.filter_by(username='admin').one()
    assert admin.id != 1 and admin.check_password('synthetic-backup-password')
    assert not db.session.get(User, 901).is_active
    assert result['reauthentication_required']
    assert UserEmployeeAssignment.query.one().user_id == admin.id
    assert UserEmployeeAssignment.query.one().emp_id == Employee.query.one().id
    assert UserDepartmentAssignment.query.one().dept_id == Department.query.one().id
    assert admin.profile_dept_id == Department.query.one().id
    assert [r.actual_hours for r in DailyRecord.query.order_by(DailyRecord.record_date)] == [8, 7]
    assert LeaveRecord.query.count() == 1
    assert [(r.year, r.total_days) for r in AnnualLeave.query.order_by(AnnualLeave.year)] == [(2026, 5), (2027, 6)]


def test_cross_year_partial_restore_does_not_select_cross_or_annual_rows(backup_app):
    document = cross_year_zip()
    for record in DailyRecord.query.all():
        record.actual_hours = 1
    for annual in AnnualLeave.query.all():
        annual.total_days = 9
    LeaveRecord.query.one().leave_type = '病假'
    db.session.commit()
    selection = {'months': ['2026-12'], 'categories': ['attendance', 'cross_month', 'annual_stats']}
    preview = build_multi_preview(document, selection)
    assert preview['blockers'] == []
    restore_multi_backup(document, selection, {}, preview['fingerprint'], 1)
    assert [r.actual_hours for r in DailyRecord.query.order_by(DailyRecord.record_date)] == [8, 1]
    assert LeaveRecord.query.one().leave_type == '病假'
    assert [r.total_days for r in AnnualLeave.query.order_by(AnnualLeave.year)] == [9, 9]
