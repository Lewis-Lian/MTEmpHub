"""Atomic restore integration tests using synthetic SQLite and temporary files."""
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import event
from models import db
from models.account_set import AccountSet, AccountSetImport
from models.account_set_backup_restore import AccountSetBackupRestore
from models.daily_record import DailyRecord
from services.monthly_reference_service import ensure_month_reference
from services.account_set_backup_service import collect_multi_backup
from services.account_set_restore_service import build_multi_preview
from services.account_set_backup_schema import BackupError, BackupTargetChanged
from tests.test_account_set_backup import backup_app


def restore(document, selection, choices=None, fingerprint=None):
    from services.account_set_restore_service import restore_multi_backup
    preview = build_multi_preview(document, selection, choices)
    return restore_multi_backup(document, selection, choices or {}, fingerprint or preview['fingerprint'], 1)


def two_months():
    db.session.add(AccountSet(month='2026-07', name='七月'))
    db.session.add(DailyRecord(emp_id=1, record_date=date(2026, 7, 3), actual_hours=7))
    ensure_month_reference('2026-06')
    ensure_month_reference('2026-07')
    db.session.commit()
    document = collect_multi_backup([1, 2])
    for record in DailyRecord.query.all():
        record.actual_hours = 1
    db.session.commit()
    return document


def test_only_selected_month_is_restored(backup_app):
    document = two_months()
    result = restore(document, {'months': ['2026-06'], 'categories': ['attendance']})
    assert [r.actual_hours for r in DailyRecord.query.order_by(DailyRecord.record_date)] == [8, 1]
    assert result['months'] == ['2026-06']
    assert result['counts']['updated'] == 1
    assert AccountSetBackupRestore.query.one().task_id == result['task_id']


def test_second_month_database_failure_rolls_back_first_month(backup_app):
    document = two_months()
    written = []
    def fail_second(mapper, connection, target):
        written.append(target.record_date.month)
        if target.record_date.month == 7:
            raise RuntimeError('second month write failed')
    event.listen(DailyRecord, 'before_update', fail_second)
    try:
        with pytest.raises(RuntimeError, match='second month'):
            restore(document, {'months': document['months'], 'categories': ['attendance']})
    finally:
        event.remove(DailyRecord, 'before_update', fail_second)
    assert written == [6, 7]
    assert [r.actual_hours for r in DailyRecord.query.order_by(DailyRecord.record_date)] == [1, 1]
    assert not any(r.counts.get('status') == 'success' for r in AccountSetBackupRestore.query.all())


def test_file_write_failure_preserves_database_and_originals(backup_app, tmp_path, monkeypatch):
    source = tmp_path / 'original.xlsx'
    source.write_bytes(b'backup')
    db.session.add(AccountSetImport(account_set_id=1, source_filename=source.name, stored_path=str(source), status='ok'))
    db.session.commit()
    document = two_months()
    source.write_bytes(b'target')
    write = Path.write_bytes
    def fail_staging(path, data):
        if 'staging' in path.parts:
            raise OSError('disk full')
        return write(path, data)
    monkeypatch.setattr(Path, 'write_bytes', fail_staging)
    with pytest.raises(OSError, match='disk full'):
        restore(document, {'months': document['months'], 'categories': ['attendance', 'archives']})
    assert source.read_bytes() == b'target'
    assert AccountSetImport.query.one().stored_path == str(source)
    assert [r.actual_hours for r in DailyRecord.query.order_by(DailyRecord.record_date)] == [1, 1]
    assert not list((tmp_path / 'private' / 'staging').glob('*'))


def test_accounts_map_local_ids_revoke_tokens_and_archive_operator(backup_app):
    from models.user import User, UserEmployeeAssignment, UserDepartmentAssignment
    from models.department import Department
    from models.employee import Employee
    document = two_months()
    admin = document['shared']['users'][0]
    admin['is_active'] = False
    new_admin = dict(admin, username='replacement', is_active=True, profile_dept_no='D1', profile_emp_no='E1')
    document['shared']['users'].append(new_admin)
    document['shared']['user_employee_assignments'].append({'username': 'replacement', 'emp_no': 'E1'})
    document['shared']['user_department_assignments'].append({'username': 'replacement', 'dept_no': 'D1'})
    User.query.first().auth_version = 19
    db.session.commit()
    result = restore(document, {'months': ['2026-06'], 'categories': ['accounts']})
    replacement = User.query.filter_by(username='replacement').one()
    assert replacement.id != 1
    assert replacement.profile_dept_id == Department.query.one().id
    assert UserEmployeeAssignment.query.one().emp_id == Employee.query.one().id
    assert UserDepartmentAssignment.query.one().user_id == replacement.id
    assert db.session.get(User, 1).auth_version == 20
    assert not db.session.get(User, 1).is_active
    assert result['reauthentication_required'] is True
    audit = AccountSetBackupRestore.query.one()
    assert audit.operator_username == 'admin' and audit.operator_id == 1
    assert 'password_hash' not in str(audit.counts)


