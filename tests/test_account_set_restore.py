from datetime import date
import pytest
from models import db
from models.account_set import AccountSet
from models.daily_record import DailyRecord
from models.employee import Employee
from models.department import Department
from services.account_set_backup_service import read_backup, export_backup, BackupError
from services.account_set_restore_service import build_preview, restore_backup, BackupTargetChanged
from tests.test_account_set_backup import backup_app


def test_differences_and_choices(backup_app):
    doc = read_backup(export_backup(1))
    daily = DailyRecord.query.first()
    daily.actual_hours = 6
    db.session.commit()
    preview = build_preview(doc, {})
    row = next(row for row in preview['rows'] if row['dataset'] == 'daily_records')
    assert row['status'] == 'changed'
    assert next(f for f in row['fields'] if f['name'] == 'actual_hours')['delta'] == 2
    restore_backup(doc, {}, {}, preview['fingerprint'], 1)
    assert DailyRecord.query.first().actual_hours == 6
    preview = build_preview(doc, {})
    restore_backup(doc, {}, {row['key']: 'backup'}, preview['fingerprint'], 1)
    assert DailyRecord.query.first().actual_hours == 8


def test_stale_preview(backup_app):
    doc = read_backup(export_backup(1))
    preview = build_preview(doc, {})
    DailyRecord.query.first().actual_hours = 3
    db.session.commit()
    with pytest.raises(BackupTargetChanged):
        restore_backup(doc, {}, {}, preview['fingerprint'], 1)


def test_empty_target_and_optional_shared(backup_app):
    doc = read_backup(export_backup(1))
    db.session.query(DailyRecord).delete()
    from models.leave import LeaveRecord
    db.session.query(LeaveRecord).delete()
    db.session.query(Employee).delete()
    db.session.query(Department).delete()
    db.session.query(AccountSet).delete()
    db.session.commit()
    assert any(b['code'] == 'missing_employee' for b in build_preview(doc, {})['blockers'])
    options = {'employees': True, 'departments': True}
    preview = build_preview(doc, options)
    assert not preview['blockers']
    restore_backup(doc, options, {}, preview['fingerprint'], 1)
    assert DailyRecord.query.first().actual_hours == 8
    assert not AccountSet.query.first().is_active
    preview = build_preview(doc, options)
    restore_backup(doc, options, {}, preview['fingerprint'], 1)
    assert DailyRecord.query.count() == 1


def test_system_only_requires_explicit_delete(backup_app):
    doc = read_backup(export_backup(1))
    db.session.add(DailyRecord(emp_id=1, record_date=date(2026, 6, 4), actual_hours=9))
    db.session.commit()
    preview = build_preview(doc, {})
    restore_backup(doc, {}, {}, preview['fingerprint'], 1)
    assert DailyRecord.query.count() == 2
    options = {'delete_month_only': True}
    preview = build_preview(doc, options)
    restore_backup(doc, options, {}, preview['fingerprint'], 1)
    assert DailyRecord.query.count() == 1


def test_lock_blocks_changes(backup_app):
    doc = read_backup(export_backup(1))
    AccountSet.query.first().is_locked = True
    db.session.commit()
    preview = build_preview(doc, {})
    with pytest.raises(BackupError, match='锁定'):
        restore_backup(doc, {}, {}, preview['fingerprint'], 1)


def test_employee_id_collision_maps_by_number(backup_app):
    doc = read_backup(export_backup(1))
    doc['datasets']['employees'][0]['emp_no'] = 'E2'
    for rows in doc['datasets'].values():
        for row in rows:
            if row.get('emp_no') == 'E1':
                row['emp_no'] = 'E2'
    options = {'employees': True}
    preview = build_preview(doc, options)
    restore_backup(doc, options, {}, preview['fingerprint'], 1)
    second = Employee.query.filter_by(emp_no='E2').one()
    assert second.id != 1
    assert DailyRecord.query.filter_by(emp_id=second.id).one().actual_hours == 8


def test_skip_new_employee_blocks_dependent_rows(backup_app):
    doc = read_backup(export_backup(1))
    doc['datasets']['employees'][0]['emp_no'] = 'E2'
    for rows in doc['datasets'].values():
        for row in rows:
            if row.get('emp_no') == 'E1':
                row['emp_no'] = 'E2'
    options = {'employees': True}
    preview = build_preview(doc, options)
    employee_row = next(row for row in preview['rows'] if row['dataset'] == 'employees' and row['status'] == 'new')
    with pytest.raises(BackupError, match='缺少关联资料'):
        restore_backup(doc, options, {employee_row['key']: 'skip'}, preview['fingerprint'], 1)
    assert Employee.query.count() == 1


