"""Portable follow-up state must preserve operations, never replay funds."""
from copy import deepcopy
from datetime import date, datetime
import pytest
from models import db
from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketPayment, MealTicketAdjustment
from tests.test_account_set_backup import backup_app
from services.account_set_backup_service import collect_multi_backup
from services.account_set_restore_service import build_multi_preview, restore_multi_backup
from services.account_set_backup_schema import BackupError


def seed():
    from models.meal_ticket import MealTicketFollowupTask, MealTicketFollowupAllocation
    b = MealTicketBatch(account_set_id=1, month='2026-06', recharge_month='2026-07',
        source_digest='x', created_by='admin', status='confirmed', followup_state={
            'baselines': {}, 'requests': {}, 'current_task_key': None, 'skip_sequence': 1})
    db.session.add(b); db.session.flush()
    i = MealTicketItem(batch_key=b.key, month=b.month, emp_id=1, emp_no_snapshot='E1', name='甲',
        dept_name='生产', is_manager=False, days=1, base_cents=800, source={})
    db.session.add(i); db.session.flush()
    adjustment = MealTicketAdjustment(item_key=i.key, month=b.month, amount_cents=2400, reason='补发义务', operator='admin')
    db.session.add(adjustment); db.session.flush()
    p = MealTicketPayment(item_key=i.key, month=b.month, kind='recharge', amount_cents=1000,
        payment_date=date(2026,7,2), reference='到账', operator='admin', request_key='p', request_digest='x')
    t = MealTicketFollowupTask(batch_key=b.key, item_key=i.key, month=b.month, kind='recharge',
        amount_cents=2400, status='partial', version=2, offset_enabled=False, operator='admin',
        operation_at=datetime(2026,7,1), source_snapshot={'baseline_at':'2026-07-01T00:00:00',
            'payments':{}, 'adjustments':{adjustment.key:2400}, 'settings_digest':'x'}, skip_order=0)
    db.session.add_all([p,t]); db.session.flush()
    db.session.add(MealTicketFollowupAllocation(month=b.month, task_key=t.key, payment_key=p.key,
        amount_cents=1000, operator='admin'))
    b.followup_state = {**b.followup_state, 'current_task_key':t.key, 'baselines':{i.key:{
        'baseline_at':'2026-07-01T00:00:00', 'payments':{}, 'adjustments':{},
        'initial':{'recharge':800, 'refund':0}, 'due_cents':800, 'paid_cents':0}}}
    db.session.commit()
    return b,t,p


def test_export_restore_remaps_ids_keeps_partial_and_cursor(backup_app):
    from models.meal_ticket import MealTicketFollowupTask, MealTicketFollowupAllocation
    b,t,p = seed()
    keys = t.key,p.key
    document = collect_multi_backup([1])
    rows = document['monthly']['2026-06']['datasets']
    assert rows['meal_followup_tasks'][0]['item_key'] == t.item_key
    assert rows['meal_followup_allocations'][0]['payment_key'] == p.key
    db.session.query(MealTicketFollowupAllocation).delete()
    db.session.query(MealTicketFollowupTask).delete()
    # Restore local IDs may differ; references are entirely portable keys.
    db.session.commit()
    selection = {'months':['2026-06'], 'categories':['meal_tickets']}
    preview = build_multi_preview(document, selection)
    assert preview['blockers'] == []
    restore_multi_backup(document, selection, {}, preview['fingerprint'], 1)
    restored = MealTicketFollowupTask.query.filter_by(key=keys[0]).one()
    assert restored.status == 'partial'
    assert restored.offset_enabled is False
    assert b.followup_state['current_task_key'] == keys[0]
    assert MealTicketPayment.query.count() == 1


