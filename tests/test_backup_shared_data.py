import json
from datetime import date

import pytest
from flask import Flask

from models import db
from models.department import Department
from models.employee import Employee
from models.shift import Shift
from models.employee_shift import EmployeeShiftAssignment
from models.user import User, UserEmployeeAssignment, UserDepartmentAssignment
from services import account_set_backup_service as service
from services import backup_document
from services.account_set_backup_schema import BackupError


@pytest.fixture
def shared_app(tmp_path):
    app = Flask(__name__)
    app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite://',
                      SQLALCHEMY_TRACK_MODIFICATIONS=False, UPLOAD_FOLDER=str(tmp_path))
    db.init_app(app)
    with app.app_context():
        db.create_all()
        parent = Department(id=11, dept_no='ROOT', dept_name='总厂')
        child = Department(id=12, dept_no='EMPTY', dept_name='空部门', parent_id=11, is_active=False)
        employee = Employee(id=21, emp_no='NO_RECORDS', name='离职人员', dept_id=12,
                            resigned_at=date(2026, 5, 1), is_active=False)
        shift = Shift(id=31, shift_no='UNUSED', shift_name='未分配', is_active=False)
        assigned = Shift(id=32, shift_no='DEFAULT', shift_name='默认班次')
        user = User(id=41, username='reader', profile_emp_no='NO_RECORDS', profile_name='账号姓名',
                    profile_dept_id=12, role='readonly', is_active=False, auth_version=9,
                    page_permissions={'individual_attendance': True},
                    login_disabled_until_admin_unlock=True, login_disabled_reason='人工禁用',
                    login_failed_attempts=7)
        user.set_password('synthetic-password')
        db.session.add_all([parent, child, employee, shift, assigned, user])
        db.session.flush()
        db.session.add_all([EmployeeShiftAssignment(emp_id=21, shift_id=32),
                            UserEmployeeAssignment(user_id=41, emp_id=21),
                            UserDepartmentAssignment(user_id=41, dept_id=12)])
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def test_full_shared_collection_includes_unrelated_and_archived_data(shared_app):
    result = service.collect_shared_backup()
    shared = result['shared']
    assert {row['dept_no'] for row in shared['departments']} == {'ROOT', 'EMPTY'}
    assert {row['shift_no'] for row in shared['shifts']} == {'UNUSED', 'DEFAULT'}
    assert shared['employees'][0]['emp_no'] == 'NO_RECORDS'
    assert shared['employees'][0]['resigned_at'] == '2026-05-01'
    assert shared['employees'][0]['is_active'] is False
    assert next(row for row in shared['departments'] if row['dept_no'] == 'EMPTY')['parent_no'] == 'ROOT'
    assert shared['employee_shift_assignments'] == [{'emp_no': 'NO_RECORDS', 'shift_no': 'DEFAULT'}]
    assert all(value == {'included': True, 'complete': True} for value in result['coverage'].values())
    assert set(result['coverage']) == {'shared/' + name for name in shared}


def test_accounts_preserve_hash_permissions_and_portable_references(shared_app):
    result = service.collect_shared_backup()
    shared = result['shared']
    row = shared['users'][0]
    user = db.session.get(User, 41)
    assert row['password_hash'] == user.password_hash
    assert row['password_hash'] != 'synthetic-password'
    restored = User(username='copy', password_hash=row['password_hash'])
    assert restored.check_password('synthetic-password')
    assert not restored.check_password('different-password')
    assert row['profile_dept_no'] == 'EMPTY'
    assert row['profile_emp_no'] == 'NO_RECORDS'
    assert row['is_active'] is False
    assert row['login_disabled_until_admin_unlock'] is True
    assert row['login_disabled_reason'] == '人工禁用'
    assert row['role'] == 'readonly'
    assert row['page_permissions'] == {'individual_attendance': True}
    assert row['created_at'] == user.created_at.isoformat()
    assert shared['user_employee_assignments'] == [{'username': 'reader', 'emp_no': 'NO_RECORDS'}]
    assert shared['user_department_assignments'] == [{'username': 'reader', 'dept_no': 'EMPTY'}]
    assert not {'id', 'auth_version', 'login_failed_attempts', 'login_locked_until', 'avatar'} & row.keys()
    document = dict(format_version=2, months=['2026-06'], monthly={'2026-06': {}},
                    cross_month={}, annual={}, **result)
    assert backup_document.normalize_backup(document)['shared'] == shared