def test_permission_only_change_revokes_user_tokens(backup_app):
    document = two_months()
    document['shared']['user_employee_assignments'].append({'username': 'admin', 'emp_no': 'E1'})
    result = restore(document, {'months': ['2026-06'], 'categories': ['accounts']})
    from models.user import User
    assert User.query.one().auth_version == 1
    assert result['reauthentication_required'] is True


def test_last_admin_cannot_be_disabled(backup_app):
    document = two_months()
    document['shared']['users'][0]['is_active'] = False
    with pytest.raises(BackupError, match='管理员'):
        restore(document, {'months': ['2026-06'], 'categories': ['accounts']})
    from models.user import User
    assert User.query.one().is_active and User.query.one().auth_version == 0
    assert AccountSetBackupRestore.query.one().counts['status'] == 'failed'


def test_cards_parent_reorder_and_current_exit_keep_historical_ids(backup_app):
    from models.employee import Employee
    from models.department import Department
    first = Employee.query.one()
    first.card_no = 'A'
    second = Employee(emp_no='E2', name='乙', card_no='B')
    parent = Department(dept_no='D2', dept_name='二', parent_id=1)
    extra = Employee(emp_no='E3', name='退出')
    db.session.add_all([second, parent, extra])
    db.session.commit()
    document = two_months()
    document['shared']['employees'] = [r for r in document['shared']['employees'] if r['emp_no'] != 'E3']
    for r in document['shared']['employees']:
        r['card_no'] = 'B' if r['emp_no'] == 'E1' else 'A'
    for r in document['shared']['departments']:
        r['parent_no'] = 'D2' if r['dept_no'] == 'D1' else None
    restore(document, {'months': ['2026-06'], 'categories': ['employees', 'departments']})
    assert db.session.get(Employee, first.id).card_no == 'B'
    assert db.session.get(Employee, second.id).card_no == 'A'
    assert db.session.get(Employee, extra.id).is_active is False
    assert Department.query.filter_by(dept_no='D1').one().parent_id == parent.id
    from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
    july = MonthlyReferenceSnapshot.query.filter_by(month='2026-07', kind='employee', business_key='E3').one()
    assert july.payload['name'] == '退出'


def test_file_cleanup_keeps_unselected_month_reference(backup_app, tmp_path):
    source = tmp_path / 'shared.xlsx'
    source.write_bytes(b'backup')
    document = two_months()
    db.session.add_all([AccountSetImport(account_set_id=i, source_filename=source.name, stored_path=str(source), status='ok') for i in (1, 2)])
    db.session.commit()
    document = collect_multi_backup([1, 2])
    source.write_bytes(b'target')
    restore(document, {'months': ['2026-06'], 'categories': ['attendance', 'archives']})
    june = AccountSetImport.query.filter_by(account_set_id=1).one()
    assert Path(june.stored_path).read_bytes() == b'backup'
    assert source.read_bytes() == b'target'
    assert AccountSetImport.query.filter_by(account_set_id=2).one().stored_path == str(source)


def test_target_change_bypassing_cached_orm_rejects_confirmation(backup_app):
    from sqlalchemy import text
    document = two_months()
    selection = {'months': ['2026-06'], 'categories': ['attendance']}
    fingerprint = build_multi_preview(document, selection)['fingerprint']
    cached = DailyRecord.query.first()
    db.session.execute(text('UPDATE daily_records SET actual_hours=4 WHERE id=:id'), {'id': cached.id})
    db.session.commit()
    with pytest.raises(BackupTargetChanged):
        restore(document, selection, fingerprint=fingerprint)
    assert DailyRecord.query.first().actual_hours == 4


