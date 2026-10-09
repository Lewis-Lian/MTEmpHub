"""V2 export contracts, using only synthetic data in temporary SQLite."""
import io
import json
import zipfile
from datetime import date, datetime

import pytest
from models import db
from models.account_set import AccountSet, AccountSetImport
from models.annual_leave import AnnualLeave
from models.daily_record import DailyRecord
from models.department import Department
from models.leave import LeaveRecord
from models.user import User
from services import account_set_backup_service as service
from services.account_set_backup_schema import BackupError
from tests.test_account_set_backup import backup_app
from tests.test_account_set_backup_api import logged_in


@pytest.fixture
def multi_app(backup_app, tmp_path):
    db.session.add(AccountSet(id=2, month='2026-07', name='七月'))
    db.session.add(DailyRecord(emp_id=1, record_date=date(2026, 7, 3), actual_hours=7))
    leave = LeaveRecord.query.first()
    leave.start_time, leave.end_time = datetime(2026, 6, 30), datetime(2026, 7, 2)
    db.session.add(AnnualLeave(emp_id=1, year=2026, total_days=5, used_days=1, remaining_days=4))
    content = b'synthetic-file' * 10000
    for identifier in (1, 2):
        path = tmp_path / ('source%s.xlsx' % identifier)
        path.write_bytes(content)
        db.session.add(AccountSetImport(account_set_id=identifier, source_filename=path.name,
                                       stored_path=str(path), status='ok'))
    avatars = tmp_path / 'avatars'
    avatars.mkdir()
    (avatars / 'avatar.png').write_bytes(content)
    User.query.first().avatar = '/api/auth/avatar/avatar.png'
    db.session.commit()
    return backup_app


def test_split_zip_roundtrip_deduplicates_without_losing_relations(multi_app):
    payload = service.export_multi_backup([2, 1])
    doc = service.read_backup(payload, normalized=True)
    assert doc['months'] == ['2026-06', '2026-07']
    assert len(doc['shared']['users']) == len(doc['shared']['employees']) == 1
    assert len(doc['cross_month']['leave_records']) == 1
    assert len(doc['annual']['2026']['annual_leave']) == 1
    assert doc['coverage']['shared/users'] == {'included': True, 'complete': True}
    # Cross-month selection is a subset of all intervals; it cannot authorize global deletion.
    assert doc['coverage']['cross_month/leave_records']['complete'] is False
    assert len(doc['_files']) == 1
    file_key = doc['shared']['users'][0]['avatar_file_key']
    for month, hours in [('2026-06', 8), ('2026-07', 7)]:
        block = doc['monthly'][month]
        assert block['account_set']['month'] == month
        assert block['datasets']['daily_records'][0]['actual_hours'] == hours
        row = block['datasets']['imports'][0]
        assert row['account_month'] == month and row['file_key'] == file_key
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['months'] == doc['months']
        assert manifest['dataset_versions']['users'] == 1
        assert len([name for name in archive.namelist() if name == 'shared.json']) == 1
        assert set(archive.namelist()) == {'manifest.json', *(item['path'] for item in manifest['files'])}


def test_cancelled_categories_are_absent_and_archives_cancel_dependants(multi_app):
    doc = service.read_backup(service.export_multi_backup([1, 2], categories=['attendance']), normalized=True)
    assert doc['shared'] == {} and doc['_files'] == {}
    for month in doc['months']:
        assert 'imports' not in doc['monthly'][month]['datasets']
        assert 'snapshots' in doc['monthly'][month]
        assert doc['coverage']['month/%s/imports' % month] == {'included': False, 'complete': False}
    assert doc['coverage']['shared/users'] == {'included': False, 'complete': False}
    empty = service.collect_multi_backup([1], categories=[])
    assert empty['monthly']['2026-06'] == {'datasets': {}}


@pytest.mark.parametrize('ids', [[], [1, 1], [1, 999], ['1'], [True], None])
def test_invalid_account_selection(multi_app, ids):
    with pytest.raises(BackupError):
        service.collect_multi_backup(ids)


@pytest.mark.parametrize('categories', [['unknown'], ['attendance', 'attendance'], 'attendance', [1], ['monthly_references']])
def test_invalid_categories(multi_app, categories):
    with pytest.raises(BackupError):
        service.collect_multi_backup([1], categories)


def test_invalid_source_month(multi_app):
    db.session.get(AccountSet, 2).month = '2026-13'
    db.session.commit()
    with pytest.raises(BackupError, match='月份'):
        service.export_multi_backup([1, 2])


