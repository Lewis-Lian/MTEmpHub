"""Final-choice preview contracts; all data is synthetic SQLite."""
from copy import deepcopy
from datetime import date, datetime
import json

import pytest
from sqlalchemy import event
from models import db
from models.account_set import AccountSet
from models.department import Department
from models.employee import Employee
from models.daily_record import DailyRecord
from models.user import User, UserEmployeeAssignment
from services.account_set_backup_service import collect_multi_backup, collect_backup
from services.backup_document import normalize_backup
from services.account_set_backup_schema import BackupError
from tests.test_account_set_backup import backup_app


def preview(doc, categories=None, choices=None, **selection):
    from services.account_set_restore_service import build_multi_preview
    return build_multi_preview(doc, dict(months=doc['months'], categories=categories or ['account_settings', 'attendance', 'departments', 'employees', 'shifts', 'accounts', 'meal_tickets', 'meal_ledgers', 'archives', 'cross_month', 'annual_stats'], **selection), choices)


def row(result, dataset, status=None):
    return next(r for r in result['rows'] if r['dataset'] == dataset and (status is None or r['status'] == status))


def test_defaults_and_unselected_month_category(backup_app):
    doc = collect_multi_backup([1])
    DailyRecord.query.first().actual_hours = 6
    db.session.add(DailyRecord(emp_id=1, record_date=date(2026, 6, 4)))
    db.session.commit()
    result = preview(doc, ['attendance'])
    assert row(result, 'daily_records', 'changed')['default_choice'] == 'backup'
    assert row(result, 'daily_records', 'system_only')['default_choice'] == 'backup'
    assert row(result, 'users')['enabled'] is False
    assert row(result, 'account_set')['default_choice'] == 'system'
    db.session.query(DailyRecord).delete()
    db.session.commit()
    assert row(preview(doc), 'daily_records')['default_choice'] == 'backup'
    result = preview(doc)
    assert set(result) == {'months', 'coverage', 'rows', 'summary', 'blockers', 'fingerprint'}


@pytest.mark.parametrize('version', ['v2_empty', 'v1_subset', 'absent'])
def test_empty_complete_vs_subset_and_absent(backup_app, version):
    if version == 'v2_empty':
        doc = collect_multi_backup([1])
        doc['shared']['departments'] = []
    else:
        doc = collect_backup(1)
        if version == 'absent':
            del doc['datasets']['departments']
            doc['datasets']['employees'][0]['dept_no'] = None
        doc = normalize_backup(doc)
    db.session.add(Department(dept_no='D2', dept_name='无关'))
    db.session.commit()
    result = preview(doc)
    target = next(r for r in result['rows'] if r['dataset'] == 'departments' and r['system']['dept_no'] == 'D2')
    assert target['default_choice'] == ('backup' if version == 'v2_empty' else 'system')
    if version != 'v2_empty':
        with pytest.raises(BackupError):
            preview(doc, choices={target['row_key']: 'backup'})


def test_final_removed_parent_retained_child_and_grant(backup_app):
    db.session.add(UserEmployeeAssignment(user_id=1, emp_id=1))
    db.session.commit()
    doc = collect_multi_backup([1])
    doc['shared']['departments'] = []
    result = preview(doc)
    blocker = next(b for b in result['blockers'] if b['code'] == 'missing_department')
    assert blocker['row_key'] and blocker['required_rows']
    parent = row(result, 'departments')
    assert not preview(doc, choices={parent['row_key']: 'system'})['blockers']
    doc = collect_multi_backup([1])
    doc['shared']['employees'] = []
    assert any(b['code'] == 'missing_employee' and 'user_employee_assignments' in b['row_key'] for b in preview(doc)['blockers'])


def test_card_swap_uses_final_choices(backup_app):
    Employee.query.first().card_no = 'A'
    db.session.add(Employee(emp_no='E2', name='乙', card_no='B'))
    db.session.commit()
    doc = collect_multi_backup([1])
    doc['shared']['employees'][0]['card_no'] = 'B'
    doc['shared']['employees'][1]['card_no'] = 'A'
    result = preview(doc)
    assert not any(b['code'] == 'card_conflict' for b in result['blockers'])
    second = next(r for r in result['rows'] if r['dataset'] == 'employees' and r['backup']['emp_no'] == 'E2')
    assert any(b['code'] == 'card_conflict' for b in preview(doc, choices={second['row_key']: 'system'})['blockers'])