def test_avatar_cleanup_protects_other_user_reference(backup_app, tmp_path):
    from models.user import User
    avatars = tmp_path / 'avatars'
    avatars.mkdir()
    path = avatars / 'shared.png'
    path.write_bytes(b'avatar')
    User.query.one().avatar = '/api/auth/avatar/shared.png'
    db.session.add(User(username='other', password_hash='unused', avatar='/api/auth/avatar/shared.png'))
    db.session.commit()
    document = two_months()
    admin = next(u for u in document['shared']['users'] if u['username'] == 'admin')
    admin.update(avatar_file_key=None, avatar_sha256=None, avatar_size=None, avatar_preset='default:one')
    restore(document, {'months': ['2026-06'], 'categories': ['accounts']})
    assert path.read_bytes() == b'avatar'


def test_meal_replacement_with_changed_batch_key_and_payment_retry(backup_app):
    from tests.test_multi_month_restore_preview import meal_history
    from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketPayment
    from services.meal_ticket_service import payment, payment_payload, digest
    meal_history()
    batch, item = MealTicketBatch.query.one(), MealTicketItem.query.one()
    body = dict(batch_id=batch.id, item_id=item.id, kind='recharge', amount=16, date='2026-07-01', reference='凭证', request_key='req1')
    MealTicketPayment.query.one().request_digest = digest(payment_payload(body))
    db.session.commit()
    document = collect_multi_backup([1])
    datasets = document['monthly']['2026-06']['datasets']
    datasets['meal_batches'][0]['key'] = 'replacement-batch'
    datasets['meal_items'][0]['batch_key'] = 'replacement-batch'
    # Real foreign keys expose parent-first key replacement failures.
    db.session.execute(db.text('PRAGMA foreign_keys=ON'))
    db.session.commit()
    restore(document, {'months': ['2026-06'], 'categories': ['meal_tickets']})
    assert MealTicketBatch.query.one().key == 'replacement-batch'
    assert MealTicketItem.query.one().batch_key == 'replacement-batch'
    assert payment(body, 'admin').key == 'replacement-batch'
    assert MealTicketPayment.query.count() == 1
    assert MealTicketPayment.query.one().request_key == 'req1'
    db.session.rollback()
    db.session.execute(db.text('PRAGMA foreign_keys=OFF'))
    db.session.commit()


def test_meal_request_keys_can_swap_without_transient_unique_conflict(backup_app):
    from tests.test_multi_month_restore_preview import meal_history
    from models.meal_ticket import MealTicketPayment
    meal_history()
    first = MealTicketPayment.query.one()
    db.session.add(MealTicketPayment(key='p2', item_key='i1', month='2026-06', kind='recharge', amount_cents=0,
                                   payment_date=date(2026, 7, 2), reference='二', operator='admin', request_key='req2', request_digest='d2'))
    db.session.commit()
    document = collect_multi_backup([1])
    for p in document['monthly']['2026-06']['datasets']['meal_payments']:
        p['request_key'] = 'req2' if p['key'] == 'p1' else 'req1'
    restore(document, {'months': ['2026-06'], 'categories': ['meal_tickets']})
    assert db.session.get(MealTicketPayment, first.id).request_key == 'req2'


def test_login_temporarily_locked_only_admin_is_rejected(backup_app):
    from datetime import datetime, timedelta
    from models.user import User
    document = two_months()
    document['shared']['users'][0]['profile_name'] = 'changed'
    User.query.one().login_locked_until = datetime.utcnow() + timedelta(hours=1)
    db.session.commit()
    with pytest.raises(BackupError, match='管理员'):
        restore(document, {'months': ['2026-06'], 'categories': ['accounts']})
    assert User.query.one().profile_name is None


def test_batch_replacement_deletes_old_children_before_parent_key_change(backup_app):
    from tests.test_multi_month_restore_preview import meal_history
    from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketPayment
    meal_history()
    document = collect_multi_backup([1])
    datasets = document['monthly']['2026-06']['datasets']
    datasets['meal_batches'][0]['key'] = 'new-batch'
    datasets['meal_items'][0].update(key='new-item', batch_key='new-batch')
    datasets['meal_payments'][0].update(key='new-payment', item_key='new-item')
    db.session.execute(db.text('PRAGMA foreign_keys=ON'))
    db.session.commit()
    try:
        restore(document, {'months': ['2026-06'], 'categories': ['meal_tickets']})
        assert MealTicketBatch.query.one().key == 'new-batch'
        assert MealTicketItem.query.one().key == 'new-item'
        assert MealTicketPayment.query.one().key == 'new-payment'
    finally:
        db.session.rollback()
        db.session.execute(db.text('PRAGMA foreign_keys=OFF'))
        db.session.commit()