def test_cross_month_locked_account_blocks_modified_leave(backup_app):
    from models.leave import LeaveRecord
    doc = read_backup(export_backup(1))
    db.session.add(AccountSet(month='2026-05', name='五月', is_locked=True))
    LeaveRecord.query.first().reason = '系统修改'
    db.session.commit()
    preview = build_preview(doc, {})
    row = next(row for row in preview['rows'] if row['dataset'] == 'leave_records')
    with pytest.raises(BackupError, match='2026-05'):
        restore_backup(doc, {}, {row['key']: 'backup'}, preview['fingerprint'], 1)
    assert LeaveRecord.query.first().reason == '系统修改'


def test_annual_data_is_opt_in(backup_app):
    from models.annual_leave import AnnualLeave
    db.session.add(AnnualLeave(emp_id=1, year=2026, total_days=10, used_days=2, remaining_days=8))
    db.session.commit()
    doc = read_backup(export_backup(1))
    AnnualLeave.query.first().remaining_days = 5
    db.session.commit()
    preview = build_preview(doc, {})
    restore_backup(doc, {}, {}, preview['fingerprint'], 1)
    assert AnnualLeave.query.first().remaining_days == 5
    options = {'annual_stats': True}
    preview = build_preview(doc, options)
    row = next(row for row in preview['rows'] if row['dataset'] == 'annual_leave')
    restore_backup(doc, options, {row['key']: 'backup'}, preview['fingerprint'], 1)
    assert AnnualLeave.query.first().remaining_days == 8


def test_history_and_files_restore_idempotently(backup_app, tmp_path):
    from models.account_set import AccountSetImport
    from models.attendance_override_history import AttendanceOverrideHistory
    from models.account_set_backup_restore import AccountSetBackupOrigin
    path = tmp_path / '中文日报.xlsx'
    path.write_bytes(b'original')
    db.session.add(AccountSetImport(account_set_id=1, source_filename=path.name, stored_path=str(path), status='ok'))
    db.session.add(AttendanceOverrideHistory(emp_id=1, month='2026-06', override_type='employee', action_type='update', operator_user_id=1))
    db.session.commit()
    doc = read_backup(export_backup(1))
    db.session.query(AccountSetImport).delete()
    db.session.query(AttendanceOverrideHistory).delete()
    db.session.commit()
    preview = build_preview(doc, {})
    restore_backup(doc, {}, {}, preview['fingerprint'], 1)
    preview = build_preview(doc, {})
    assert not any(row['status'] == 'new' for row in preview['rows'] if row['enabled'])
    restore_backup(doc, {}, {}, preview['fingerprint'], 1)
    assert AttendanceOverrideHistory.query.count() == 1
    assert AccountSetImport.query.count() == 1
    assert read_backup(export_backup(1))['_files'] == doc['_files']
    assert AccountSetBackupOrigin.query.count() == 2


def test_database_failure_rolls_back_files_and_data(backup_app, tmp_path, monkeypatch):
    from models.account_set import AccountSetImport
    from sqlalchemy.exc import IntegrityError
    path = tmp_path / '日报.xlsx'
    path.write_bytes(b'old')
    db.session.add(AccountSetImport(account_set_id=1, source_filename=path.name, stored_path=str(path), status='ok'))
    db.session.commit()
    doc = read_backup(export_backup(1))
    db.session.query(AccountSetImport).delete()
    DailyRecord.query.first().actual_hours = 4
    db.session.commit()
    preview = build_preview(doc, {})
    daily = next(row for row in preview['rows'] if row['dataset'] == 'daily_records')
    def broken_commit():
        raise IntegrityError('commit', {}, Exception('broken'))
    monkeypatch.setattr(db.session, 'commit', broken_commit)
    with pytest.raises(BackupError):
        restore_backup(doc, {}, {daily['key']: 'backup'}, preview['fingerprint'], 1)
    assert DailyRecord.query.first().actual_hours == 4
    assert AccountSetImport.query.count() == 0
    assert path.read_bytes() == b'old'
    assert not list((tmp_path / 'backup_restores').glob('*'))


def test_original_file_content_difference_can_be_restored(backup_app, tmp_path):
    from models.account_set import AccountSetImport
    path = tmp_path / '日报.xlsx'
    path.write_bytes(b'backup-content')
    db.session.add(AccountSetImport(account_set_id=1, source_filename=path.name, stored_path=str(path), status='ok'))
    db.session.commit()
    doc = read_backup(export_backup(1))
    path.write_bytes(b'system-content')
    preview = build_preview(doc, {})
    row = next(row for row in preview['rows'] if row['dataset'] == 'imports')
    assert row['status'] == 'changed'
    restore_backup(doc, {}, {row['key']: 'backup'}, preview['fingerprint'], 1)
    assert open(AccountSetImport.query.first().stored_path, 'rb').read() == b'backup-content'