def test_locks_require_actual_changes_and_explicit_cross_selection(backup_app):
    doc = collect_multi_backup([1])
    AccountSet.query.first().is_locked = True
    db.session.add(AccountSet(month='2026-05', name='五月', is_locked=True))
    db.session.commit()
    assert not any(b['code'] == 'locked' for b in preview(doc)['blockers'])
    doc['cross_month']['leave_records'][0]['reason'] = '修改'
    unselected = preview(doc)
    cross = row(unselected, 'leave_records')
    assert cross['affected_months'] == ['2026-05', '2026-06']
    assert not cross['enabled']
    result = preview(doc, cross_month_keys=[cross['row_key']])
    assert {b['month'] for b in result['blockers'] if b['code'] == 'locked'} == {'2026-05', '2026-06'}


def test_password_redaction_versions_and_zero_writes(backup_app):
    doc = collect_multi_backup([1])
    doc['shared']['users'][0]['password_hash'] = 'secret-test-hash'
    writes = []
    def capture(conn, cursor, statement, params, context, many):
        if statement.split()[0].upper() in ('INSERT', 'UPDATE', 'DELETE'):
            writes.append(statement)
    event.listen(db.engine, 'before_cursor_execute', capture)
    try:
        # A dirty object must not be autoflushed by preview.
        Employee.query.first().name = '待提交'
        first = preview(doc)
        assert not writes
        assert 'secret-test-hash' not in json.dumps(first)
        assert 'password_hash' not in json.dumps(first)
        assert row(first, 'users')['password_changed']
        db.session.rollback()
    finally:
        event.remove(db.engine, 'before_cursor_execute', capture)
    first = preview(doc)
    User.query.first().auth_version += 1
    db.session.commit()
    assert preview(doc)['fingerprint'] != first['fingerprint']


def test_normalized_v1_is_safe_and_idempotent(backup_app):
    doc = normalize_backup(collect_backup(1))
    result = preview(doc)
    assert not row(result, 'departments')['status'] == 'changed'
    assert row(result, 'users')['enabled'] is False
    assert not any(r['dataset'] == 'departments' and r['default_choice'] == 'backup' for r in result['rows'])


def meal_history():
    from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketPayment
    batch = MealTicketBatch(key='b1', account_set_id=1, month='2026-06', recharge_month='2026-07',
                            source_digest='source', created_by='admin', status='confirmed')
    db.session.add(batch)
    db.session.flush()
    item = MealTicketItem(key='i1', batch_key='b1', month='2026-06', emp_id=1, emp_no_snapshot='E1',
                          name='甲', dept_name='生产', is_manager=False, days=2, base_cents=1600, source={})
    db.session.add(item)
    db.session.flush()
    db.session.add(MealTicketPayment(key='p1', item_key='i1', month='2026-06', kind='recharge',
                                   amount_cents=1600, payment_date=date(2026, 7, 1), reference='凭证',
                                   operator='admin', request_key='req1', request_digest='digest'))
    from services.monthly_reference_service import ensure_month_reference
    ensure_month_reference('2026-06')
    db.session.commit()


def test_meal_complete_replacement_and_mixed_snapshot_block(backup_app):
    meal_history()
    doc = collect_multi_backup([1])
    doc['monthly']['2026-06']['datasets']['meal_items'][0]['days'] = 3
    doc['monthly']['2026-06']['datasets']['meal_items'][0]['base_cents'] = 2400
    doc['monthly']['2026-06']['datasets']['meal_payments'][0]['amount_cents'] = 2400
    result = preview(doc)
    assert not result['blockers']
    item = row(result, 'meal_items')
    mixed = preview(doc, choices={item['row_key']: 'system'})
    assert any(b['code'] == 'meal_snapshot_mismatch' and b['required_rows'] for b in mixed['blockers'])
    payment = row(result, 'meal_payments')
    mixed = preview(doc, choices={payment['row_key']: 'system'})
    assert any(b['code'] == 'meal_snapshot_mismatch' for b in mixed['blockers'])