@pytest.mark.parametrize('mutation', ['missing_task','missing_payment','over_payment','over_task','duplicate','reversed'])
def test_invalid_allocation_blocks_preview(backup_app, mutation):
    seed()
    document = collect_multi_backup([1])
    rows = document['monthly']['2026-06']['datasets']
    a = rows['meal_followup_allocations'][0]
    if mutation == 'missing_task': a['task_key'] = 'f'*32
    elif mutation == 'missing_payment': a['payment_key'] = 'f'*32
    elif mutation == 'over_payment': a['amount_cents'] = 1001
    elif mutation == 'over_task': rows['meal_followup_tasks'][0]['amount_cents'] = 999
    elif mutation == 'duplicate':
        clone = {**a, 'key':'f'*32}; rows['meal_followup_allocations'].append(clone)
    else:
        p = rows['meal_payments'][0]
        rows['meal_payments'].append({**p, 'key':'f'*32, 'kind':'reversal', 'amount_cents':-1000,
            'reversal_of':p['key'], 'request_key':'reversal'})
        # A partial task claiming reversed funds is inconsistent.
    preview = build_multi_preview(document, {'months':['2026-06'], 'categories':['meal_tickets']})
    assert preview['blockers']


@pytest.mark.parametrize('mutation', ['missing_adjustment_source','wrong_baseline_payment','other_item_payment','bad_snapshot'])
def test_followup_portable_sources_must_exist_and_match(backup_app, mutation):
    seed()
    document = collect_multi_backup([1])
    rows = document['monthly']['2026-06']['datasets']
    snapshot = rows['meal_followup_tasks'][0]['source_snapshot']
    if mutation == 'missing_adjustment_source': snapshot['adjustments'] = {'f'*32:2400}
    elif mutation == 'wrong_baseline_payment': snapshot['payments'] = {rows['meal_payments'][0]['key']:999}
    elif mutation == 'other_item_payment': rows['meal_payments'][0]['item_key'] = 'f'*32
    else: rows['meal_followup_tasks'][0]['source_snapshot'] = []
    preview = build_multi_preview(document, {'months':['2026-06'], 'categories':['meal_tickets']})
    assert preview['blockers']


def test_old_v2_absent_preserves_tasks_and_navigation(backup_app):
    from models.meal_ticket import MealTicketFollowupTask
    b,t,p = seed()
    document = collect_multi_backup([1])
    rows = document['monthly']['2026-06']['datasets']
    for name in ('meal_followup_tasks', 'meal_followup_allocations'):
        del rows[name]
        document['coverage'].pop('month/2026-06/' + name)
        document['dataset_versions'].pop(name)
    rows['meal_batches'][0].pop('followup_state')
    document['dataset_versions']['meal_batches'] = 1
    preview = build_multi_preview(document, {'months':['2026-06'], 'categories':['meal_tickets']})
    assert preview['coverage']['month/2026-06/meal_followup_tasks'] == {'included':False, 'complete':False}
    assert not any(r['dataset'].startswith('meal_followup') and r['choice'] == 'backup' for r in preview['rows'])
    assert b.followup_state['current_task_key'] == t.key
    restore_multi_backup(document, {'months':['2026-06'], 'categories':['meal_tickets']}, {}, preview['fingerprint'], 1)
    assert MealTicketFollowupTask.query.count() == 1
    assert b.followup_state['current_task_key'] == t.key


def test_upgrade_old_structure_twice_and_migration_order(backup_app):
    from sqlalchemy import text, inspect
    from services.bootstrap_service import ensure_schema_compatibility
    from services.migration_service import MIGRATION_ORDER
    seed()
    db.session.execute(text('DROP TABLE meal_ticket_followup_allocations'))
    db.session.execute(text('DROP TABLE meal_ticket_followup_tasks'))
    db.session.execute(text('ALTER TABLE meal_ticket_batches DROP COLUMN followup_state'))
    db.session.commit()
    ensure_schema_compatibility(); ensure_schema_compatibility()
    assert 'followup_state' in {c['name'] for c in inspect(db.engine).get_columns('meal_ticket_batches')}
    assert MealTicketPayment.query.one().amount_cents == 1000
    assert MIGRATION_ORDER.index('meal_ticket_payments') < MIGRATION_ORDER.index('meal_ticket_followup_allocations')
    assert MIGRATION_ORDER.index('meal_ticket_followup_tasks') < MIGRATION_ORDER.index('meal_ticket_followup_allocations')


