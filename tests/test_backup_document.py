import copy
import json
from pathlib import Path
import zipfile

import pytest
from services.account_set_backup_schema import BackupError

FIXTURE = Path(__file__).parent / 'fixtures/monthly_backup/legacy-v1.zip'


def legacy_document():
    with zipfile.ZipFile(FIXTURE) as archive:
        return json.loads(archive.read('data.json'))


def test_v1_normalizes_absent_and_related_subset_without_mutating_input():
    from services.backup_document import normalize_backup, can_delete_scope
    source = legacy_document()
    before = copy.deepcopy(source)
    doc = normalize_backup(source)
    assert source == before
    assert doc['format_version'] == 2
    assert doc['source_format_version'] == 1
    assert doc['months'] == ['2026-06']
    assert doc['coverage']['shared/employees'] == {'included': True, 'complete': False}
    for scope in ('shared/users', 'month/2026-06/snapshots', 'month/2026-06/meal_items'):
        assert doc['coverage'][scope] == {'included': False, 'complete': False}
        assert not can_delete_scope(doc['coverage'][scope], True)
    assert 'meal_items' not in doc['monthly']['2026-06']['datasets']
    assert doc['shared']['employees'][0]['meal_ticket_as_manager'] is False
    assert doc['annual']['2026']['manager_stats'][0]['manual_values'] is None
    assert doc['cross_month']['overtime_records'][0]['is_revoked'] is False


def test_missing_scope_and_explicit_empty_complete_scope_are_distinct():
    from services.backup_document import normalize_backup, can_delete_scope
    doc = normalize_backup(dict(format_version=2, months=['2026-06'], shared={'employees': []},
        monthly={'2026-06': {'datasets': {}}}, cross_month={}, annual={},
        coverage={'shared/employees': {'included': True, 'complete': True}}))
    assert can_delete_scope(doc['coverage']['shared/employees'], True)
    assert not can_delete_scope(doc['coverage']['shared/users'], True)
    assert not can_delete_scope(doc['coverage']['shared/employees'], False)
    assert not can_delete_scope({'included': True, 'complete': False}, True)
    assert not can_delete_scope({'included': 1, 'complete': 1}, True)


@pytest.mark.parametrize('version', [0, 3, 999, True, '2'])
def test_unknown_versions_are_rejected(version):
    from services.backup_document import normalize_backup
    with pytest.raises(BackupError, match='版本'):
        normalize_backup({'format_version': version})


def test_coverage_cannot_claim_absent_content_is_complete():
    from services.backup_document import normalize_backup
    with pytest.raises(BackupError, match='覆盖'):
        normalize_backup(dict(format_version=2, months=['2026-06'], shared={},
            monthly={'2026-06': {'datasets': {}}}, cross_month={}, annual={},
            coverage={'shared/employees': {'included': True, 'complete': True}}))


def test_fixed_legacy_zip_can_be_read_by_old_and_normalized_callers():
    from services.account_set_backup_service import read_backup
    payload = FIXTURE.read_bytes()
    legacy = read_backup(payload)
    doc = read_backup(payload, normalized=True)
    assert legacy['month'] == '2026-06'
    assert legacy['datasets']['manager_stats'][0]['m6'] == 1
    assert doc['coverage']['month/2026-06/meal_items']['included'] is False
    assert doc['_files'] == {}


def v2_document():
    return dict(format_version=2, months=['2026-06'], shared={'employees': []},
        monthly={'2026-06': {'datasets': {}}}, cross_month={}, annual={},
        coverage={'shared/employees': {'included': True, 'complete': True}})


@pytest.mark.parametrize('change', ['local_id', 'auth_version', 'wrong_month', 'bad_type', 'unknown_dataset_version'])
def test_v2_rejects_unportable_or_invalid_fields(change):
    from services.backup_document import normalize_backup
    doc = v2_document()
    doc['shared']['employees'] = [dict(legacy_document()['datasets']['employees'][0], is_active=True, meal_ticket_as_manager=False)]
    if change == 'local_id':
        doc['shared']['employees'][0]['id'] = 456
    elif change == 'auth_version':
        doc['shared']['users'] = [{'username': 'admin', 'auth_version': 999}]
    elif change == 'wrong_month':
        doc['monthly']['2026-06']['datasets']['factory_rest'] = [{'rest_date': '2026-07-01', 'rest_period': 'full', 'account_month': '2026-06'}]
    elif change == 'bad_type':
        doc['shared']['employees'][0]['is_active'] = 'false'
    else:
        doc['dataset_versions'] = {'employees': 999}
    with pytest.raises(BackupError):
        normalize_backup(doc)


