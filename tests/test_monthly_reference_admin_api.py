"""Snapshot management uses synthetic SQLite, never the configured business DB."""
from copy import deepcopy

import pytest

from models import db
from models.account_set import AccountSet
from models.daily_record import DailyRecord
from models.department import Department
from models.employee import Employee
from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
from models.meal_ticket import MealTicketBatch
from models.shift import Shift
from models.user import User
from routes.auth_helpers import generate_token
from services.monthly_reference_service import ensure_month_reference
from tests.test_account_set_backup import backup_app
from tests.test_account_set_backup_api import logged_in

BASE = '/api/admin/monthly-references'


def preview(client, operation, month='2026-06'):
    response = client.post(f'{BASE}/{month}/preview', json=operation)
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def apply(client, operation, compared, month='2026-06'):
    return client.post(f'{BASE}/{month}/apply', json={**operation, 'fingerprint': compared['fingerprint']})


def test_list_and_detail_are_read_only_and_expose_missing_references(backup_app):
    client = logged_in(backup_app)
    response = client.get(BASE)
    assert response.status_code == 200
    rows = response.get_json()['months']
    assert rows[0]['month'] == '2026-06'
    assert rows[0]['missing_count'] == 2
    assert rows[0]['snapshot_count'] == 0
    detail = client.get(BASE + '/2026-06').get_json()
    assert detail['missing'][0]['payload']
    assert detail['snapshots'] == []
    assert MonthlyReferenceSnapshot.query.count() == 0


def test_capture_requires_preview_and_preserves_existing_snapshots(backup_app):
    client = logged_in(backup_app)
    operation = {'action': 'capture'}
    assert client.post(BASE + '/2026-06/apply', json=operation).status_code == 400
    compared = preview(client, operation)
    assert len(compared['changes']) == 2
    assert MonthlyReferenceSnapshot.query.count() == 0
    assert apply(client, operation, compared).status_code == 200
    assert MonthlyReferenceSnapshot.query.count() == 2
    original = deepcopy(MonthlyReferenceSnapshot.query.filter_by(kind='employee').one().payload)
    Employee.query.one().name = '当前新姓名'
    db.session.commit()
    compared = preview(client, operation)
    assert compared['changes'] == []
    assert apply(client, operation, compared).status_code == 200
    assert MonthlyReferenceSnapshot.query.filter_by(kind='employee').one().payload == original


@pytest.mark.parametrize('change', ['current', 'snapshot', 'lock'])
def test_changed_preview_is_rejected_without_writing(backup_app, change):
    client = logged_in(backup_app)
    operation = {'action': 'capture'}
    compared = preview(client, operation)
    if change == 'current':
        Employee.query.one().name = '已变化'
    elif change == 'snapshot':
        ensure_month_reference('2026-06')
    else:
        AccountSet.query.one().is_locked = True
    db.session.commit()
    before = MonthlyReferenceSnapshot.query.count()
    response = apply(client, operation, compared)
    assert response.status_code in (400, 409)
    assert MonthlyReferenceSnapshot.query.count() == before


def test_correction_checks_consumers_and_only_changes_the_selected_month(backup_app):
    client = logged_in(backup_app)
    ensure_month_reference('2026-06')
    ensure_month_reference('2026-05')
    db.session.commit()
    operation = {'action': 'correct', 'kind': 'employee', 'business_key': 'E1',
                 'changes': {'name': '五月以外的修正'}, 'categories': []}
    assert client.post(BASE + '/2026-06/preview', json=operation).status_code == 400
    operation['categories'] = ['attendance']
    compared = preview(client, operation)
    assert compared['required_categories'] == ['attendance']
    assert MonthlyReferenceSnapshot.query.filter_by(month='2026-06', kind='employee').one().payload['name'] == '甲'
    assert compared['changes'][0]['after']['payload']['name'] == '五月以外的修正'
    assert apply(client, operation, compared).status_code == 200
    changed = MonthlyReferenceSnapshot.query.filter_by(month='2026-06', kind='employee').one()
    assert changed.payload['name'] == '五月以外的修正'
    assert changed.quality == 'partial'
    assert changed.provenance['fields']['name'] == 'explicit_month_correction'
    assert MonthlyReferenceSnapshot.query.filter_by(month='2026-05', kind='employee').one().payload['name'] == '甲'
    assert Employee.query.one().name == '甲'