def test_restore_in_fresh_database_with_different_parent_ids(backup_app, tmp_path):
    from flask import Flask
    from sqlalchemy import event
    from models.account_set import AccountSet
    from models.employee import Employee
    from models.user import User
    from models.meal_ticket import MealTicketFollowupTask, MealTicketFollowupAllocation
    from services.account_set_backup_service import export_multi_backup, read_backup
    b,t,p = seed()
    task_key, payment_key = t.key,p.key
    from services.monthly_reference_service import ensure_month_reference
    ensure_month_reference('2026-06')
    db.session.commit()
    # Exercise the actual ZIP codec as well as preview/restore.
    document = read_backup(export_multi_backup([1]), normalized=True)
    target = Flask('followup-cross-id')
    target.config.update(SQLALCHEMY_DATABASE_URI='sqlite:///' + str(tmp_path/'target.db'),
        SQLALCHEMY_TRACK_MODIFICATIONS=False, UPLOAD_FOLDER=str(tmp_path/'target'),
        BACKUP_PRIVATE_DIR=str(tmp_path/'target-private'))
    db.init_app(target)
    with target.app_context():
        @event.listens_for(db.engine, 'connect')
        def foreign_keys(connection, record):
            connection.execute('PRAGMA foreign_keys=ON')
        db.create_all()
        db.session.add_all([User(id=91, username='admin', role='admin', password_hash='unused'),
            Employee(id=99, emp_no='E1', name='甲'), AccountSet(id=77, month='2026-06', name='目标六月')])
        db.session.commit()
        selection = {'months':['2026-06'], 'categories':['meal_tickets']}
        preview = build_multi_preview(document, selection)
        assert not preview['blockers']
        restore_multi_backup(document, selection, {}, preview['fingerprint'], 91)
        assert MealTicketBatch.query.one().account_set_id == 77
        assert MealTicketItem.query.one().emp_id == 99
        assert MealTicketFollowupTask.query.one().key == task_key
        assert MealTicketFollowupTask.query.one().status == 'partial'
        assert MealTicketFollowupAllocation.query.one().payment_key == payment_key
        assert MealTicketPayment.query.count() == 1
        db.session.remove()
        db.drop_all()


def test_old_v1_absent_does_not_delete_followup_state(backup_app):
    from services.account_set_backup_service import collect_backup
    from models.meal_ticket import MealTicketFollowupTask, MealTicketFollowupAllocation
    b,t,p = seed()
    document = collect_backup(1)
    selection = {'months':['2026-06'], 'categories':['meal_tickets']}
    preview = build_multi_preview(document, selection)
    assert not preview['blockers']
    assert preview['coverage']['month/2026-06/meal_followup_tasks']['included'] is False
    restore_multi_backup(document, selection, {}, preview['fingerprint'], 1)
    assert MealTicketFollowupTask.query.one().status == 'partial'
    assert MealTicketFollowupAllocation.query.count() == 1
    assert b.followup_state['current_task_key'] == t.key


def test_invalid_persisted_navigation_or_baseline_blocks_restore(backup_app):
    seed()
    document = collect_multi_backup([1])
    row = document['monthly']['2026-06']['datasets']['meal_batches'][0]
    row['followup_state'] = {'baselines':{}, 'requests':[], 'skip_sequence':'invalid', 'current_task_key':None}
    preview = build_multi_preview(document, {'months':['2026-06'], 'categories':['meal_tickets']})
    assert preview['blockers']


def test_partial_funds_cannot_be_restored_as_pending_without_explicit_retry(backup_app):
    seed()
    document = collect_multi_backup([1])
    document['monthly']['2026-06']['datasets']['meal_followup_tasks'][0]['status'] = 'pending'
    preview = build_multi_preview(document, {'months':['2026-06'], 'categories':['meal_tickets']})
    assert preview['blockers']


def test_task_amount_must_match_portable_obligation_sources(backup_app):
    seed()
    document = collect_multi_backup([1])
    document['monthly']['2026-06']['datasets']['meal_followup_tasks'][0]['amount_cents'] = 4000
    preview = build_multi_preview(document, {'months':['2026-06'], 'categories':['meal_tickets']})
    assert preview['blockers']


def test_tasks_cannot_restore_without_their_persisted_queue_baseline(backup_app):
    seed()
    document = collect_multi_backup([1])
    document['monthly']['2026-06']['datasets']['meal_batches'][0]['followup_state'] = None
    preview = build_multi_preview(document, {'months':['2026-06'], 'categories':['meal_tickets']})
    assert preview['blockers']


