from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
import pytest
from flask import Flask
from flask_migrate import Migrate, stamp, upgrade
from sqlalchemy import text
from werkzeug.security import generate_password_hash

from models import db
from models.user import User
from models.account_set_backup_restore import AccountSetBackupRestore
from routes import register_routes
from routes.auth_helpers import generate_token, issue_slider_verified_token
from tests.csrf_helper import attach_origin
from tests.test_account_set_backup import backup_app


@pytest.fixture
def auth_app(tmp_path):
    app = Flask(__name__)
    app.config.update(TESTING=True, SECRET_KEY='test-secret', SQLALCHEMY_DATABASE_URI='sqlite://',
                      SQLALCHEMY_TRACK_MODIFICATIONS=False, JWT_EXPIRES_DELTA=timedelta(hours=12),
                      FRONTEND_ORIGIN='http://localhost:5173', SESSION_COOKIE_NAME='access_token',
                      SESSION_COOKIE_SAMESITE='Lax', SESSION_COOKIE_SECURE=False, UPLOAD_FOLDER=str(tmp_path))
    db.init_app(app)
    register_routes(app)
    with app.app_context():
        db.create_all()
        admin = User(username='admin', role='admin')
        admin.set_password('admin123')
        member = User(username='member', role='readonly')
        member.set_password('member123')
        db.session.add_all([admin, member])
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def login(client, username='member', password='member123'):
    return client.post('/api/auth/login', json={'username': username, 'password': password,
                                              'captcha_token': issue_slider_verified_token()})


def test_version_change_revokes_cookie_and_bearer_then_new_login_succeeds(auth_app):
    client = attach_origin(auth_app.test_client())
    assert login(client).status_code == 200
    member = User.query.filter_by(username='member').one()
    old_token = generate_token(member)
    member.auth_version = 1
    db.session.commit()
    assert client.get('/api/auth/me').status_code == 401
    assert client.get('/api/auth/me', headers={'Authorization': f'Bearer {old_token}'}).status_code == 401
    assert login(client).status_code == 200
    assert client.get('/api/auth/me').status_code == 200
    assert jwt.decode(client.get_cookie('access_token').value, 'test-secret', algorithms=['HS256'])['auth_version'] == 1


def test_legacy_token_only_works_at_local_version_zero(auth_app):
    member = User.query.filter_by(username='member').one()
    now = datetime.now(timezone.utc)
    token = jwt.encode({'sub': str(member.id), 'exp': now + timedelta(hours=1)}, 'test-secret', algorithm='HS256')
    client = auth_app.test_client()
    headers = {'Authorization': f'Bearer {token}'}
    assert client.get('/api/auth/me', headers=headers).status_code == 200
    member.auth_version = 1
    db.session.commit()
    assert client.get('/api/auth/me', headers=headers).status_code == 401


@pytest.mark.parametrize('endpoint', ['login', 'change-password'])
def test_archived_account_cannot_authenticate_or_change_password(auth_app, endpoint):
    client = attach_origin(auth_app.test_client())
    member = User.query.filter_by(username='member').one()
    token = generate_token(member)
    member.is_active = False
    member.clear_login_lockout()
    db.session.commit()
    response = client.post(f'/api/auth/{endpoint}', json={
        'username': 'member', 'password': 'member123', 'current_password': 'member123',
        'new_password': 'changed', 'confirm_password': 'changed', 'captcha_token': issue_slider_verified_token(),
    })
    assert response.status_code == 423
    assert member.check_password('member123')
    assert client.get('/api/auth/me', headers={'Authorization': f'Bearer {token}'}).status_code == 401


def test_local_revocation_and_restored_hash_allow_backup_password(auth_app):
    client = attach_origin(auth_app.test_client())
    member = User.query.filter_by(username='member').one()
    assert login(client).status_code == 200
    # Same hash as serialized in a backup: never re-hash the hash or copy source version.
    member.password_hash = generate_password_hash('backup-password', method='pbkdf2:sha256')
    member.revoke_tokens()
    member.revoke_tokens()
    db.session.commit()
    assert member.auth_version == 2
    assert client.get('/api/auth/me').status_code == 401
    assert login(client, password='member123').status_code == 401
    assert login(client, password='backup-password').status_code == 200
    assert client.get('/api/auth/me').status_code == 200


@pytest.mark.parametrize('batch', [False, True])
def test_admin_delete_archives_identity_and_preserves_audit(auth_app, batch):
    client = attach_origin(auth_app.test_client())
    member = User.query.filter_by(username='member').one()
    member_id = member.id
    token = generate_token(member)
    audit = AccountSetBackupRestore(month='2026-06', operator_id=member_id, backup_digest='a' * 64, counts={})
    db.session.add(audit)
    db.session.commit()
    assert login(client, 'admin', 'admin123').status_code == 200
    response = (client.post('/api/admin/users/batch', json={'action': 'delete', 'user_ids': [member_id]})
                if batch else client.delete(f'/api/admin/users/{member_id}'))
    assert response.status_code == 200
    db.session.expire_all()
    archived = db.session.get(User, member_id)
    assert archived is not None
    assert archived.is_active is False
    assert archived.auth_version == 1
    assert audit.operator_id == member_id
    assert all(row['id'] != member_id for row in client.get('/api/admin/users').get_json())
    assert client.get('/api/auth/me', headers={'Authorization': f'Bearer {token}'}).status_code == 401
    assert client.post(f'/api/admin/disabled-users/{member_id}/unlock', json={}).status_code == 400
    assert archived.is_active is False


