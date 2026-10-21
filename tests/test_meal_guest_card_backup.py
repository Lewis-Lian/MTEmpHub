"""Guest-card registry and actual payments retain portable identity and coverage."""
from datetime import date, datetime

import pytest

from models import db
from models.meal_ledger import MealLedgerRecord
from services.account_set_backup_schema import DATASETS, V2_DATASETS, DATASET_CATEGORIES
from services.account_set_backup_service import collect_backup, collect_multi_backup, export_multi_backup, read_backup
from services.account_set_restore_service import build_multi_preview, restore_multi_backup
from tests.test_account_set_backup import backup_app


SELECTION = {'months': ['2026-06'], 'categories': ['meal_ledgers']}


def seed_guest():
    from models.meal_guest_card import MealGuestCard, MealGuestRecharge
    card = MealGuestCard(card_no='009900', emp_no='GUEST01', name='固定来宾卡', operator='admin')
    db.session.add(card)
    db.session.flush()
    record = MealLedgerRecord(kind='external', month='2026-06', record_date=date(2026, 6, 2),
        amount_cents=3000, data={'category': 'card', 'guest_card_key': card.key,
        'card_no': card.card_no, 'emp_no': card.emp_no, 'name': '实际访客'},
        request_key='guest-expected', request_digest='a'*64, operator='admin')
    db.session.add(record)
    db.session.flush()
    recharge = MealGuestRecharge(month=record.month, record_key=record.key,
        source_key='card-meal:machine:recharge:1', source_digest='b'*64, amount_cents=1200,
        occurred_at=datetime(2026, 6, 3, 10), operator='admin')
    db.session.add(recharge)
    db.session.commit()
    return card, record, recharge


def test_guest_datasets_are_v2_only_in_ledger_category():
    assert 'meal_guest_cards' in V2_DATASETS
    assert 'meal_guest_recharges' in V2_DATASETS
    assert 'meal_guest_cards' not in DATASETS
    assert 'meal_guest_recharges' not in DATASETS
    assert V2_DATASETS['meal_guest_cards'].scope == 'shared'
    assert V2_DATASETS['meal_guest_recharges'].scope == 'month'
    assert DATASET_CATEGORIES['meal_guest_cards'] == DATASET_CATEGORIES['meal_guest_recharges'] == 'meal_ledgers'


def test_guest_zip_roundtrip_restores_registry_link_and_actual_funds(backup_app):
    from models.meal_guest_card import MealGuestCard, MealGuestRecharge
    card, record, recharge = seed_guest()
    expected_keys = card.key, record.key, recharge.key
    record.voided = True
    record.void_reason = '预期作废，实际流水仍保留'
    db.session.commit()
    document = read_backup(export_multi_backup([1], ['meal_ledgers']), normalized=True)
    assert document['shared']['meal_guest_cards'][0]['key'] == expected_keys[0]
    assert document['monthly']['2026-06']['datasets']['meal_guest_recharges'][0]['record_key'] == expected_keys[1]
    db.session.query(MealGuestRecharge).delete()
    db.session.query(MealLedgerRecord).delete()
    db.session.query(MealGuestCard).delete()
    db.session.commit()
    preview = build_multi_preview(document, SELECTION)
    assert not preview['blockers']
    restore_multi_backup(document, SELECTION, {}, preview['fingerprint'], 1)
    assert MealGuestCard.query.one().key == expected_keys[0]
    assert MealLedgerRecord.query.one().data['name'] == '实际访客'
    assert MealLedgerRecord.query.one().voided is True
    restored = MealGuestRecharge.query.one()
    assert (restored.key, restored.record_key, restored.amount_cents) == (expected_keys[2], expected_keys[1], 1200)