def test_avatar_bytes_restore_and_database_failure_cleans_new_files(backup_app, tmp_path):
    from models.user import User
    avatars = tmp_path / 'avatars'
    avatars.mkdir()
    original = avatars / 'old.png'
    original.write_bytes(b'backup')
    User.query.one().avatar = '/api/auth/avatar/old.png'
    User.query.one().set_password('backup-password')
    db.session.commit()
    document = two_months()
    original.write_bytes(b'target')
    User.query.one().set_password('target-password')
    db.session.commit()
    def fail_audit(mapper, connection, target):
        if target.counts['status'] == 'success':
            raise RuntimeError('audit failed')
    event.listen(AccountSetBackupRestore, 'before_insert', fail_audit)
    try:
        with pytest.raises(RuntimeError, match='audit failed'):
            restore(document, {'months': ['2026-06'], 'categories': ['accounts']})
    finally:
        event.remove(AccountSetBackupRestore, 'before_insert', fail_audit)
    assert list(avatars.iterdir()) == [original]
    assert original.read_bytes() == b'target'
    assert User.query.one().check_password('target-password')
    result = restore(document, {'months': ['2026-06'], 'categories': ['accounts']})
    assert result['reauthentication_required']
    assert User.query.one().check_password('backup-password')
    path = avatars / Path(User.query.one().avatar).name
    assert path.read_bytes() == b'backup'
    assert not original.exists()


def test_new_month_and_portable_grants_use_target_business_ids(backup_app):
    from models.user import User, UserEmployeeAssignment, UserDepartmentAssignment
    from models.department import Department
    from models.employee import Employee
    document = two_months()
    document['shared']['user_employee_assignments'] = [{'username': 'admin', 'emp_no': 'E1'}]
    document['shared']['user_department_assignments'] = [{'username': 'admin', 'dept_no': 'D1'}]
    document['shared']['users'][0]['profile_dept_no'] = 'D1'
    # Rebuild target identities with different local IDs, preserving business keys.
    db.session.query(DailyRecord).delete()
    from models.leave import LeaveRecord
    db.session.query(LeaveRecord).delete()
    db.session.query(Employee).delete()
    db.session.query(Department).delete()
    db.session.query(AccountSet).delete()
    db.session.add(Department(id=101, dept_no='D1', dept_name='生产'))
    db.session.flush()
    db.session.add(Employee(id=201, emp_no='E1', name='甲', dept_id=101))
    db.session.commit()
    db.session.remove()
    restore(document, {'months': ['2026-06'], 'categories': ['account_settings', 'attendance', 'accounts']})
    assert DailyRecord.query.one().emp_id == 201
    assert UserEmployeeAssignment.query.one().emp_id == 201
    assert UserDepartmentAssignment.query.one().dept_id == 101
    assert User.query.one().profile_dept_id == 101
    assert AccountSet.query.one().month == '2026-06'


def test_cross_month_archive_binds_global_key_when_own_month_changes(backup_app, tmp_path):
    from models.meal_ledger import MealLedgerImport, MealLedgerRecord
    original = tmp_path / 'ledger.xlsx'
    original.write_bytes(b'ledger')
    two_months()
    archive = MealLedgerImport(key='archive', kind='withdrawal', month='2026-07', source_filename=original.name,
                              file_digest='digest', stored_path=str(original), data={}, status='ok', operator='admin')
    record = MealLedgerRecord(key='record', kind='withdrawal', month='2026-06', record_date=date(2026, 6, 2),
                             amount_cents=100, data={'import_key': 'archive'}, request_key='req', request_digest='digest', operator='admin')
    db.session.add_all([archive, record])
    db.session.commit()
    document = collect_multi_backup([1])
    source = document['monthly']['2026-06']['datasets']['meal_ledger_imports'][0]
    source['month'] = '2026-06'
    original_id = archive.id
    restore(document, {'months': ['2026-06'], 'categories': ['meal_ledgers', 'archives']})
    assert MealLedgerImport.query.one().id == original_id
    assert MealLedgerImport.query.one().month == '2026-06'


def test_legacy_and_absent_categories_do_not_delete_existing_current_data(backup_app):
    from services.account_set_backup_service import collect_backup
    from models.employee import Employee
    document = collect_backup(1)
    db.session.add(Employee(emp_no='outside', name='未覆盖'))
    db.session.commit()
    restore(document, {'months': ['2026-06'], 'categories': ['employees', 'accounts']})
    assert Employee.query.filter_by(emp_no='outside').one().is_active