@pytest.mark.parametrize('changes', [{'is_manager': 'false'}, {'resigned_at': 'not-a-date'},
                                    {'employee_stats_attendance_source': 'invalid'}, {'name': ''},
                                    {'dept_no': 'missing'}, {'emp_no': 'new-key'}])
def test_invalid_correction_is_rejected(backup_app, changes):
    client = logged_in(backup_app)
    ensure_month_reference('2026-06')
    db.session.commit()
    operation = {'action': 'correct', 'kind': 'employee', 'business_key': 'E1',
                 'changes': changes, 'categories': ['attendance']}
    assert client.post(BASE + '/2026-06/preview', json=operation).status_code == 400
    assert MonthlyReferenceSnapshot.query.filter_by(kind='employee').one().quality == 'baseline'


def test_evidence_requires_explicit_candidate_and_preserves_its_source(backup_app):
    client = logged_in(backup_app)
    ensure_month_reference('2026-06')
    DailyRecord.query.one().raw_data = {'姓名': '历史姓名'}
    db.session.commit()
    detail = client.get(BASE + '/2026-06').get_json()
    assert detail['evidence'][0]['candidates'][0]['value'] == '历史姓名'
    operation = {'action': 'reconcile', 'decisions': [{'business_key': 'E1', 'field': 'name', 'value': '猜测姓名'}],
                 'categories': ['attendance'], 'inspect_archives': False}
    assert client.post(BASE + '/2026-06/preview', json=operation).status_code == 400
    operation['decisions'][0]['value'] = '历史姓名'
    compared = preview(client, operation)
    assert apply(client, operation, compared).status_code == 200
    reference = MonthlyReferenceSnapshot.query.filter_by(kind='employee').one()
    assert reference.payload['name'] == '历史姓名'
    assert reference.provenance['fields']['name']['sources'][0]['table'] == 'daily_records'


def test_lock_blocks_capture_and_correction(backup_app):
    client = logged_in(backup_app)
    AccountSet.query.one().is_locked = True
    db.session.commit()
    response = client.post(BASE + '/2026-06/preview', json={'action': 'capture'})
    assert response.status_code == 400
    assert '锁定' in response.get_json()['error']
    assert MonthlyReferenceSnapshot.query.count() == 0


def test_permissions_and_invalid_months(backup_app):
    client = logged_in(backup_app)
    assert client.get(BASE + '/2026-13').status_code == 400
    assert client.get(BASE + '/2025-01').status_code == 404
    assert client.post(BASE + '/2026-06/preview', json={'action': 'delete'}).status_code == 400
    user = User(username='reader', role='viewer', password_hash='unused')
    db.session.add(user)
    db.session.commit()
    token = generate_token(user)
    client.delete_cookie('access_token')
    # Authorization headers take precedence over the administrator cookie.
    for method, path in [('get', BASE), ('get', BASE + '/2026-06'),
                         ('post', BASE + '/2026-06/preview'), ('post', BASE + '/2026-06/apply')]:
        response = getattr(client, method)(path, headers={'Authorization': 'Bearer ' + token})
        assert response.status_code == 403


def test_snapshot_only_month_still_reports_missing_current_references(backup_app):
    client = logged_in(backup_app)
    ensure_month_reference('2026-05')
    db.session.commit()
    db.session.add(Employee(emp_no='E2', name='乙'))
    db.session.commit()
    row = next(row for row in client.get(BASE).get_json()['months'] if row['month'] == '2026-05')
    assert row['missing_count'] == 1


def test_navigation_exposes_snapshot_management_only_to_administrators(backup_app):
    from utils.app_navigation import nav_payload
    admin_modules = nav_payload(User.query.one())
    assert any(entry['href'] == '/admin/monthly-references' for module in admin_modules for entry in module['entries'])
    viewer = User(username='viewer', role='viewer', password_hash='unused')
    assert not any(entry['href'] == '/admin/monthly-references' for module in nav_payload(viewer) for entry in module['entries'])


def test_shift_correction_uses_the_existing_time_slot_format(backup_app):
    client = logged_in(backup_app)
    db.session.add(Shift(shift_no='S1', shift_name='白班', time_slots=[['08:00', '17:00']]))
    ensure_month_reference('2026-06')
    db.session.commit()
    operation = {'action': 'correct', 'kind': 'shift', 'business_key': 'S1',
                 'changes': {'time_slots': [['08:30', '12:00'], ['13:00', '17:30']]}, 'categories': ['attendance']}
    compared = preview(client, operation)
    assert apply(client, operation, compared).status_code == 200
    assert MonthlyReferenceSnapshot.query.filter_by(kind='shift').one().payload['time_slots'] == [['08:30', '12:00'], ['13:00', '17:30']]
    operation['changes']['time_slots'] = [{'start': '08:00', 'end': '17:00'}]
    assert client.post(BASE + '/2026-06/preview', json=operation).status_code == 400