@pytest.mark.parametrize('parent', ['meal_batches', 'meal_items', 'meal_payments'])
def test_retained_meal_child_after_parent_removal(backup_app, parent):
    from models.meal_ticket import MealTicketPayment
    meal_history()
    db.session.add(MealTicketPayment(key='p2', item_key='i1', month='2026-06', kind='reversal',
                                   amount_cents=-1600, payment_date=date(2026, 7, 2), reference='冲正',
                                   operator='admin', request_key='req2', request_digest='digest2', reversal_of='p1'))
    db.session.commit()
    doc = collect_multi_backup([1])
    if parent == 'meal_payments':
        doc['monthly']['2026-06']['datasets'][parent] = [doc['monthly']['2026-06']['datasets'][parent][1]]
    else:
        doc['monthly']['2026-06']['datasets'][parent] = []
    result = preview(doc)
    assert any(b['code'] == 'missing_meal_reference' and b['required_rows'] for b in result['blockers'])


def test_snapshot_change_requires_existing_unselected_consumers(backup_app):
    meal_history()
    doc = collect_multi_backup([1])
    snap = next(v for v in doc['monthly']['2026-06']['snapshots'] if v['kind'] == 'employee')
    snap['payload']['name'] = '修正'
    snap['quality'] = 'partial'
    result = preview(doc, ['meal_tickets'])
    assert any(b['code'] == 'snapshot_unselected_category' and 'attendance' in b['required_categories'] for b in result['blockers'])
    snapshot = next(r for r in result['rows'] if r['dataset'] == 'snapshots' and r['status'] == 'changed')
    assert snapshot['backup']['quality'] == 'partial' and snapshot['backup']['provenance'] == snap['provenance']
    assert not preview(doc, ['meal_tickets'], {snapshot['row_key']: 'system'})['blockers']
    assert not preview(doc, ['attendance', 'meal_tickets'])['blockers']


def test_missing_snapshot_parent_and_skipped_new_employee(backup_app):
    from services.monthly_reference_service import ensure_month_reference
    ensure_month_reference('2026-06')
    db.session.commit()
    doc = collect_multi_backup([1])
    doc['monthly']['2026-06']['snapshots'] = [s for s in doc['monthly']['2026-06']['snapshots'] if s['kind'] != 'department']
    assert any(b['code'] == 'missing_snapshot' for b in preview(doc)['blockers'])
    doc = collect_multi_backup([1])
    new = deepcopy(doc['shared']['employees'][0])
    new['emp_no'] = 'E2'
    doc['shared']['employees'].append(new)
    doc['monthly']['2026-06']['datasets']['daily_records'][0]['emp_no'] = 'E2'
    result = preview(doc)
    employee = row(result, 'employees', 'new')
    assert any(b['code'] == 'missing_employee' for b in preview(doc, choices={employee['row_key']: 'skip'})['blockers'])
    # Monthly records cannot be restored into an invisible, absent account.
    doc = collect_multi_backup([1])
    db.session.query(AccountSet).delete()
    db.session.commit()
    doc['monthly']['2026-06']['datasets']['daily_records'][0]['actual_hours'] = 9
    assert any(b['code'] == 'missing_account' for b in preview(doc, ['attendance'])['blockers'])


def test_annual_explicit_keys_actual_year_and_locks(backup_app):
    from models.annual_leave import AnnualLeave
    db.session.add_all([AccountSet(month='2026-07', name='七月', is_locked=True),
                        AccountSet(month='2027-01', name='次年', is_locked=True),
                        AnnualLeave(emp_id=1, year=2026, total_days=5)])
    db.session.commit()
    doc = collect_multi_backup([1])
    doc['annual']['2026']['annual_leave'][0]['total_days'] = 8
    result = preview(doc)
    annual = row(result, 'annual_leave')
    assert annual['affected_months'] == ['2026-06', '2026-07']
    assert not annual['enabled']
    result = preview(doc, annual_keys=[annual['row_key']])
    assert {b['month'] for b in result['blockers'] if b['code'] == 'locked'} == {'2026-07'}


