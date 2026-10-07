from io import BytesIO
from models import db
from models.account_set import AccountSetImport
from services.account_set_backup_service import export_backup, read_backup
from tests.test_account_set_backup import backup_app
from tests.test_account_set_backup_api import logged_in


def test_export_reports_completed_work(backup_app, tmp_path):
    source = tmp_path / '日报.xlsx'
    source.write_bytes(b'data' * 50000)
    db.session.add(AccountSetImport(account_set_id=1, source_filename=source.name, stored_path=str(source), file_type='daily', status='ok'))
    db.session.commit()
    reports = []
    data = export_backup(1, progress=lambda **item: reports.append(item))
    assert read_backup(data)['month'] == '2026-06'
    packed = [report for report in reports if report['phase'] == 'packing']
    assert packed[-1]['completed'] == packed[-1]['total'] == source.stat().st_size
    assert any(0 < report['completed'] < report['total'] for report in packed)
    assert reports[-1]['phase'] == 'verification'
    assert reports[-1]['percent'] == 100


def test_export_progress_is_owned_and_reports_failure(backup_app, tmp_path):
    client = logged_in(backup_app)
    token = 'a' * 32
    assert client.get('/api/admin/account-sets/1/backup/progress?export_token=' + token).get_json()['status'] == 'idle'
    missing = tmp_path / 'missing.xlsx'
    db.session.add(AccountSetImport(account_set_id=1, source_filename='missing.xlsx', stored_path=str(missing), status='ok'))
    db.session.commit()
    response = client.get('/api/admin/account-sets/1/backup?export_token=' + token)
    assert response.status_code == 400
    state = client.get('/api/admin/account-sets/1/backup/progress?export_token=' + token).get_json()
    assert state['status'] == 'failed'
    assert '缺失' in state['stage']
    assert client.get('/api/admin/account-sets/2/backup/progress?export_token=' + token).status_code == 400


def test_successful_export_progress_is_ready_and_private(backup_app):
    import pytest
    from services.account_set_export_progress_service import get_export_progress
    from services.account_set_backup_schema import BackupError
    client = logged_in(backup_app)
    token = 'b' * 32
    response = client.get('/api/admin/account-sets/1/backup?export_token=' + token)
    assert response.status_code == 200
    state = client.get('/api/admin/account-sets/1/backup/progress?export_token=' + token).get_json()
    assert state['status'] == 'ready'
    assert state['percent'] == 100
    assert 'owner_id' not in state
    with pytest.raises(BackupError, match='无权'):
        get_export_progress(token, 1, 99)
    assert client.get('/api/admin/account-sets/1/backup?export_token=' + token).status_code == 400