def test_shared_references_resolve_against_target_business_keys(shared_app):
    shared = service.collect_shared_backup()['shared']
    db.session.remove()
    db.drop_all()
    db.create_all()
    db.session.add_all([Department(id=102, dept_no='EMPTY', dept_name='目标部门'),
                        Department(id=101, dept_no='ROOT', dept_name='目标父部门'),
                        Employee(id=201, emp_no='NO_RECORDS', name='目标人员'),
                        Shift(id=302, shift_no='DEFAULT', shift_name='目标班次'),
                        User(id=401, username='reader', password_hash='target')])
    db.session.commit()
    assert backup_document.resolve_shared_references('users', shared['users'][0]) == {'profile_dept_id': 102}
    assert backup_document.resolve_shared_references('employees', shared['employees'][0]) == {'dept_id': 102}
    child = next(row for row in shared['departments'] if row['dept_no'] == 'EMPTY')
    assert backup_document.resolve_shared_references('departments', child) == {'parent_id': 101}
    assert backup_document.resolve_shared_references('employee_shift_assignments', shared['employee_shift_assignments'][0]) == {'emp_id': 201, 'shift_id': 302}
    assert backup_document.resolve_shared_references('user_employee_assignments', shared['user_employee_assignments'][0]) == {'user_id': 401, 'emp_id': 201}
    assert backup_document.resolve_shared_references('user_department_assignments', shared['user_department_assignments'][0]) == {'user_id': 401, 'dept_id': 102}
    assert db.session.get(User, 401).password_hash == 'target'


def test_missing_grant_target_is_rejected(shared_app):
    with pytest.raises(BackupError, match='emp_no'):
        backup_document.resolve_shared_references('user_employee_assignments', {'username': 'reader', 'emp_no': 'MISSING'})


def test_avatar_is_private_file_reference_and_bytes(shared_app, tmp_path):
    directory = tmp_path / 'avatars'
    directory.mkdir()
    (directory / 'source.png').write_bytes(b'synthetic-image')
    db.session.get(User, 41).avatar = '/api/auth/avatar/source.png'
    db.session.commit()
    result = service.collect_shared_backup()
    row = result['shared']['users'][0]
    assert row['avatar_size'] == 15
    assert len(row['avatar_sha256']) == 64
    assert row['avatar_file_key'] == 'files/' + row['avatar_sha256']
    assert result['_files'] == {row['avatar_file_key']: b'synthetic-image'}
    assert str(tmp_path) not in json.dumps(result['shared'])
    assert 'source.png' not in json.dumps(result['shared'])


@pytest.mark.parametrize('avatar', ['/api/auth/avatar/missing.png', '/api/auth/avatar/../secret', '/absolute/private.png'])
def test_invalid_or_missing_avatar_cannot_silently_disappear(shared_app, avatar):
    db.session.get(User, 41).avatar = avatar
    db.session.commit()
    with pytest.raises(BackupError, match='头像'):
        service.collect_shared_backup()


def test_builtin_avatar_preserves_selector_without_a_file(shared_app):
    db.session.get(User, 41).avatar = 'default:blue'
    db.session.commit()
    result = service.collect_shared_backup()
    row = result['shared']['users'][0]
    assert row['avatar_preset'] == 'default:blue'
    assert row['avatar_file_key'] is None
    assert result['_files'] == {}