def v2_zip(doc, corrupt=None, file_data=None):
    import io
    import hashlib
    parts = {'shared.json': doc['shared'], 'cross_month.json': doc['cross_month'], 'annual.json': doc['annual']}
    parts.update({'months/%s.json' % month: block for month, block in doc['monthly'].items()})
    encoded = {path: json.dumps(value).encode() for path, value in parts.items()}
    if file_data:
        encoded.update(file_data)
    entries = [{'path': path, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for path, data in encoded.items()]
    manifest = dict(format_version=2, months=doc['months'], coverage=doc['coverage'],
                    dataset_versions=doc.get('dataset_versions', {}), files=entries)
    if corrupt == 'checksum':
        entries[0]['sha256'] = '0' * 64
    if corrupt == 'missing_member':
        encoded.pop('shared.json')
    if corrupt == 'unlisted_member':
        encoded['extra.json'] = b'{}'
    if corrupt == 'duplicate_declaration':
        entries.append(entries[0])
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr('manifest.json', json.dumps(manifest))
        for path, data in encoded.items():
            archive.writestr(path, data)
    return output.getvalue()


def test_read_v2_zip_preserves_empty_complete_and_absent_scopes():
    from services.account_set_backup_service import read_backup
    doc = read_backup(v2_zip(v2_document()), normalized=True)
    assert doc['shared']['employees'] == []
    assert doc['coverage']['shared/employees'] == {'included': True, 'complete': True}
    assert doc['coverage']['shared/users'] == {'included': False, 'complete': False}
    assert doc['source_format_version'] == 2
    # Existing restore endpoints are single-month V1 callers until stages 7/8.
    with pytest.raises(BackupError):
        read_backup(v2_zip(v2_document()))


@pytest.mark.parametrize('corrupt', ['checksum', 'missing_member', 'unlisted_member', 'duplicate_declaration'])
def test_v2_zip_rejects_invalid_member_manifest(corrupt):
    from services.account_set_backup_service import read_backup
    with pytest.raises(BackupError):
        read_backup(v2_zip(v2_document(), corrupt), normalized=True)


def test_v2_zip_rejects_unreferenced_archive():
    from services.account_set_backup_service import read_backup
    with pytest.raises(BackupError, match='文件'):
        read_backup(v2_zip(v2_document(), file_data={'files/unreferenced': b'private'}), normalized=True)


@pytest.mark.parametrize('change', ['missing_month_block', 'invalid_coverage_type', 'partial_year_key', 'invalid_snapshot_version'])
def test_v2_rejects_ambiguous_ranges_and_snapshot_versions(change):
    from services.backup_document import normalize_backup
    doc = v2_document()
    if change == 'missing_month_block':
        doc['monthly'] = {}
    elif change == 'invalid_coverage_type':
        doc['coverage']['shared/employees']['complete'] = 'false'
    elif change == 'partial_year_key':
        doc['annual'] = {'0000': {'annual_leave': []}}
    else:
        doc['monthly']['2026-06']['snapshots'] = [dict(month='2026-06', kind='employee', business_key='E1', payload={}, provenance={}, quality='baseline', schema_version=True, created_at='2026-06-01T00:00:00', updated_at='2026-06-01T00:00:00')]
    with pytest.raises(BackupError):
        normalize_backup(doc)


def test_v2_file_checksum_is_bound_to_business_row():
    import hashlib
    from services.account_set_backup_service import read_backup
    doc = v2_document()
    doc['monthly']['2026-06']['datasets']['imports'] = [dict(source_filename='日报.xlsx', file_type=None,
        status='ok', imported_count=0, error_message=None, created_at='2026-06-01T00:00:00',
        account_month='2026-06', origin_key='a' * 64, provenance={},
        file_key='files/raw.xlsx', file_sha256=hashlib.sha256(b'workbook').hexdigest(), file_size=8)]
    payload = v2_zip(doc, file_data={'files/raw.xlsx': b'workbook'})
    assert read_backup(payload, normalized=True)['_files'] == {'files/raw.xlsx': b'workbook'}
    doc['monthly']['2026-06']['datasets']['imports'][0]['file_sha256'] = '0' * 64
    with pytest.raises(BackupError, match='归档'):
        read_backup(v2_zip(doc, file_data={'files/raw.xlsx': b'workbook'}), normalized=True)


def test_legacy_missing_non_meal_category_stays_absent():
    from services.backup_document import normalize_backup
    doc = legacy_document()
    del doc['datasets']['daily_overrides']
    converted = normalize_backup(doc)
    assert converted['coverage']['month/2026-06/daily_overrides'] == {'included': False, 'complete': False}
    assert 'daily_overrides' not in converted['monthly']['2026-06']['datasets']


@pytest.mark.parametrize('months', [[{}], [True], ['2026-06', '2026-06']])
def test_normalizer_reports_malformed_month_list_as_backup_error(months):
    from services.backup_document import normalize_backup
    doc = v2_document()
    doc['months'] = months
    with pytest.raises(BackupError):
        normalize_backup(doc)


def test_v2_account_retains_creation_and_long_term_disabled_state():
    from services.backup_document import normalize_backup
    doc = v2_document()
    doc['shared']['users'] = [dict(username='archived', profile_emp_no=None, profile_name='旧账号',
        profile_dept_no=None, password_hash='synthetic-hash', role='readonly', page_permissions={},
        is_active=False, login_disabled_until_admin_unlock=True, login_disabled_reason='manual',
        created_at='2020-01-01T08:00:00', avatar_file_key=None, avatar_sha256=None, avatar_size=None)]
    row = normalize_backup(doc)['shared']['users'][0]
    assert row['created_at'] == '2020-01-01T08:00:00'
    assert row['login_disabled_until_admin_unlock'] is True
    assert row['password_hash'] == 'synthetic-hash'
    assert 'auth_version' not in row