def test_month_wide_ingestion_switch_is_not_a_per_employee_edit(backup_app):
    client = logged_in(backup_app)
    ensure_month_reference('2026-06')
    db.session.commit()
    detail = client.get(BASE + '/2026-06').get_json()
    assert 'manager_attendance_source' not in detail['editable_fields']['employee']
    operation = {'action': 'correct', 'kind': 'employee', 'business_key': 'E1',
                 'changes': {'manager_attendance_source': 'dingtalk'}, 'categories': ['attendance']}
    assert client.post(BASE + '/2026-06/preview', json=operation).status_code == 400


def test_new_business_consumer_invalidates_the_reviewed_scope(backup_app):
    client = logged_in(backup_app)
    operation = {'action': 'capture'}
    compared = preview(client, operation)
    assert compared['required_categories'] == ['attendance']
    db.session.add(MealTicketBatch(month='2026-06', account_set_id=1, recharge_month='2026-07',
                                  source_digest='synthetic', created_by='admin'))
    db.session.commit()
    assert preview(client, operation)['required_categories'] == ['attendance', 'meal_tickets']
    assert apply(client, operation, compared).status_code == 409
    assert MonthlyReferenceSnapshot.query.count() == 0


def test_capture_rejects_cycle_created_by_mixing_history_and_current_departments(backup_app):
    client = logged_in(backup_app)
    ensure_month_reference('2026-06')
    historical = MonthlyReferenceSnapshot.query.filter_by(kind='department', business_key='D1').one()
    historical.payload = {**historical.payload, 'parent_no': 'D2'}
    db.session.add(Department(dept_no='D2', dept_name='当前子部门', parent_id=Department.query.one().id))
    db.session.commit()
    original = [deepcopy(row.payload) for row in MonthlyReferenceSnapshot.query.order_by(MonthlyReferenceSnapshot.id)]
    operation = {'action': 'capture'}
    response = client.post(BASE + '/2026-06/preview', json=operation)
    assert response.status_code == 400
    assert '循环' in response.get_json()['error']
    # Apply must independently reject the invalid final graph as well.
    response = client.post(BASE + '/2026-06/apply', json={**operation, 'fingerprint': '0' * 64})
    assert response.status_code == 400
    assert '循环' in response.get_json()['error']
    assert MonthlyReferenceSnapshot.query.count() == 2
    assert [row.payload for row in MonthlyReferenceSnapshot.query.order_by(MonthlyReferenceSnapshot.id)] == original
    # Explicitly repairing the historical parent lets missing-only capture proceed.
    correction = {'action': 'correct', 'kind': 'department', 'business_key': 'D1',
                  'changes': {'parent_no': None}, 'categories': ['attendance']}
    assert apply(client, correction, preview(client, correction)).status_code == 200
    assert apply(client, operation, preview(client, operation)).status_code == 200
    assert MonthlyReferenceSnapshot.query.filter_by(kind='department', business_key='D2').one().payload['parent_no'] == 'D1'


@pytest.mark.parametrize('kind,key,changes,expected', [
    ('employee', 'E1', {'dept_no': 'D404'}, '部门'),
    ('employee', 'E1', {'default_shift_no': 'S404'}, '班次'),
    ('department', 'D1', {'parent_no': 'D404'}, '父部门'),
    ('employee', 'E1', {'emp_no': 'E404'}, '编号'),
])
def test_capture_rejects_unresolved_or_mismatched_historical_references(backup_app, kind, key, changes, expected):
    client = logged_in(backup_app)
    ensure_month_reference('2026-06')
    historical = MonthlyReferenceSnapshot.query.filter_by(kind=kind, business_key=key).one()
    historical.payload = {**historical.payload, **changes}
    db.session.add(Employee(emp_no='E2', name='待补齐员工'))
    db.session.commit()
    original = deepcopy(historical.payload)
    response = client.post(BASE + '/2026-06/preview', json={'action': 'capture'})
    assert response.status_code == 400
    assert expected in response.get_json()['error']
    assert MonthlyReferenceSnapshot.query.count() == 2
    assert MonthlyReferenceSnapshot.query.filter_by(kind=kind, business_key=key).one().payload == original