def test_preview_reports_last_admin_blocker_before_file_staging(backup_app):
    document = two_months()
    document['shared']['users'][0]['is_active'] = False
    preview = build_multi_preview(document, {'months': ['2026-06'], 'categories': ['accounts']})
    assert any(b['code'] == 'last_admin' for b in preview['blockers'])


def test_ledger_update_retains_required_request_key_and_source_identity(backup_app):
    from models.meal_ledger import MealLedgerRecord
    two_months()
    db.session.add(MealLedgerRecord(key='ledger', kind='withdrawal', month='2026-06', record_date=date(2026, 6, 2),
                                   amount_cents=100, data={}, operator='admin', request_key='req', request_digest='digest', source_key='source'))
    db.session.commit()
    document = collect_multi_backup([1])
    document['monthly']['2026-06']['datasets']['meal_ledger_records'][0]['amount_cents'] = 200
    restore(document, {'months': ['2026-06'], 'categories': ['meal_ledgers']})
    restored = MealLedgerRecord.query.one()
    assert (restored.amount_cents, restored.request_key, restored.source_key) == (200, 'req', 'source')


def test_restored_history_origin_survives_content_identical_reexport(backup_app, tmp_path):
    from services.account_set_backup_service import serialize_row
    path = tmp_path / 'archive.xlsx'
    path.write_bytes(b'backup')
    db.session.add(AccountSetImport(account_set_id=1, source_filename=path.name, stored_path=str(path), status='ok'))
    db.session.commit()
    two_months()
    document = collect_multi_backup([1])
    source_key = document['monthly']['2026-06']['datasets']['imports'][0]['origin_key']
    db.session.query(AccountSetImport).delete()
    db.session.add(AccountSetImport(id=100, account_set_id=1, source_filename=path.name, stored_path=str(path), status='error'))
    db.session.commit()
    restore(document, {'months': ['2026-06'], 'categories': ['attendance', 'archives']})
    assert serialize_row('imports', AccountSetImport.query.one())['origin_key'] == source_key


def test_snapshot_restore_preserves_source_quality_and_unselected_month(backup_app):
    from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
    document = two_months()
    source = next(s for s in document['monthly']['2026-06']['snapshots'] if s['kind'] == 'employee')
    source['payload']['name'] = '历史修正'
    source['quality'] = 'partial'
    source['provenance'] = {'source': 'reviewed archive'}
    restore(document, {'months': ['2026-06'], 'categories': ['attendance']})
    june = MonthlyReferenceSnapshot.query.filter_by(month='2026-06', kind='employee').one()
    july = MonthlyReferenceSnapshot.query.filter_by(month='2026-07', kind='employee').one()
    assert (june.payload['name'], june.quality, june.provenance) == ('历史修正', 'partial', {'source': 'reviewed archive'})
    assert july.payload['name'] == '甲'


def test_cleanup_exception_after_commit_returns_success_warning(backup_app, monkeypatch):
    import services.multi_month_restore as service
    document = two_months()
    def failed_cleanup(root):
        raise RuntimeError('cleanup failed')
    monkeypatch.setattr(service, 'cleanup_old_files', failed_cleanup)
    result = restore(document, {'months': ['2026-06'], 'categories': ['attendance']})
    assert result['warnings']
    assert DailyRecord.query.first().actual_hours == 8
    assert AccountSetBackupRestore.query.one().counts['status'] == 'success'


@pytest.mark.parametrize('dataset', ['factory_rest', 'imports'])
def test_legacy_account_scoped_writes_bind_selected_month(backup_app, tmp_path, dataset):
    from services.account_set_backup_service import export_backup, read_backup
    from models.account_set import AccountSetFactoryRestDay
    if dataset == 'factory_rest':
        db.session.add(AccountSetFactoryRestDay(account_set_id=1, rest_date=date(2026, 6, 4), rest_period='full'))
    else:
        path = tmp_path / 'old.xlsx'
        path.write_bytes(b'legacy')
        db.session.add(AccountSetImport(account_set_id=1, source_filename=path.name, stored_path=str(path), status='ok'))
    db.session.commit()
    document = read_backup(export_backup(1), normalized=True)
    model = AccountSetFactoryRestDay if dataset == 'factory_rest' else AccountSetImport
    db.session.query(model).delete()
    db.session.commit()
    categories = ['account_settings'] if dataset == 'factory_rest' else ['attendance', 'archives']
    restore(document, {'months': ['2026-06'], 'categories': categories})
    assert model.query.one().account_set_id == 1