@pytest.mark.parametrize('scope', ['second_month', 'shared', 'file'])
def test_full_scope_change_during_export_is_rejected(multi_app, tmp_path, scope):
    changed = False
    def progress(**work):
        nonlocal changed
        if work['phase'] == 'packing' and not changed:
            changed = True
            if scope == 'second_month':
                DailyRecord.query.filter_by(record_date=date(2026, 7, 3)).one().actual_hours = 3
            elif scope == 'shared':
                Department.query.first().dept_name = '已更改'
            else:
                (tmp_path / 'source2.xlsx').write_bytes(b'changed')
            db.session.commit()
    with pytest.raises(BackupError, match='变化'):
        service.export_multi_backup([1, 2], progress=progress)
    assert changed


def test_missing_file_rejected_but_unselected_archives_not_read(multi_app, tmp_path):
    (tmp_path / 'source2.xlsx').unlink()
    with pytest.raises(BackupError, match='缺失'):
        service.export_multi_backup([1, 2])
    service.export_multi_backup([1, 2], categories=['attendance'])


@pytest.mark.parametrize('limit,value', [('MAX_UPLOAD', 100), ('MAX_TOTAL', 100), ('MAX_MEMBERS', 2)])
def test_bounded_export(multi_app, monkeypatch, limit, value):
    monkeypatch.setattr(service, limit, value)
    with pytest.raises(BackupError, match='限制|超过|过多'):
        service.export_multi_backup([1, 2])


def test_progress_records_real_completed_work(multi_app):
    reports = []
    service.export_multi_backup([1, 2], progress=lambda **work: reports.append(work))
    for phase in ('data', 'packing', 'verification'):
        items = [item for item in reports if item['phase'] == phase]
        assert items and items[-1]['completed'] == items[-1]['total'] > 0
        assert items[-1]['percent'] == 100
    assert any(item['phase'] == 'packing' and 0 < item['completed'] < item['total'] for item in reports)


def test_post_export_and_owned_download_progress(multi_app):
    from services.account_set_export_progress_service import get_export_progress
    client = logged_in(multi_app)
    token = 'c' * 32
    url = '/api/admin/backups/export'
    response = client.post(url, json={'account_set_ids': [1, 2], 'export_token': token})
    assert response.status_code == 200
    assert service.read_backup(response.data, normalized=True)['months'] == ['2026-06', '2026-07']
    state = client.get(url + '/progress?export_token=' + token).get_json()
    assert state['phase'] == 'download' and state['completed'] == state['total'] == len(response.data)
    assert state['status'] == 'ready' and state['percent'] == 100
    assert 'owner_id' not in state
    with pytest.raises(BackupError, match='无权'):
        get_export_progress(token, None, 99)
    assert client.post(url, json={'account_set_ids': [1], 'export_token': token}).status_code == 400
    assert client.get('/api/admin/account-sets/1/backup?export_token=' + token).status_code == 400


def test_export_failure_has_owned_progress(multi_app, tmp_path):
    client = logged_in(multi_app)
    token = 'd' * 32
    (tmp_path / 'source2.xlsx').unlink()
    response = client.post('/api/admin/backups/export', json={'account_set_ids': [1, 2], 'export_token': token})
    assert response.status_code == 400
    state = client.get('/api/admin/backups/export/progress?export_token=' + token).get_json()
    assert state['status'] == 'failed' and '缺失' in state['stage']


@pytest.mark.parametrize('body', [None, {}, {'account_set_ids': [1], 'categories': ['unknown']}, {'account_set_ids': [1, 1]}])
def test_invalid_export_request_is_client_error(multi_app, body):
    client = logged_in(multi_app)
    assert client.post('/api/admin/backups/export', json=body).status_code == 400


def test_snapshots_and_unrelated_annual_members_are_preserved(multi_app):
    from models.employee import Employee
    from services.monthly_reference_service import ensure_month_reference
    db.session.add(Employee(id=2, emp_no='E2', name='无考勤', dept_id=1))
    db.session.add(AnnualLeave(emp_id=2, year=2026, total_days=9))
    db.session.commit()
    for month in ('2026-06', '2026-07'):
        ensure_month_reference(month)
    db.session.commit()
    doc = service.read_backup(service.export_multi_backup([1, 2]), normalized=True)
    assert {row['emp_no'] for row in doc['annual']['2026']['annual_leave']} == {'E1', 'E2'}
    assert doc['coverage']['year/2026/annual_leave'] == {'included': True, 'complete': True}
    for month in doc['months']:
        snapshots = doc['monthly'][month]['snapshots']
        assert any(row['kind'] == 'employee' and row['business_key'] == 'E1' for row in snapshots)
        assert all(row['month'] == month and row['quality'] in ('baseline', 'verified', 'partial') for row in snapshots)


