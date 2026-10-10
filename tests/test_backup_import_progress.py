from io import BytesIO
import pytest

from services.account_set_backup_service import export_backup, export_multi_backup, read_backup
from services.account_set_backup_schema import BackupError
from services.account_set_restore_service import build_multi_preview
from tests.test_account_set_backup import backup_app
from tests.test_account_set_backup_api import logged_in


def test_upload_progress_completes_and_failure_does_not_look_successful(backup_app):
    client = logged_in(backup_app)
    token = 'a' * 32
    url = '/api/admin/backups/preview/progress?progress_token=' + token
    assert client.get(url).get_json()['status'] == 'idle'
    response = client.post('/api/admin/backups/preview?progress_token=' + token,
                           data={'file': (BytesIO(export_multi_backup([1])), 'backup.zip')})
    assert response.status_code == 200
    progress = client.get(url).get_json()
    assert progress['status'] == 'completed'
    assert progress['percent'] == 100
    assert 'owner_id' not in progress
    assert client.post('/api/admin/backups/preview?progress_token=' + token,
                       data={'file': (BytesIO(b'bad'), 'backup.zip')}).status_code == 400
    assert client.get(url).get_json()['status'] == 'completed'
    failed_token = 'b' * 32
    assert client.post('/api/admin/backups/preview?progress_token=' + failed_token,
                       data={'file': (BytesIO(b'bad'), 'backup.zip')}).status_code == 400
    assert client.get('/api/admin/backups/preview/progress?progress_token=' + failed_token).get_json()['status'] == 'failed'


def test_import_progress_is_private_and_token_is_validated(backup_app):
    from services.account_set_import_progress_service import start_import_progress, get_import_progress
    update = start_import_progress('c' * 32, 1)
    update(phase='target', completed=3, total=10, stage='读取本地数据')
    assert get_import_progress('c' * 32, 1)['percent'] == 30
    with pytest.raises(BackupError, match='无权'):
        get_import_progress('c' * 32, 99)
    with pytest.raises(BackupError):
        get_import_progress('../escape', 1)


def test_missing_schema_returns_json_error_and_logs_the_exception(backup_app, monkeypatch, caplog):
    from sqlalchemy.exc import OperationalError
    import routes.admin_backups as routes
    payload = export_multi_backup([1])
    def missing_schema(*args, **kwargs):
        raise OperationalError('SELECT ...', {}, Exception(1054, 'Unknown column followup_state'))
    monkeypatch.setattr(routes, 'build_multi_preview', missing_schema)
    client = logged_in(backup_app)
    response = client.post('/api/admin/backups/preview?progress_token=' + 'e' * 32,
                           data={'file': (BytesIO(payload), 'backup.zip')})
    assert response.status_code == 500
    assert '数据库' in response.get_json()['error'] and '升级' in response.get_json()['error']
    assert 'SELECT' not in response.get_json()['error']
    state = client.get('/api/admin/backups/preview/progress?progress_token=' + 'e' * 32).get_json()
    assert state['stage'] == response.get_json()['error']
    assert 'followup_state' in caplog.text


@pytest.mark.parametrize('legacy', [False, True])
def test_codec_and_preview_report_actual_completed_work(backup_app, legacy):
    payload = export_backup(1) if legacy else export_multi_backup([1])
    reports = []
    document = read_backup(payload, normalized=True, progress=lambda **work: reports.append(work))
    unpacked = [work for work in reports if work['phase'] == 'unpacking']
    assert unpacked[-1]['completed'] == unpacked[-1]['total'] > 0
    assert any(work['completed'] == 0 for work in unpacked)
    reports.clear()
    result = build_multi_preview(document, {'months': document['months'], 'categories': ['attendance']},
                                 progress=lambda **work: reports.append(work))
    target = [work for work in reports if work['phase'] == 'target' and work.get('total')]
    assert target[-1]['completed'] == target[-1]['total'] > 0
    assert any(0 < work['completed'] < work['total'] for work in target)
    compared = [work for work in reports if work['phase'] == 'comparison']
    assert compared[-1]['completed'] == compared[-1]['total'] == len(result['rows'])
    assert reports[-1]['phase'] == 'dependencies'


def test_concurrent_import_cannot_overwrite_progress_owner(backup_app, monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from pathlib import Path
    from services.account_set_import_progress_service import start_import_progress, get_import_progress
    barrier = threading.Barrier(2)
    exists = Path.exists
    token = 'd' * 32
    def synchronized_exists(path):
        result = exists(path)
        if path.name == token + '.json' and not result:
            barrier.wait(timeout=5)
        return result
    monkeypatch.setattr(Path, 'exists', synchronized_exists)
    def start(owner):
        with backup_app.app_context():
            try:
                start_import_progress(token, owner)
                return owner
            except BackupError:
                return None
    with ThreadPoolExecutor(max_workers=2) as executor:
        owners = list(executor.map(start, [1, 99]))
    winners = [owner for owner in owners if owner is not None]
    assert len(winners) == 1
    assert get_import_progress(token, winners[0])['status'] == 'running'
    with pytest.raises(BackupError, match='无权'):
        get_import_progress(token, 99 if winners[0] == 1 else 1)