def test_two_month_zip_remaps_parents_and_preserves_operation_states(backup_app, tmp_path):
    """A restore must not turn either month's partial/awaiting work into pending."""
    from flask import Flask
    from sqlalchemy import event, text
    from models.account_set import AccountSet
    from models.employee import Employee
    from models.user import User
    from models.meal_ticket import MealTicketFollowupTask, MealTicketFollowupAllocation
    from models.system_setting import SystemSetting
    from services.account_set_backup_service import export_multi_backup, read_backup
    from services.monthly_reference_service import ensure_month_reference
    first, partial, payment = seed()
    second_account = AccountSet(month='2026-07', name='七月')
    db.session.add(second_account)
    db.session.flush()
    second = MealTicketBatch(account_set_id=second_account.id, month='2026-07',
        recharge_month='2026-08', source_digest='synthetic', created_by='admin', status='confirmed')
    db.session.add(second)
    db.session.flush()
    item = MealTicketItem(batch_key=second.key, month=second.month, emp_id=1,
        emp_no_snapshot='E1', name='甲', dept_name='生产', is_manager=False,
        days=1, base_cents=800, source={})
    db.session.add(item)
    db.session.flush()
    awaiting = MealTicketFollowupTask(batch_key=second.key, item_key=item.key,
        month=second.month, kind='recharge', amount_cents=800, status='awaiting',
        offset_enabled=False, operator='admin', operation_at=datetime(2026,8,1),
        source_snapshot={'baseline_at':'2026-08-01T00:00:00', 'payments':{},
            'adjustments':{}, 'initial':{'recharge':800}, 'settings_digest':'synthetic'})
    db.session.add(awaiting)
    db.session.flush()
    second.followup_state = {'baselines':{item.key:{'baseline_at':'2026-08-01T00:00:00',
        'payments':{}, 'adjustments':{}, 'initial':{'recharge':800,'refund':0},
        'due_cents':800,'paid_cents':0}}, 'requests':{},
        'current_task_key':awaiting.key, 'skip_sequence':0}
    for month in ('2026-06','2026-07'):
        ensure_month_reference(month)
    db.session.commit()
    expected_keys = partial.key, awaiting.key, payment.key
    document = read_backup(export_multi_backup([1, second_account.id]), normalized=True)
    assert document['months'] == ['2026-06','2026-07']
    target = Flask('two-month-followup-target')
    target.config.update(SQLALCHEMY_DATABASE_URI='sqlite:///' + str(tmp_path/'two-month.db'),
        SQLALCHEMY_TRACK_MODIFICATIONS=False, UPLOAD_FOLDER=str(tmp_path/'uploads'),
        BACKUP_PRIVATE_DIR=str(tmp_path/'private'))
    db.init_app(target)
    with target.app_context():
        @event.listens_for(db.engine, 'connect')
        def enable_foreign_keys(connection, record):
            connection.execute('PRAGMA foreign_keys=ON')
        db.create_all()
        db.session.add_all([User(id=91, username='admin', role='admin', password_hash='unused'),
            Employee(id=99, emp_no='E1', name='甲'),
            AccountSet(id=77, month='2026-06', name='目标六月'),
            AccountSet(id=78, month='2026-07', name='目标七月'),
            SystemSetting(key='meal_ticket_offset_enabled', value='true')])
        db.session.commit()
        selection = {'months':document['months'], 'categories':['meal_tickets']}
        preview = build_multi_preview(document, selection)
        assert not preview['blockers']
        restore_multi_backup(document, selection, {}, preview['fingerprint'], 91)
        assert [b.account_set_id for b in MealTicketBatch.query.order_by(MealTicketBatch.month)] == [77,78]
        assert {i.emp_id for i in MealTicketItem.query.all()} == {99}
        assert [(t.key,t.status,t.offset_enabled) for t in MealTicketFollowupTask.query.order_by(MealTicketFollowupTask.month)] == [
            (expected_keys[0],'partial',False), (expected_keys[1],'awaiting',False)]
        assert MealTicketFollowupAllocation.query.one().payment_key == expected_keys[2]
        assert MealTicketPayment.query.count() == 1
        assert SystemSetting.query.filter_by(key='meal_ticket_offset_enabled').one().value == 'true'
        assert db.session.execute(text('PRAGMA foreign_key_check')).all() == []
        assert {b.followup_state['current_task_key'] for b in MealTicketBatch.query.all()} == set(expected_keys[:2])
        db.session.remove()
        db.engine.dispose()