def test_unselected_accounts_do_not_read_missing_avatar(multi_app, tmp_path):
    (tmp_path / 'avatars/avatar.png').unlink()
    doc = service.read_backup(service.export_multi_backup([1, 2], ['attendance', 'archives']), normalized=True)
    assert doc['shared'] == {} and len(doc['_files']) == 1


def test_different_contents_keep_separate_archive_references(multi_app, tmp_path):
    (tmp_path / 'source2.xlsx').write_bytes(b'other synthetic file')
    doc = service.read_backup(service.export_multi_backup([1, 2]), normalized=True)
    assert len(doc['_files']) == 2
    key = doc['monthly']['2026-07']['datasets']['imports'][0]['file_key']
    assert doc['_files'][key] == b'other synthetic file'


def test_external_database_commit_is_seen_by_verification(multi_app):
    changed = False
    def progress(**work):
        nonlocal changed
        if work['phase'] == 'packing' and not changed:
            changed = True
            with db.engine.begin() as connection:
                connection.execute(Department.__table__.update().where(Department.id == 1).values(dept_name='外部写入'))
    with pytest.raises(BackupError, match='变化'):
        service.export_multi_backup([1, 2], progress=progress)


def test_verification_does_not_finish_before_zip_checks(multi_app, monkeypatch):
    original = service.read_backup
    reports = []
    def checked(payload, **kwargs):
        assert reports[-1]['phase'] == 'verification'
        assert reports[-1]['completed'] < reports[-1]['total']
        return original(payload, **kwargs)
    monkeypatch.setattr(service, 'read_backup', checked)
    service.export_multi_backup([1, 2], progress=lambda **work: reports.append(work))
    assert reports[-1]['phase'] == 'verification' and reports[-1]['percent'] == 100


def test_progress_describes_selected_months(multi_app):
    client = logged_in(multi_app)
    token = 'e' * 32
    response = client.post('/api/admin/backups/export', json={'account_set_ids': [2, 1], 'export_token': token})
    assert response.status_code == 200
    response.get_data()
    state = client.get('/api/admin/backups/export/progress?export_token=' + token).get_json()
    assert state['account_set_ids'] == [2, 1]


def test_aborted_download_is_not_reported_ready(multi_app):
    client = logged_in(multi_app)
    token = 'f' * 32
    response = client.post('/api/admin/backups/export', json={'account_set_ids': [1, 2], 'export_token': token}, buffered=False)
    assert response.status_code == 200
    response.close()
    state = client.get('/api/admin/backups/export/progress?export_token=' + token).get_json()
    assert state['status'] == 'failed' and state['phase'] == 'download'


def test_ledger_archive_dependency_requires_explicit_archives_selection(multi_app, tmp_path):
    from models.meal_ledger import MealLedgerRecord, MealLedgerImport
    path = tmp_path / 'ledger.xlsx'
    path.write_bytes(b'synthetic ledger')
    db.session.add(MealLedgerImport(key='source-key', kind='import', month='2026-05',
                                   source_filename=path.name, file_digest='f' * 64,
                                   stored_path=str(path), data={}, operator='test'))
    db.session.add(MealLedgerRecord(key='record-key', kind='import', month='2026-06',
                                   record_date=date(2026, 6, 2), data={'import_key': 'source-key'},
                                   request_key='request', request_digest='f' * 64, operator='test'))
    db.session.commit()
    with pytest.raises(BackupError, match='归档'):
        service.export_multi_backup([1], ['meal_ledgers'])
    doc = service.read_backup(service.export_multi_backup([1], ['meal_ledgers', 'archives']), normalized=True)
    datasets = doc['monthly']['2026-06']['datasets']
    assert datasets['meal_ledger_records'][0]['data']['import_key'] == datasets['meal_ledger_imports'][0]['key']
    assert len(doc['_files']) == 1


def test_disappearing_file_is_a_backup_error(multi_app, tmp_path, monkeypatch):
    original = service.file_digest
    def digest(path):
        if path == tmp_path / 'source2.xlsx':
            path.unlink()
        return original(path)
    monkeypatch.setattr(service, 'file_digest', digest)
    with pytest.raises(BackupError, match='原始文件'):
        service.export_multi_backup([1, 2])
