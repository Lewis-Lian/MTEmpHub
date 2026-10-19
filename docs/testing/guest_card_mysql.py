"""Explicit MySQL concurrency acceptance in a disposable schema.

MTE_GUEST_MYSQL_ACCEPTANCE=1 .venv-mac2/bin/python -m pytest docs/testing/guest_card_mysql.py -q
Uses the configured MySQL server, creates a random temporary database, drops it
in finally, and never writes to the configured business database.
"""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from threading import Event
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy import create_engine, event, text

from app import create_app
from models import db
from models.account_set import AccountSet
from models.employee import Employee
from models.meal_guest_card import MealGuestCard, MealGuestRecharge
from models.meal_ledger import MealLedgerRecord
from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketPayment
from models.system_setting import SystemSetting
from services.meal_guest_card_service import check_recharge
from services.meal_ticket_service import MealError, digest


@pytest.mark.skipif(os.getenv('MTE_GUEST_MYSQL_ACCEPTANCE') != '1', reason='explicit isolated MySQL acceptance only')
def test_waiting_guest_sees_employee_source_committed_under_account_lock():
    source = create_app()
    with source.app_context():
        url = db.engine.url
    assert url.drivername.startswith('mysql'), 'MySQL required'
    admin = create_engine(url, isolation_level='AUTOCOMMIT')
    schema = 'mtemphub_guest_check_' + uuid.uuid4().hex
    with admin.connect() as conn:
        conn.execute(text('CREATE DATABASE ' + schema + ' CHARACTER SET utf8mb4'))
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI=url.set(database=schema),SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    target_engine = None
    try:
        with app.app_context():
            db.create_all()
            target_engine = db.engine
            card = MealGuestCard(card_no='0099',emp_no='G001',name='Synthetic guest',operator='test')
            account = AccountSet(month='2026-08',name='test')
            employee = Employee(emp_no='G001',name='test')
            db.session.add_all([card,account,employee]); db.session.flush()
            record = MealLedgerRecord(kind='external',month='2026-09',record_date=date(2026,9,30),
                amount_cents=10000,data={'guest_card_key':card.key,'emp_no':'G001','card_no':'0099','name':'Visitor','category':'card'},
                request_key='guest',request_digest='a'*64,operator='test')
            batch = MealTicketBatch(account_set_id=account.id,month='2026-08',recharge_month='2026-09',
                status='confirmed',rate_cents=800,source_digest='a'*64,created_by='test')
            db.session.add_all([record,batch]);db.session.flush()
            item = MealTicketItem(batch_key=batch.key,month='2026-08',emp_id=employee.id,emp_no_snapshot='G001',
                name='test',dept_name='test',is_manager=False,days=1,base_cents=10000,source={},error='')
            db.session.add(item)
            for key,value in {'meal_ticket_db_enabled':'true','card_db_host':'synthetic','card_db_database':'card',
                              'card_db_user':'test','card_db_password':'test'}.items():
                SystemSetting.set_value(key,value)
            db.session.commit()
            record_id,card_key,item_key = record.id,card.key,item.key
        source_key = 'card-meal:' + digest({'host':'synthetic','port':1433,'database':'card'})[:24] + ':recharge:17'
        row = dict(source='recharge',id=17,emp_no='G001',time=datetime(2026,9,30,10),amount='100')
        waiting = Event()
        def observe(conn,cursor,statement,parameters,context,executemany):
            if 'FROM meal_guest_cards' in statement and 'FOR UPDATE' in statement:
                waiting.set()
        event.listen(target_engine,'before_cursor_execute',observe)
        def guest():
            with app.app_context():
                try:
                    check_recharge(record_id,{'end_date':'2026-09-30','source_keys':[source_key]},'test')
                    db.session.commit()
                    return 200
                except MealError as error:
                    db.session.rollback()
                    return error.status
                finally:
                    db.session.remove()
        # Staff writer owns the account lock first. The guest waits while the
        # staff transaction commits a payment that was absent at guest startup.
        with target_engine.connect() as staff:
            staff.execute(text('SELECT `key` FROM meal_guest_cards WHERE `key`=:key FOR UPDATE'),{'key':card_key})
            waiting.clear()
            with patch('services.meal_guest_card_service.CardDBClient.meal_records',return_value=[row]), ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(guest)
                assert waiting.wait(10), 'Guest did not reach account lock'
                staff.execute(MealTicketPayment.__table__.insert().values(key='p'*32,item_key=item_key,month='2026-08',
                    kind='recharge',amount_cents=10000,payment_date=date(2026,9,30),reference='test',operator='test',
                    request_key=source_key,request_digest='b'*64))
                staff.commit()
                assert pending.result(timeout=15) == 409
        event.remove(target_engine,'before_cursor_execute',observe)
        with app.app_context():
            assert MealGuestRecharge.query.count() == 0
            assert MealTicketPayment.query.count() == 1
            db.session.remove()
    finally:
        if target_engine:
            target_engine.dispose()
        with admin.connect() as conn:
            conn.execute(text('DROP DATABASE ' + schema))
        admin.dispose()