def test_changed_payment_impacts_recharge_month_lock(backup_app):
    meal_history()
    db.session.add(AccountSet(month='2026-07', name='充值月', is_locked=True))
    db.session.commit()
    doc = collect_multi_backup([1])
    doc['monthly']['2026-06']['datasets']['meal_payments'][0]['reference'] = '修正凭证'
    result = preview(doc)
    assert row(result, 'meal_payments')['affected_months'] == ['2026-06', '2026-07']
    assert any(b['code'] == 'locked' and b['month'] == '2026-07' for b in result['blockers'])


def test_fingerprint_file_and_permission_changes(backup_app, tmp_path):
    from models.account_set import AccountSetImport
    path = tmp_path / 'source.xlsx'
    path.write_bytes(b'first')
    db.session.add(AccountSetImport(account_set_id=1, source_filename=path.name, stored_path=str(path), status='ok'))
    db.session.commit()
    doc = collect_multi_backup([1])
    first = preview(doc)
    path.write_bytes(b'other')
    second = preview(doc)
    assert first['fingerprint'] != second['fingerprint']
    db.session.add(UserEmployeeAssignment(user_id=1, emp_id=1))
    db.session.commit()
    assert preview(doc)['fingerprint'] != second['fingerprint']


def test_unknown_unselected_and_incomplete_choices_rejected(backup_app):
    doc = collect_multi_backup([1])
    with pytest.raises(BackupError):
        preview(doc, choices={'invented': 'backup'})
    result = preview(doc, ['attendance'])
    with pytest.raises(BackupError):
        preview(doc, ['attendance'], {row(result, 'users')['row_key']: 'backup'})
    with pytest.raises(BackupError):
        preview(doc, cross_month_keys=['invented'])


def test_only_selected_month_rows_enabled(backup_app):
    from services.account_set_restore_service import build_multi_preview
    db.session.add(AccountSet(month='2026-07', name='七月'))
    db.session.add(DailyRecord(emp_id=1, record_date=date(2026, 7, 3)))
    db.session.commit()
    doc = collect_multi_backup([1, 2])
    result = build_multi_preview(doc, {'months': ['2026-06'], 'categories': ['attendance']})
    assert result['months'] == ['2026-06']
    assert all(not r['enabled'] for r in result['rows'] if r['month'] == '2026-07')


def test_snapshot_selected_but_absent_consumer_category_still_blocks(backup_app):
    meal_history()
    doc = collect_multi_backup([1], ['attendance', 'archives'])
    next(v for v in doc['monthly']['2026-06']['snapshots'] if v['kind'] == 'employee')['payload']['name'] = '修改'
    # Selecting a category absent from this package cannot authorize its
    # implicit history change through a snapshot.
    result = preview(doc, ['attendance', 'meal_tickets'])
    assert any(b['code'] == 'snapshot_unselected_category' for b in result['blockers'])


def test_snapshot_parent_cycle_and_identity_mismatch(backup_app):
    from services.monthly_reference_service import ensure_month_reference
    ensure_month_reference('2026-06')
    db.session.commit()
    doc = collect_multi_backup([1])
    dept = next(v for v in doc['monthly']['2026-06']['snapshots'] if v['kind'] == 'department')
    dept['payload']['parent_no'] = 'D1'
    assert any(b['code'] == 'snapshot_cycle' for b in preview(doc)['blockers'])
    dept['payload']['parent_no'] = None
    dept['payload']['dept_no'] = 'OTHER'
    assert any(b['code'] == 'snapshot_identity_mismatch' for b in preview(doc)['blockers'])


def test_file_dependency_missing_source_bytes_blocks(backup_app, tmp_path):
    from models.account_set import AccountSetImport
    path = tmp_path / 'source.xlsx'
    path.write_bytes(b'backup-file')
    db.session.add(AccountSetImport(account_set_id=1, source_filename=path.name, stored_path=str(path), status='ok'))
    db.session.commit()
    doc = collect_multi_backup([1])
    doc['monthly']['2026-06']['datasets']['imports'][0]['status'] = 'restored'
    doc['_files'] = {}
    assert any(b['code'] == 'missing_file' for b in preview(doc)['blockers'])


