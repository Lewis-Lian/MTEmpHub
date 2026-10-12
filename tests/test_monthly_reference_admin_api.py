"""Snapshot management uses synthetic SQLite, never the configured business DB."""
from copy import deepcopy

import pytest

from models import db
from models.account_set import AccountSet
from models.daily_record import DailyRecord
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
