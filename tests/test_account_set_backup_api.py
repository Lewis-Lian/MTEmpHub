from io import BytesIO
from datetime import timedelta
from models import db
from models.user import User
from routes import register_routes
from routes.auth_helpers import issue_slider_verified_token
from tests.csrf_helper import attach_origin
from tests.test_account_set_backup import backup_app
from services.account_set_backup_service import export_backup


def logged_in(app):
    app.config.update(SECRET_KEY='backup-test', JWT_EXPIRES_DELTA=timedelta(hours=1),
                      FRONTEND_ORIGIN='http://localhost:5173')
    register_routes(app)
    User.query.first().set_password('test-password')
    db.session.commit()
    token = issue_slider_verified_token()
    client = attach_origin(app.test_client())
    assert client.post('/api/auth/login', json={'username': 'admin', 'password': 'test-password', 'captcha_token': token}).status_code == 200
    return client


def test_download_preview_and_restore(backup_app):
    client = logged_in(backup_app)
    response = client.get('/api/admin/account-sets/1/backup')
    assert response.status_code == 200
    preview = client.post('/api/admin/account-set-backups/preview', data={'file': (BytesIO(response.data), 'backup.zip')})
    assert preview.status_code == 200
    payload = preview.get_json()
    result = client.post('/api/admin/account-set-backups/%s/restore' % payload['token'], json={
        'options': {}, 'choices': {}, 'fingerprint': payload['fingerprint']})
    assert result.status_code == 200
    assert result.get_json()['month'] == '2026-06'
    assert client.post('/api/admin/account-set-backups/%s/restore' % payload['token'], json={}).status_code == 400


def test_preview_does_not_mutate_and_cancel(backup_app):
    client = logged_in(backup_app)
    payload = export_backup(1)
    response = client.post('/api/admin/account-set-backups/preview', data={'file': (BytesIO(payload), 'backup.zip')})
    token = response.get_json()['token']
    assert client.delete('/api/admin/account-set-backups/' + token).status_code == 200
    assert client.post('/api/admin/account-set-backups/' + token + '/preview', json={'options': {}}).status_code == 400


def test_preview_owner_and_expiry(backup_app):
    import json
    import time
    from routes.admin_backups import preview_root
    client = logged_in(backup_app)
    payload = export_backup(1)
    response = client.post('/api/admin/account-set-backups/preview', data={'file': (BytesIO(payload), 'backup.zip')})
    token = response.get_json()['token']
    metadata_path = preview_root() / token / 'metadata.json'
    metadata = json.loads(metadata_path.read_text())
    metadata['owner_id'] = 99
    metadata_path.write_text(json.dumps(metadata))
    assert client.post('/api/admin/account-set-backups/' + token + '/preview', json={'options': {}}).status_code == 400
    metadata['owner_id'] = 1
    metadata['created_at'] = time.time() - 3601
    metadata_path.write_text(json.dumps(metadata))
    assert client.post('/api/admin/account-set-backups/' + token + '/preview', json={'options': {}}).status_code == 400
    assert not metadata_path.parent.exists()


def test_preview_storage_is_not_public_static(backup_app):
    from routes.admin_backups import preview_root
    client = logged_in(backup_app)
    backup_app.config['BACKUP_PRIVATE_DIR'] = backup_app.static_folder + '/backups'
    response = client.post('/api/admin/account-set-backups/preview', data={'file': (BytesIO(export_backup(1)), 'backup.zip')})
    assert response.status_code == 400
    assert '公开静态' in response.get_json()['error']


def test_unauthenticated_and_non_admin_cannot_download(backup_app):
    client = logged_in(backup_app)
    ordinary = attach_origin(backup_app.test_client())
    assert ordinary.get('/api/admin/account-sets/1/backup').status_code == 401
    User.query.first().role = 'employee'
    db.session.commit()
    assert client.get('/api/admin/account-sets/1/backup').status_code == 403
