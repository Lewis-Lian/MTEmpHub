"""Opt-in real MySQL acceptance; only the stage10 private Unix-socket server.
PYTHON_DOTENV_DISABLED=1 PYTHONPATH=. .venv-mac/bin/python -m pytest docs/testing/monthly_backup_mysql.py -q -s
No application configuration or .env is read. Each test owns a new random schema.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from pathlib import Path
import time
from threading import Event
import uuid

import pytest
import pymysql
from flask import Flask
from flask_migrate import Migrate, stamp, upgrade
from sqlalchemy import text
from sqlalchemy.engine import URL
from models import db
from models.account_set import AccountSet
from models.account_set_backup_restore import AccountSetBackupRestore
from models.daily_record import DailyRecord
from models.department import Department
from models.employee import Employee
from models.leave import LeaveRecord
from models.user import User
from services.account_set_backup_schema import BackupTargetChanged
from services.account_set_restore_service import build_multi_preview, restore_multi_backup
from services import multi_month_restore as restore_service
from tests.test_multi_month_restore import two_months
from tests.test_monthly_backup_acceptance import (
    test_cross_year_zip_restores_fresh_schema_and_explicit_rows,
    test_cross_year_partial_restore_does_not_select_cross_or_annual_rows,
)
from tests.test_multi_month_restore import (
    test_second_month_database_failure_rolls_back_first_month,
    test_legacy_and_absent_categories_do_not_delete_existing_current_data,
    test_target_change_bypassing_cached_orm_rejects_confirmation,
    test_legacy_account_scoped_writes_bind_selected_month,
)
from tests.test_backup_document import test_fixed_legacy_zip_can_be_read_by_old_and_normalized_callers

from docs.testing.monthly_backup_scale import (
    test_twenty_four_months_sixty_seven_thousand_rows,
    test_real_ninety_mib_archive_and_over_limit_rejection,
)

ROOT = Path('/private/tmp/mtemphub-stage10-mysql')
SOCKET = str(ROOT / 'server.sock')

@pytest.fixture
def backup_app(tmp_path):
    admin = pymysql.connect(unix_socket=SOCKET, user='root', autocommit=True)
    with admin.cursor() as cursor:
        cursor.execute('SELECT @@datadir, @@version')
        datadir, version = cursor.fetchone()
        assert Path(datadir).resolve() == (ROOT / 'data').resolve(), 'Refuse external server'
        schema = 'mtemphub_stage10_' + uuid.uuid4().hex
        cursor.execute('CREATE DATABASE ' + schema + ' CHARACTER SET utf8mb4')
    app = Flask(__name__)
    uri = URL.create('mysql+pymysql', username='root', database=schema, query={'unix_socket': SOCKET})
    app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=uri, SQLALCHEMY_TRACK_MODIFICATIONS=False,
                      UPLOAD_FOLDER=str(tmp_path), BACKUP_PRIVATE_DIR=str(tmp_path / 'private'))
    db.init_app(app)
    try:
        with app.app_context():
            db.create_all()
            db.session.add_all([User(username='admin', role='admin', password_hash='unused'),
                                Department(dept_no='D1', dept_name='生产')])
            db.session.flush()
            db.session.add_all([Employee(emp_no='E1', name='甲', dept_id=1),
                                AccountSet(month='2026-06', name='六月', is_active=True)])
            db.session.flush()
            db.session.add_all([DailyRecord(emp_id=1, record_date=date(2026,6,3), actual_hours=8),
                                LeaveRecord(emp_id=1, leave_no='L1', leave_type='事假',
                                            start_time=datetime(2026,5,31),end_time=datetime(2026,6,2))])
            db.session.commit()
            yield app
            db.session.remove()
            db.engine.dispose()
    finally:
        with admin.cursor() as cursor:
            cursor.execute('DROP DATABASE ' + schema)
        admin.close()


def test_real_mysql_upgrade_preserves_previous_rows(backup_app):
    from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
    Migrate(backup_app, db, directory=str(Path('migrations').resolve()))
    db.session.add(AccountSetBackupRestore(month='2026-06', operator_id=1, backup_digest='a'*64, counts={'new':1}))
    db.session.commit()
    db.session.remove()
    MonthlyReferenceSnapshot.__table__.drop(db.engine)
    db.session.execute(text('DROP INDEX ix_account_set_backup_restores_task_id ON account_set_backup_restores'))
    for table, columns in [('employees',['is_active']),('departments',['is_active']),('shifts',['is_active']),
                           ('users',['is_active','auth_version']),('account_set_backup_restores',['operator_username','task_id'])]:
        for column in columns:
            db.session.execute(text(f'ALTER TABLE {table} DROP COLUMN {column}'))
    db.session.commit()
    stamp(revision='20261009_meal_rules')
    upgrade()
    upgrade()
    assert db.session.execute(text('SELECT version_num FROM alembic_version')).scalar() == '20261009_account_state'
    assert Employee.query.one().name == '甲' and Employee.query.one().is_active
    assert User.query.one().auth_version == 0 and User.query.one().is_active
    assert AccountSetBackupRestore.query.one().operator_username == 'admin'
    assert AccountSetBackupRestore.query.one().counts == {'new':1}
    assert MonthlyReferenceSnapshot.query.count() == 0


def paused_restore(monkeypatch):
    entered, release = Event(), Event()
    original = restore_service._build
    def hold(*args, **kwargs):
        entered.set()
        assert release.wait(15), 'Test did not release restore'
        return original(*args, **kwargs)
    monkeypatch.setattr(restore_service, '_build', hold)
    return entered, release


def test_real_mysql_writer_waits_for_restore_row_locks(backup_app, monkeypatch):
    document = two_months()
    selection = {'months': document['months'], 'categories':['attendance']}
    fingerprint = build_multi_preview(document, selection)['fingerprint']
    db.session.remove()
    entered, release = paused_restore(monkeypatch)
    engine = db.engine
    def restore():
        with backup_app.app_context():
            return restore_multi_backup(document, selection, {}, fingerprint, 1)
    def writer():
        with engine.begin() as conn:
            conn.execute(text("UPDATE daily_records SET actual_hours=9 WHERE record_date='2026-06-03'"))
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(restore)
        try:
            assert entered.wait(10)
            second = pool.submit(writer)
            deadline = time.monotonic()+5
            waiting = 0
            with engine.connect() as inspector:
                while time.monotonic() < deadline:
                    waiting = inspector.execute(text('SELECT COUNT(*) FROM performance_schema.data_lock_waits')).scalar()
                    if waiting: break
                    time.sleep(.05)
            assert waiting > 0, 'InnoDB must report a real waiting writer'
            assert not second.done()
        finally:
            release.set()
        assert first.result(15)['counts']['updated'] == 2
        second.result(15)
    assert [r.actual_hours for r in DailyRecord.query.order_by(DailyRecord.record_date)] == [9,7]


def test_concurrent_restore_serializes_then_rejects_stale_preview(backup_app, monkeypatch):
    document = two_months()
    selection = {'months':document['months'],'categories':['attendance']}
    fingerprint = build_multi_preview(document, selection)['fingerprint']
    db.session.remove()
    entered, release = paused_restore(monkeypatch)
    second_started = Event()
    def restore(second=False):
        with backup_app.app_context():
            if second: second_started.set()
            return restore_multi_backup(document, selection, {}, fingerprint, 1)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(restore)
        try:
            assert entered.wait(10)
            second = pool.submit(restore, True)
            assert second_started.wait(5)
            time.sleep(.2)
            assert not second.done()
        finally:
            release.set()
        assert first.result(15)['counts']['updated'] == 2
        with pytest.raises(BackupTargetChanged):
            second.result(15)
    assert [r.actual_hours for r in DailyRecord.query.order_by(DailyRecord.record_date)] == [8,7]
    assert sorted(row.counts["status"] for row in AccountSetBackupRestore.query.all()) == ["failed", "success"]


def test_real_mysql_meal_parent_replacement_and_payment_retry(backup_app):
    from tests.test_multi_month_restore_preview import meal_history
    from tests.test_multi_month_restore import restore
    from services.account_set_backup_service import collect_multi_backup
    from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketPayment
    from services.meal_ticket_service import payment, payment_payload, digest
    meal_history()
    batch, item = MealTicketBatch.query.one(), MealTicketItem.query.one()
    body = dict(batch_id=batch.id, item_id=item.id, kind='recharge', amount=16,
                date='2026-07-01', reference='凭证', request_key='req1')
    MealTicketPayment.query.one().request_digest = digest(payment_payload(body))
    db.session.commit()
    assert db.session.execute(text('SELECT @@foreign_key_checks')).scalar() == 1
    document = collect_multi_backup([1])
    datasets = document['monthly']['2026-06']['datasets']
    datasets['meal_batches'][0]['key'] = 'replacement-batch'
    datasets['meal_items'][0]['batch_key'] = 'replacement-batch'
    restore(document, {'months':['2026-06'], 'categories':['meal_tickets']})
    assert MealTicketBatch.query.one().key == 'replacement-batch'
    assert MealTicketItem.query.one().batch_key == 'replacement-batch'
    assert payment(body, 'admin').key == 'replacement-batch'
    assert MealTicketPayment.query.count() == 1
    assert MealTicketPayment.query.one().request_key == 'req1'


def test_real_mysql_prior_writer_commit_forces_recomparison(backup_app):
    document = two_months()
    selection = {'months':document['months'], 'categories':['attendance']}
    fingerprint = build_multi_preview(document,selection)['fingerprint']
    db.session.remove()
    engine = db.engine
    def restore():
        with backup_app.app_context():
            return restore_multi_backup(document,selection,{},fingerprint,1)
    with engine.connect() as writer:
        transaction = writer.begin()
        writer.execute(text("UPDATE daily_records SET actual_hours=9 WHERE record_date='2026-06-03'"))
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(restore)
            try:
                waiting = 0
                deadline = time.monotonic()+5
                with engine.connect() as inspector:
                    while time.monotonic() < deadline:
                        waiting = inspector.execute(text('SELECT COUNT(*) FROM performance_schema.data_lock_waits')).scalar()
                        if waiting: break
                        time.sleep(.05)
                assert waiting > 0
            finally:
                transaction.commit()
            with pytest.raises(BackupTargetChanged):
                future.result(15)
    assert [r.actual_hours for r in DailyRecord.query.order_by(DailyRecord.record_date)] == [9,1]
    assert AccountSetBackupRestore.query.one().counts['status'] == 'failed'