def test_uploaded_avatar_survives_v2_reader(shared_app, tmp_path):
    import hashlib
    import io
    import zipfile
    directory = tmp_path / 'avatars'
    directory.mkdir()
    (directory / 'source.png').write_bytes(b'synthetic-image')
    db.session.get(User, 41).avatar = '/api/auth/avatar/source.png'
    db.session.commit()
    result = service.collect_shared_backup()
    contents = dict(result['_files'])
    for path, value in [('shared.json', result['shared']), ('months/2026-06.json', {}),
                        ('cross_month.json', {}), ('annual.json', {})]:
        contents[path] = json.dumps(value).encode()
    manifest = dict(format_version=2, months=['2026-06'], coverage=result['coverage'],
        files=[{'path': path, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
               for path, data in contents.items()])
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for path, data in contents.items():
            archive.writestr(path, data)
        archive.writestr('manifest.json', json.dumps(manifest))
    restored = service.read_backup(output.getvalue(), normalized=True)
    assert restored['shared'] == result['shared']
    assert restored['_files'] == result['_files']


def test_empty_shared_data_is_explicitly_complete(shared_app):
    db.session.remove()
    db.drop_all()
    db.create_all()
    result = service.collect_shared_backup()
    assert len(result['shared']) == 7
    assert all(rows == [] for rows in result['shared'].values())
    assert all(scope == {'included': True, 'complete': True} for scope in result['coverage'].values())


def test_shared_collection_rejects_cyclic_department_parent_chain(shared_app):
    db.session.get(Department, 11).parent_id = 12
    db.session.commit()
    with pytest.raises(BackupError, match='循环'):
        service.collect_shared_backup()


def test_shared_avatar_collection_enforces_total_file_limit(shared_app, tmp_path, monkeypatch):
    directory = tmp_path / 'avatars'
    directory.mkdir()
    (directory / 'source.png').write_bytes(b'larger-than-bound')
    db.session.get(User, 41).avatar = '/api/auth/avatar/source.png'
    db.session.commit()
    monkeypatch.setattr(service, 'MAX_TOTAL', 4)
    with pytest.raises(BackupError, match='限制'):
        service.collect_shared_backup()


def test_avatar_symlink_cannot_read_outside_uploads(shared_app, tmp_path):
    directory = tmp_path / 'avatars'
    directory.mkdir()
    private = tmp_path / 'private.txt'
    private.write_bytes(b'private')
    (directory / 'source.png').symlink_to(private)
    db.session.get(User, 41).avatar = '/api/auth/avatar/source.png'
    db.session.commit()
    with pytest.raises(BackupError, match='头像'):
        service.collect_shared_backup()


@pytest.mark.parametrize('preset', ['/absolute/private.png', 'default:', 42])
def test_normalizer_rejects_invalid_builtin_avatar(shared_app, preset):
    result = service.collect_shared_backup()
    result['shared']['users'][0]['avatar_preset'] = preset
    document = dict(format_version=2, months=['2026-06'], monthly={'2026-06': {}},
                    cross_month={}, annual={}, **result)
    with pytest.raises(BackupError, match='头像'):
        backup_document.normalize_backup(document)


@pytest.mark.parametrize('status', ['same', 'changed', 'new', 'system_only'])
def test_shared_preview_never_exposes_password_hashes(shared_app, status):
    source = service.collect_shared_backup()['shared']['users'][0]
    target = dict(source)
    target['password_hash'] = 'different-target-hash' if status == 'changed' else source['password_hash']
    system = None if status == 'new' else target
    backup = None if status == 'system_only' else source
    row = backup_document.shared_preview_row('users', system, backup,
        coverage={'included': True, 'complete': True}, selected=True)
    assert row['status'] == status
    assert row['password_changed'] is (status != 'same')
    encoded = json.dumps(row)
    assert source['password_hash'] not in encoded
    assert 'different-target-hash' not in encoded
    assert 'password_hash' not in encoded
    assert row['default_choice'] == ('system' if status == 'same' else 'backup')
    if status == 'changed':
        assert row['fields'] == [{'name': 'password_changed', 'system': None, 'backup': None, 'changed': True}]
    assert source['password_hash'] == db.session.get(User, 41).password_hash


@pytest.mark.parametrize('coverage,selected', [
    ({'included': False, 'complete': False}, True),
    ({'included': True, 'complete': False}, True),
    ({'included': True, 'complete': True}, False),
])
def test_system_only_default_requires_complete_selected_scope(shared_app, coverage, selected):
    source = service.collect_shared_backup()['shared']['users'][0]
    row = backup_document.shared_preview_row('users', source, None, coverage=coverage, selected=selected)
    assert row['default_choice'] == 'system'