def test_recharge_month_of_adjustment_and_item_changes(backup_app):
    meal_history()
    doc = collect_multi_backup([1])
    doc['monthly']['2026-06']['datasets']['meal_items'][0]['name'] = '修正'
    assert row(preview(doc), 'meal_items')['affected_months'] == ['2026-06', '2026-07']


def test_department_and_shift_final_dependencies(backup_app):
    from models.shift import Shift
    from models.employee_shift import EmployeeShiftAssignment
    db.session.add(Shift(shift_no='S1', shift_name='白班', time_slots=[]))
    db.session.flush()
    db.session.add(EmployeeShiftAssignment(emp_id=1, shift_id=1))
    db.session.commit()
    doc = collect_multi_backup([1])
    doc['shared']['shifts'] = []
    assert any(b['code'] == 'missing_shift' and 'employee_shift_assignments' in b['row_key'] for b in preview(doc)['blockers'])
    doc = collect_multi_backup([1])
    doc['shared']['departments'][0]['parent_no'] = 'D1'
    assert any(b['code'] == 'department_cycle' for b in preview(doc)['blockers'])


def test_shared_change_requires_frozen_historical_identity(backup_app):
    doc = collect_multi_backup([1])
    doc['shared']['employees'][0]['name'] = '当前新姓名'
    result = preview(doc)
    assert any(b['code'] == 'unisolated_history' and b['month'] == '2026-06' for b in result['blockers'])
    from services.monthly_reference_service import ensure_month_reference
    ensure_month_reference('2026-06')
    db.session.commit()
    doc = collect_multi_backup([1])
    doc['shared']['employees'][0]['name'] = '当前新姓名'
    assert not preview(doc)['blockers']


def test_legacy_missing_quality_explicit_in_month_rows(backup_app):
    result = preview(normalize_backup(collect_backup(1)))
    assert row(result, 'daily_records')['reference_quality']['backup'] == 'missing'


def test_cross_month_ledger_archive_is_same_existing_reference(backup_app, tmp_path):
    from models.meal_ledger import MealLedgerImport, MealLedgerRecord
    path = tmp_path / 'ledger.xlsx'
    path.write_bytes(b'archive')
    db.session.add(MealLedgerImport(key='li1', kind='external', month='2026-05', source_filename=path.name,
                                   file_digest='file', stored_path=str(path), data={}, operator='admin'))
    db.session.add(MealLedgerRecord(key='lr1', kind='external', month='2026-06', record_date=date(2026, 6, 1),
                                   amount_cents=100, data={'import_key': 'li1'}, request_key='req',
                                   request_digest='digest', operator='admin'))
    db.session.commit()
    doc = collect_multi_backup([1])
    result = preview(doc)
    assert row(result, 'meal_ledger_imports')['status'] == 'same'
    assert not result['blockers']
    db.session.add(MealLedgerRecord(key='lr2', kind='external', month='2026-07', record_date=date(2026, 7, 1),
                                   amount_cents=100, data={'import_key': 'li1'}, request_key='req2',
                                   request_digest='digest2', operator='admin'))
    db.session.commit()
    doc['monthly']['2026-06']['datasets']['meal_ledger_imports'][0]['status'] = 'restored'
    result = preview(doc)
    assert row(result, 'meal_ledger_imports')['affected_months'] == ['2026-06', '2026-07']
    assert any(b['code'] == 'unselected_archive_consumer' and b['month'] == '2026-07' for b in result['blockers'])


def test_interval_midnight_microseconds_excludes_next_month(backup_app):
    doc = collect_multi_backup([1])
    doc['cross_month']['leave_records'][0]['end_time'] = '2026-06-01T00:00:00.000000'
    from models.leave import LeaveRecord
    LeaveRecord.query.first().end_time = datetime(2026, 6, 1)
    db.session.commit()
    result = preview(doc)
    assert row(result, 'leave_records')['affected_months'] == ['2026-05']