@pytest.mark.parametrize('legacy', ['v1', 'v2'])
def test_legacy_absent_datasets_never_delete_registry_or_matches(backup_app, legacy):
    from models.meal_guest_card import MealGuestCard, MealGuestRecharge
    if legacy == 'v1':
        document = collect_backup(1)
        document['datasets'].pop('meal_ledger_records')
        seed_guest()
    else:
        seed_guest()
        document = collect_multi_backup([1])
        document['shared'].pop('meal_guest_cards')
        document['monthly']['2026-06']['datasets'].pop('meal_guest_recharges')
        for name, scope in [('meal_guest_cards', 'shared'), ('meal_guest_recharges', 'month/2026-06')]:
            document['coverage'].pop(scope + '/' + name)
            document['dataset_versions'].pop(name)
    preview = build_multi_preview(document, SELECTION)
    assert not preview['blockers']
    for scope in ['shared/meal_guest_cards', 'month/2026-06/meal_guest_recharges']:
        assert preview['coverage'][scope] == {'included': False, 'complete': False}
    restore_multi_backup(document, SELECTION, {}, preview['fingerprint'], 1)
    assert MealGuestCard.query.count() == MealGuestRecharge.query.count() == 1


@pytest.mark.parametrize('mutation', ['missing_card', 'wrong_card', 'missing_record', 'wrong_month',
    'paper', 'wrong_kind', 'nonpositive', 'over_expected', 'duplicate_source', 'clearance_source'])
def test_guest_invalid_final_dependencies_block_restore(backup_app, mutation):
    seed_guest()
    document = collect_multi_backup([1])
    rows = document['monthly']['2026-06']['datasets']
    record = rows['meal_ledger_records'][0]
    actual = rows['meal_guest_recharges'][0]
    if mutation == 'missing_card': document['shared']['meal_guest_cards'] = []
    elif mutation == 'wrong_card': record['data']['card_no'] = 'other-card'
    elif mutation == 'missing_record': actual['record_key'] = 'f'*32
    elif mutation == 'wrong_month':
        # Actual belongs to June; its referenced record is retained from May.
        record['month'] = '2026-05'
        rows['meal_ledger_records'] = []
        local = MealLedgerRecord.query.one()
        local.month = '2026-05'
        db.session.commit()
    elif mutation == 'paper': record['data']['category'] = 'paper'
    elif mutation == 'wrong_kind': record['kind'] = 'clearance'
    elif mutation == 'nonpositive': actual['amount_cents'] = 0
    elif mutation == 'over_expected': actual['amount_cents'] = 3001
    elif mutation == 'duplicate_source': rows['meal_guest_recharges'].append({**actual, 'key': 'f'*32})
    else:
        rows['meal_ledger_records'].append({**record, 'key': 'f'*32, 'kind': 'clearance',
            'data': {}, 'request_key': 'clearance', 'source_key': actual['source_key']})
    preview = build_multi_preview(document, SELECTION)
    assert preview['blockers']


def test_registry_identity_cannot_change_under_retained_history(backup_app):
    seed_guest()
    document = collect_multi_backup([1])
    document['shared']['meal_guest_cards'][0]['card_no'] = 'new-card'
    # Retaining local ledger explicitly must retain its original registry identity.
    preview = build_multi_preview(document, SELECTION)
    assert preview['blockers']


@pytest.mark.parametrize('mutation', ['negative_actual', 'wrong_snapshot', 'over_expected'])
def test_export_refuses_inconsistent_guest_evidence(backup_app, mutation):
    from services.account_set_backup_schema import BackupError
    card, record, recharge = seed_guest()
    if mutation == 'negative_actual': recharge.amount_cents = -1
    elif mutation == 'wrong_snapshot': record.data = {**record.data, 'emp_no': 'wrong-account'}
    else: recharge.amount_cents = 3001
    db.session.commit()
    with pytest.raises(BackupError):
        export_multi_backup([1], ['meal_ledgers'])