def test_rebuild_replaces_old_month_snapshots_with_current_data(backup_app):
    client = logged_in(backup_app)
    ensure_month_reference('2026-06')
    ensure_month_reference('2026-05')
    employee = Employee.query.one()
    employee.name = '最新姓名'
    old = MonthlyReferenceSnapshot(month='2026-06', kind='employee', business_key='OLD',
        payload={'emp_no': 'OLD', 'name': '旧资料'}, quality='verified', schema_version=1,
        provenance={'source': 'history'})
    db.session.add(old)
    db.session.commit()
    operation = {'action': 'rebuild'}
    compared = preview(client, operation)
    assert MonthlyReferenceSnapshot.query.filter_by(month='2026-06', business_key='OLD').count() == 1
    removed = next(row for row in compared['changes'] if row['business_key'] == 'OLD')
    assert removed['after'] is None
    assert apply(client, operation, compared).status_code == 200
    rows = MonthlyReferenceSnapshot.query.filter_by(month='2026-06').all()
    assert {row.business_key for row in rows} == {'E1', 'D1'}
    assert next(row for row in rows if row.kind == 'employee').payload['name'] == '最新姓名'
    assert all(row.quality == 'baseline' for row in rows)
    assert MonthlyReferenceSnapshot.query.filter_by(month='2026-05', kind='employee').one().payload['name'] == '甲'
    assert DailyRecord.query.count() == 1


@pytest.mark.parametrize('change', ['current', 'snapshot', 'lock'])
def test_rebuild_rejects_stale_preview_without_replacing_snapshots(backup_app, change):
    client = logged_in(backup_app)
    ensure_month_reference('2026-06')
    db.session.commit()
    operation = {'action': 'rebuild'}
    compared = preview(client, operation)
    if change == 'current':
        Employee.query.one().name = '变化姓名'
    elif change == 'snapshot':
        MonthlyReferenceSnapshot.query.filter_by(kind='employee').one().payload = {'name': '被修改'}
    else:
        AccountSet.query.one().is_locked = True
    db.session.commit()
    before = [(row.id, deepcopy(row.payload)) for row in MonthlyReferenceSnapshot.query.all()]
    assert apply(client, operation, compared).status_code in (400, 409)
    assert [(row.id, row.payload) for row in MonthlyReferenceSnapshot.query.all()] == before


def test_rebuild_invalid_current_relations_preserves_old_snapshots(backup_app):
    client = logged_in(backup_app)
    ensure_month_reference('2026-06')
    db.session.commit()
    before = [(row.id, deepcopy(row.payload)) for row in MonthlyReferenceSnapshot.query.all()]
    department = Department.query.one()
    department.parent_id = department.id
    db.session.commit()
    response = client.post(BASE + '/2026-06/preview', json={'action': 'rebuild'})
    assert response.status_code == 400
    assert [(row.id, row.payload) for row in MonthlyReferenceSnapshot.query.all()] == before


def test_snapshot_summary_and_capture_do_not_load_attendance_payloads(backup_app):
    from sqlalchemy import event
    client = logged_in(backup_app)
    statements = []
    def capture_sql(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.lower())
    event.listen(db.engine, 'before_cursor_execute', capture_sql)
    try:
        assert client.get(BASE).status_code == 200
        response = client.get(BASE + '/2026-06?summary=1')
        assert response.status_code == 200
        assert response.get_json()['missing']
        preview(client, {'action': 'capture'})
    finally:
        event.remove(db.engine, 'before_cursor_execute', capture_sql)
    attendance_reads = [sql for sql in statements if 'from daily_records' in sql or 'from monthly_reports' in sql]
    assert attendance_reads
    assert not any('raw_data' in sql or 'employee_payload' in sql or 'agg_01' in sql for sql in attendance_reads)


def test_lightweight_snapshot_months_include_business_months_without_accounts(backup_app):
    client = logged_in(backup_app)
    employee = Employee.query.one()
    from datetime import date
    db.session.add(DailyRecord(emp_id=employee.id, record_date=date(2026, 4, 8), actual_hours=8))
    db.session.commit()
    months = client.get(BASE).get_json()['months']
    assert '2026-04' in {row['month'] for row in months}
    detail = client.get(BASE + '/2026-04?summary=1')
    assert detail.status_code == 200
    assert detail.get_json()['missing']