def test_mixed_target_only_funds_not_added_to_replaced_history(backup_app):
    from models.meal_ticket import MealTicketPayment
    meal_history()
    doc = collect_multi_backup([1])
    db.session.add(MealTicketPayment(key='p-extra', item_key='i1', month='2026-06', kind='recharge',
                                   amount_cents=800, payment_date=date(2026, 7, 2), reference='后来充值',
                                   operator='admin', request_key='req-extra', request_digest='extra'))
    db.session.commit()
    doc['monthly']['2026-06']['datasets']['meal_payments'][0]['amount_cents'] = 800
    result = preview(doc)
    extra = next(r for r in result['rows'] if r['dataset'] == 'meal_payments' and r['status'] == 'system_only')
    assert not result['blockers']
    assert any(b['code'] == 'meal_history_mismatch' for b in preview(doc, choices={extra['row_key']: 'system'})['blockers'])


def test_archived_accounts_and_granted_historical_employees_are_portable(backup_app):
    Employee.query.first().is_active = False
    User.query.first().is_active = False
    db.session.add(UserEmployeeAssignment(user_id=1, emp_id=1))
    db.session.commit()
    doc = collect_multi_backup([1])
    assert not preview(doc)['blockers']


def test_cross_incomplete_explicit_key_cannot_delete_and_annual_empty_can(backup_app):
    from models.annual_leave import AnnualLeave
    db.session.add(AnnualLeave(emp_id=1, year=2026, total_days=5))
    db.session.commit()
    doc = collect_multi_backup([1])
    doc['cross_month']['leave_records'] = []
    doc['annual']['2026']['annual_leave'] = []
    result = preview(doc)
    cross, annual = row(result, 'leave_records'), row(result, 'annual_leave')
    selected = dict(cross_month_keys=[cross['row_key']], annual_keys=[annual['row_key']])
    result = preview(doc, **selected)
    assert row(result, 'leave_records')['default_choice'] == 'system'
    assert row(result, 'annual_leave')['default_choice'] == 'backup'
    with pytest.raises(BackupError, match='不完整'):
        preview(doc, choices={cross['row_key']: 'backup'}, **selected)


@pytest.mark.parametrize('status', ['new', 'changed', 'system_only'])
def test_public_password_rows_always_redacted(backup_app, status):
    doc = collect_multi_backup([1])
    private_hash = User.query.first().password_hash
    if status == 'new':
        doc['shared']['users'][0]['username'] = 'new-user'
    elif status == 'changed':
        doc['shared']['users'][0]['password_hash'] = 'private-new-hash'
    else:
        doc['shared']['users'] = []
    payload = json.dumps(preview(doc))
    assert private_hash not in payload and 'private-new-hash' not in payload and 'password_hash' not in payload


def test_snapshot_partial_category_does_not_authorize_absent_dataset(backup_app):
    meal_history()
    doc = collect_multi_backup([1])
    del doc['monthly']['2026-06']['datasets']['meal_batches']
    doc['coverage']['month/2026-06/meal_batches'] = {'included': False, 'complete': False}
    next(s for s in doc['monthly']['2026-06']['snapshots'] if s['kind'] == 'employee')['payload']['name'] = '改变'
    assert any(b['code'] == 'snapshot_unselected_category' for b in preview(doc)['blockers'])


def test_new_current_employee_cannot_change_uncaptured_month_membership(backup_app):
    doc = collect_multi_backup([1])
    employee = deepcopy(doc['shared']['employees'][0])
    employee['emp_no'], employee['name'] = 'E2', '后来入职'
    doc['shared']['employees'].append(employee)
    assert any(b['code'] == 'unisolated_history' and b['month'] == '2026-06' for b in preview(doc)['blockers'])


def test_shared_restore_protects_annual_only_history(backup_app):
    from models.annual_leave import AnnualLeave
    db.session.query(DailyRecord).delete()
    db.session.add(AnnualLeave(emp_id=1, year=2026, total_days=5))
    db.session.commit()
    doc = collect_multi_backup([1])
    doc['shared']['employees'][0]['name'] = '更新当前资料'
    assert any(b['code'] == 'unisolated_history' for b in preview(doc)['blockers'])