def test_guest_source_cannot_also_count_as_staff_payment(backup_app):
    from tests.test_meal_ticket_followup_backup import seed
    seed_guest()
    batch, task, payment = seed()
    document = collect_multi_backup([1])
    rows = document['monthly']['2026-06']['datasets']
    rows['meal_payments'][0]['request_key'] = rows['meal_guest_recharges'][0]['source_key']
    preview = build_multi_preview(document, {'months': ['2026-06'], 'categories': ['meal_ledgers', 'meal_tickets']})
    assert any(block['code'] == 'meal_guest_source_conflict' for block in preview['blockers'])


def test_guest_sum_cannot_exceed_expectation_with_individually_small_payments(backup_app):
    seed_guest()
    document = collect_multi_backup([1])
    rows = document['monthly']['2026-06']['datasets']
    recharge = rows['meal_guest_recharges'][0]
    rows['meal_guest_recharges'].append({**recharge, 'key': 'f'*32,
        'source_key': 'card-meal:machine:recharge:2', 'amount_cents': 2000})
    preview = build_multi_preview(document, SELECTION)
    assert any(block['code'] == 'meal_guest_excess_recharge' for block in preview['blockers'])


@pytest.mark.parametrize('identifier', ['', ['bad'], {'bad': 1}])
def test_malformed_guest_reference_returns_dependency_blocker(backup_app, identifier):
    seed_guest()
    document = collect_multi_backup([1])
    document['monthly']['2026-06']['datasets']['meal_ledger_records'][0]['data']['guest_card_key'] = identifier
    preview = build_multi_preview(document, SELECTION)
    assert any(block['code'] == 'meal_guest_missing_card' for block in preview['blockers'])


def test_restore_guest_history_in_fresh_target_with_foreign_keys(backup_app, tmp_path):
    from flask import Flask
    from sqlalchemy import event, text
    from models.account_set import AccountSet
    from models.user import User
    from models.meal_guest_card import MealGuestCard, MealGuestRecharge
    card, record, recharge = seed_guest()
    expected = card.key, record.key, recharge.key
    document = read_backup(export_multi_backup([1], ['meal_ledgers']), normalized=True)
    target = Flask('guest-fresh-target')
    target.config.update(SQLALCHEMY_DATABASE_URI='sqlite:///' + str(tmp_path/'guest-target.db'),
        SQLALCHEMY_TRACK_MODIFICATIONS=False, UPLOAD_FOLDER=str(tmp_path/'target'),
        BACKUP_PRIVATE_DIR=str(tmp_path/'private-target'))
    db.init_app(target)
    with target.app_context():
        @event.listens_for(db.engine, 'connect')
        def foreign_keys(connection, record):
            connection.execute('PRAGMA foreign_keys=ON')
        db.create_all()
        db.session.add_all([User(id=91, username='admin', role='admin', password_hash='unused'),
            AccountSet(id=77, month='2026-06', name='目标六月')])
        db.session.commit()
        preview = build_multi_preview(document, SELECTION)
        assert not preview['blockers']
        restore_multi_backup(document, SELECTION, {}, preview['fingerprint'], 91)
        assert MealGuestCard.query.one().key == expected[0]
        assert MealLedgerRecord.query.one().key == expected[1]
        assert MealGuestRecharge.query.one().key == expected[2]
        assert MealGuestRecharge.query.one().record_key == expected[1]
        assert db.session.execute(text('PRAGMA foreign_key_check')).all() == []
        db.session.remove()
        db.engine.dispose()


def test_complete_selected_guest_scope_deletes_children_before_parents(backup_app):
    from models.meal_guest_card import MealGuestCard, MealGuestRecharge
    seed_guest()
    document = collect_multi_backup([1], ['meal_ledgers'])
    document['shared']['meal_guest_cards'] = []
    for name in ('meal_guest_recharges', 'meal_ledger_records'):
        document['monthly']['2026-06']['datasets'][name] = []
    preview = build_multi_preview(document, SELECTION)
    assert not preview['blockers']
    restore_multi_backup(document, SELECTION, {}, preview['fingerprint'], 1)
    assert MealGuestCard.query.count() == MealLedgerRecord.query.count() == MealGuestRecharge.query.count() == 0