def test_restore_after_deleted_origin_updates_local_reference(backup_app, tmp_path):
    from models.account_set import AccountSetImport
    from models.account_set_backup_restore import AccountSetBackupOrigin
    path = tmp_path / '日报.xlsx'
    path.write_bytes(b'original')
    db.session.add(AccountSetImport(account_set_id=1, source_filename=path.name, stored_path=str(path), status='ok'))
    db.session.commit()
    doc = read_backup(export_backup(1))
    db.session.query(AccountSetImport).delete()
    db.session.commit()
    preview = build_preview(doc, {})
    restore_backup(doc, {}, {}, preview['fingerprint'], 1)
    db.session.query(AccountSetImport).delete()
    db.session.add(AccountSetImport(id=100, account_set_id=1, source_filename='unrelated', stored_path=str(path), status='ok'))
    db.session.commit()
    preview = build_preview(doc, {})
    restore_backup(doc, {}, {}, preview['fingerprint'], 1)
    current = AccountSetImport.query.filter(AccountSetImport.id != 100).one()
    assert AccountSetBackupOrigin.query.filter_by(dataset='imports').one().local_id == current.id
    preview = build_preview(doc, {})
    assert not any(row['dataset'] == 'imports' and row['status'] == 'new' for row in preview['rows'])


def test_cleanup_failure_returns_warning_after_success(backup_app, monkeypatch):
    import services.account_set_restore_service as service
    doc = read_backup(export_backup(1))
    preview = build_preview(doc, {})
    def failed_cleanup(root):
        raise OSError('disk full')
    monkeypatch.setattr(service, 'cleanup_old_files', failed_cleanup)
    result = restore_backup(doc, {}, {}, preview['fingerprint'], 1)
    assert result['warnings']


def test_original_file_slot_matches_across_source_ids(backup_app, tmp_path):
    from models.account_set import AccountSetImport
    path = tmp_path / '员工日报.xlsx'
    path.write_bytes(b'backup')
    db.session.add(AccountSetImport(account_set_id=1, source_filename=path.name, stored_path=str(path), status='ok', file_type='daily'))
    db.session.commit()
    doc = read_backup(export_backup(1))
    db.session.query(AccountSetImport).delete()
    path.write_bytes(b'system')
    db.session.add(AccountSetImport(id=100, account_set_id=1, source_filename='另一个日报.xlsx', stored_path=str(path), status='ok', file_type='daily'))
    db.session.commit()
    preview = build_preview(doc, {})
    rows = [row for row in preview['rows'] if row['dataset'] == 'imports']
    assert len(rows) == 1
    assert rows[0]['status'] == 'changed'
    restore_backup(doc, {}, {rows[0]['key']: 'backup'}, preview['fingerprint'], 1)
    assert AccountSetImport.query.count() == 1


def test_selected_card_swap_is_applied_atomically(backup_app):
    Employee.query.first().card_no = 'A'
    second = Employee(emp_no='E2', name='乙', card_no='B')
    db.session.add(second)
    db.session.flush()
    db.session.add(DailyRecord(emp_id=second.id, record_date=date(2026, 6, 3)))
    db.session.commit()
    doc = read_backup(export_backup(1))
    for row in doc['datasets']['employees']:
        row['card_no'] = 'B' if row['emp_no'] == 'E1' else 'A'
    options = {'employees': True}
    preview = build_preview(doc, options)
    choices = {row['key']: 'backup' for row in preview['rows'] if row['dataset'] == 'employees'}
    restore_backup(doc, options, choices, preview['fingerprint'], 1)
    assert Employee.query.filter_by(emp_no='E1').one().card_no == 'B'
    assert Employee.query.filter_by(emp_no='E2').one().card_no == 'A'


def test_new_account_cannot_be_silently_created_when_skipped(backup_app):
    doc = read_backup(export_backup(1))
    db.session.query(AccountSet).delete()
    db.session.commit()
    preview = build_preview(doc, {})
    row = next(row for row in preview['rows'] if row['dataset'] == 'account_set')
    with pytest.raises(BackupError, match='新账套'):
        restore_backup(doc, {}, {row['key']: 'skip'}, preview['fingerprint'], 1)
    assert AccountSet.query.count() == 0
