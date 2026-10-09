from io import BytesIO
import json
import time
import pytest

from models import db
from models.daily_record import DailyRecord
from models.account_set_backup_restore import AccountSetBackupRestore
from services.account_set_backup_service import export_multi_backup, export_backup
from tests.test_account_set_backup import backup_app
from tests.test_account_set_backup_api import logged_in
from tests.test_multi_month_restore import two_months


def upload(client, data):
    response = client.post('/api/admin/backups/preview', data={'file': (BytesIO(data), 'backup.zip')})
    assert response.status_code == 200
    return response.get_json()


def test_multi_upload_repreview_restore_repeated_and_cancel(backup_app):
    client = logged_in(backup_app)
    two_months()
    payload = export_multi_backup([1, 2])
    DailyRecord.query.first().actual_hours = 2
    db.session.commit()
    initial = upload(client, payload)
    assert initial['months'] == ['2026-06', '2026-07']
    assert 'password_hash' not in json.dumps(initial)
    selection = {'months': ['2026-06'], 'categories': ['attendance']}
    url = '/api/admin/backups/' + initial['token']
    response = client.post(url + '/preview', json={'selection': selection, 'choices': {}})
    assert response.status_code == 200
    preview = response.get_json()
    body = dict(selection=selection, choices={}, fingerprint=preview['fingerprint'])
    result = client.post(url + '/restore', json=body)
    assert result.status_code == 200
    assert result.get_json()['months'] == ['2026-06']
    assert DailyRecord.query.first().actual_hours == 1
    assert client.post(url + '/restore', json=body).status_code == 400
    assert AccountSetBackupRestore.query.count() == 1
    initial = upload(client, payload)
    assert client.delete('/api/admin/backups/' + initial['token']).status_code == 200


def test_multi_owner_expiry_target_change_and_failed_audit(backup_app):
    from routes.admin_backups import preview_root
    client = logged_in(backup_app)
    two_months()
    initial = upload(client, export_multi_backup([1, 2]))
    token = initial['token']
    path = preview_root() / token / 'metadata.json'
    metadata = json.loads(path.read_text())
    metadata['owner_id'] = 99
    path.write_text(json.dumps(metadata))
    url = '/api/admin/backups/' + token
    body = dict(selection={'months': ['2026-06'], 'categories': ['attendance']}, choices={}, fingerprint=initial['fingerprint'])
    assert client.post(url + '/restore', json=body).status_code == 400
    assert client.delete(url).status_code == 400
    metadata['owner_id'] = 1
    path.write_text(json.dumps(metadata))
    DailyRecord.query.first().actual_hours = 3
    db.session.commit()
    assert client.post(url + '/restore', json=body).status_code == 409
    assert AccountSetBackupRestore.query.one().counts['status'] == 'failed'
    assert DailyRecord.query.first().actual_hours == 3
    metadata['created_at'] = time.time() - 3601
    path.write_text(json.dumps(metadata))
    assert client.post(url + '/preview', json={'selection': body['selection']}).status_code == 400
    assert not path.parent.exists()


def test_upload_defaults_only_to_included_categories(backup_app):
    client = logged_in(backup_app)
    initial = upload(client, export_multi_backup([1], ['account_settings']))
    assert initial['selection']['categories'] == ['account_settings']
    assert initial['selection']['cross_month_keys'] == []
    assert initial['selection']['annual_keys'] == []


def test_multi_route_accepts_legacy_backup_without_missing_deletion(backup_app):
    client = logged_in(backup_app)
    initial = upload(client, export_backup(1))
    url = '/api/admin/backups/' + initial['token']
    selection = {'months': ['2026-06'], 'categories': ['attendance']}
    result = client.post(url + '/restore', json=dict(selection=selection, choices={}, fingerprint=initial['fingerprint']))
    assert result.status_code == 200
    assert DailyRecord.query.count() == 1


def test_operator_change_returns_result_before_next_request_is_unauthorized(backup_app):
    from models.user import User
    client = logged_in(backup_app)
    payload = export_multi_backup([1])
    User.query.one().profile_name = 'target'
    db.session.commit()
    initial = upload(client, payload)
    result = client.post('/api/admin/backups/' + initial['token'] + '/restore', json=dict(
        selection={'months': ['2026-06'], 'categories': ['accounts']}, choices={}, fingerprint=initial['fingerprint']))
    assert result.status_code == 200
    assert result.get_json()['reauthentication_required'] is True
    assert client.get('/api/admin/account-sets').status_code == 401


@pytest.mark.parametrize('legacy_task', [False, True])
def test_completed_audit_prevents_replay_when_metadata_write_fails(backup_app, monkeypatch, legacy_task):
    import routes.admin_backups as routes
    client = logged_in(backup_app)
    initial = upload(client, export_multi_backup([1]))
    if legacy_task:
        path = routes.preview_root() / initial['token'] / 'metadata.json'
        metadata = json.loads(path.read_text())
        metadata.pop('format')
        path.write_text(json.dumps(metadata))
    atomic = routes.atomic_json
    def fail_completion(path, metadata):
        if metadata.get('completed'):
            raise OSError('disk full')
        return atomic(path, metadata)
    monkeypatch.setattr(routes, 'atomic_json', fail_completion)
    body = dict(selection={'months': ['2026-06'], 'categories': ['attendance']}, choices={}, fingerprint=initial['fingerprint'])
    url = '/api/admin/backups/' + initial['token'] + '/restore'
    first = client.post(url, json=body)
    assert first.status_code == 200 and first.get_json()['warnings']
    assert client.post(url, json=body).status_code == 400
    assert AccountSetBackupRestore.query.count() == 1


def test_invalid_selection_is_rejected_without_losing_failure_audit(backup_app):
    client = logged_in(backup_app)
    initial = upload(client, export_multi_backup([1]))
    result = client.post('/api/admin/backups/' + initial['token'] + '/restore', json=dict(
        selection={'months': 1, 'categories': ['attendance']}, choices={}, fingerprint=initial['fingerprint']))
    assert result.status_code == 400
    assert AccountSetBackupRestore.query.one().counts['status'] == 'failed'