@pytest.mark.parametrize('operation', ['collect', 'export'])
@pytest.mark.parametrize('evidence', ['linked', 'actual'])
def test_legacy_export_refuses_to_omit_guest_registry_and_actuals(backup_app, operation, evidence):
    from services.account_set_backup_service import export_backup
    from services.account_set_backup_schema import BackupError
    card, record, recharge = seed_guest()
    if evidence == 'linked':
        db.session.delete(recharge)
    else:
        record.data = {key: value for key, value in record.data.items() if key != 'guest_card_key'}
    db.session.commit()
    with pytest.raises(BackupError, match='多月份备份'):
        (collect_backup if operation == 'collect' else export_backup)(1)


@pytest.mark.parametrize('operation', ['validate', 'normalize', 'preview', 'restore', 'read', 'read_normalized'])
def test_legacy_linked_document_is_rejected_at_each_entry_point(backup_app, operation):
    from io import BytesIO
    import hashlib
    import json
    import zipfile
    from services.account_set_backup_service import validate_document
    from services.account_set_backup_schema import BackupError
    from services.account_set_restore_service import build_preview, restore_backup
    from services.backup_document import normalize_backup
    document = collect_backup(1)
    seed_guest()
    document['datasets']['meal_ledger_records'] = collect_multi_backup([1])['monthly']['2026-06']['datasets']['meal_ledger_records']
    with pytest.raises(BackupError, match='多月份备份'):
        if operation == 'validate': validate_document(document)
        elif operation == 'normalize': normalize_backup(document)
        elif operation == 'preview': build_preview(document, {})
        elif operation == 'restore': restore_backup(document, {}, {}, 'unused', 1)
        else:
            data = json.dumps(document).encode()
            stream = BytesIO()
            with zipfile.ZipFile(stream, 'w') as archive:
                archive.writestr('data.json', data)
                archive.writestr('manifest.json', json.dumps({'format_version': 1,
                    'data_sha256': hashlib.sha256(data).hexdigest(), 'files': []}))
            read_backup(stream.getvalue(), normalized=operation == 'read_normalized')


def test_legacy_preview_cannot_replace_target_with_guest_matches(backup_app):
    from services.account_set_backup_schema import BackupError
    from services.account_set_restore_service import build_preview
    document = collect_backup(1)
    seed_guest()
    with pytest.raises(BackupError, match='多月份备份'):
        build_preview(document, {})

def test_registry_name_change_restores_without_rewriting_history(backup_app):
    card, record, _ = seed_guest()
    document = collect_multi_backup([1])
    document['shared']['meal_guest_cards'][0]['name'] = '新的卡片名称'
    preview = build_multi_preview(document, SELECTION)
    assert not preview['blockers']
    restore_multi_backup(document, SELECTION, {}, preview['fingerprint'], 1)
    db.session.refresh(card)
    db.session.refresh(record)
    assert card.name == '新的卡片名称'
    assert record.data['name'] == '实际访客'


def test_unused_registry_identity_change_roundtrips(backup_app):
    from models.meal_guest_card import MealGuestCard
    card = MealGuestCard(card_no='00001', emp_no='G01', name='未使用卡', operator='admin')
    db.session.add(card)
    db.session.commit()
    document = collect_multi_backup([1])
    document['shared']['meal_guest_cards'][0].update(card_no='00002', emp_no='G02', name='改名卡')
    preview = build_multi_preview(document, SELECTION)
    assert not preview['blockers']
    restore_multi_backup(document, SELECTION, {}, preview['fingerprint'], 1)
    db.session.refresh(card)
    assert (card.card_no, card.emp_no, card.name) == ('00002', 'G02', '改名卡')
    exported = read_backup(export_multi_backup([1], ['meal_ledgers']), normalized=True)
    assert exported['shared']['meal_guest_cards'][0]['card_no'] == '00002'