def test_new_restore_audit_keeps_username_snapshot_after_rename_and_archive(backup_app):
    from services.account_set_backup_service import export_backup, read_backup
    from services.account_set_restore_service import build_preview, restore_backup

    doc = read_backup(export_backup(1))
    restore_backup(doc, {}, {}, build_preview(doc, {})['fingerprint'], 1)
    audit = AccountSetBackupRestore.query.one()
    assert audit.operator_username == 'admin'
    assert audit.task_id
    admin = db.session.get(User, 1)
    admin.username = 'renamed'
    admin.is_active = False
    db.session.commit()
    assert audit.operator_username == 'admin'
    restore_backup(doc, {}, {}, build_preview(doc, {})['fingerprint'], 1)
    assert len({row.task_id for row in AccountSetBackupRestore.query.all()}) == 2


@pytest.mark.parametrize('legacy_first', [False, True])
def test_account_state_upgrade_preserves_legacy_users_and_audit(tmp_path, legacy_first):
    from services.bootstrap_service import ensure_schema_compatibility

    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI=f'sqlite:///{tmp_path / "legacy.db"}', SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    Migrate(app, db, directory=str(Path(__file__).resolve().parents[1] / 'migrations'))
    with app.app_context():
        db.create_all()
        user = User(username='original', role='admin', password_hash='legacy-hash')
        db.session.add(user)
        db.session.flush()
        db.session.add(AccountSetBackupRestore(month='2026-06', operator_id=user.id, backup_digest='a' * 64, counts={'new': 1}))
        db.session.commit()
        db.session.expunge_all()
        # Construct actual previous schema; no production database is involved.
        db.session.execute(text('DROP INDEX IF EXISTS ix_account_set_backup_restores_task_id'))
        for table, columns in [('users', ['is_active', 'auth_version']),
                               ('account_set_backup_restores', ['operator_username', 'task_id'])]:
            for column in columns:
                if column in {row[1] for row in db.session.execute(text(f'PRAGMA table_info({table})'))}:
                    db.session.execute(text(f'ALTER TABLE {table} DROP COLUMN {column}'))
        db.session.commit()
        stamp(revision='20261009_month_refs')
        if legacy_first:
            ensure_schema_compatibility()
            ensure_schema_compatibility()
        upgrade()
        upgrade()
        user = User.query.one()
        assert user.is_active is True
        assert user.auth_version == 0
        assert user.password_hash == 'legacy-hash'
        audit = AccountSetBackupRestore.query.one()
        assert audit.operator_username == 'original'
        assert audit.counts == {'new': 1}
        assert audit.month == '2026-06'
        user.username = 'renamed'
        db.session.commit()
        ensure_schema_compatibility()
        assert audit.operator_username == 'original'
        db.session.remove()
        db.drop_all()


@pytest.mark.parametrize('version', [True, '0', None, -1, 0.0])
def test_invalid_token_version_is_rejected(auth_app, version):
    member = User.query.filter_by(username='member').one()
    token = jwt.encode({'sub': str(member.id), 'auth_version': version,
                        'exp': datetime.now(timezone.utc) + timedelta(hours=1)}, 'test-secret', algorithm='HS256')
    assert auth_app.test_client().get('/api/auth/me', headers={'Authorization': f'Bearer {token}'}).status_code == 401


def test_account_state_migration_compiles_with_mysql_dialect(tmp_path):
    import importlib
    from io import StringIO
    from unittest.mock import patch
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect

    migration = importlib.import_module('migrations.versions.20261009_backup_account_state')
    engine = create_engine(f'sqlite:///{tmp_path / "ddl.db"}')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(80))'))
        connection.execute(text('CREATE TABLE account_set_backup_restores (id INTEGER PRIMARY KEY, operator_id INTEGER)'))
        inspector = inspect(connection)
        output = StringIO()
        context = MigrationContext.configure(dialect_name='mysql', opts={'as_sql': True, 'output_buffer': output})
        with patch.object(migration.sa, 'inspect', return_value=inspector):
            with Operations.context(context):
                migration.upgrade()
    ddl = output.getvalue()
    assert 'ADD COLUMN is_active BOOL NOT NULL DEFAULT true' in ddl
    assert "ADD COLUMN auth_version INTEGER NOT NULL DEFAULT '0'" in ddl
    assert 'ADD COLUMN operator_username VARCHAR(80)' in ddl
    assert 'CREATE INDEX ix_account_set_backup_restores_task_id' in ddl
    assert 'WHERE operator_username IS NULL' in ddl
    engine.dispose()
