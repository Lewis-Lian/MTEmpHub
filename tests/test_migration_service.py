import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import create_engine, event, text
from sqlalchemy.dialects import mysql

import app as _app_module  # noqa: F401
from services.migration_service import migrate_sqlite_to_mysql


class MigrationServiceTests(unittest.TestCase):
    def test_sqlite_to_mysql_migrates_setting_with_reserved_key_column(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source_url = f"sqlite:///{Path(tmpdir) / 'source.db'}"
            target_url = f"sqlite:///{Path(tmpdir) / 'target.db'}"
            source = create_engine(source_url)
            with source.begin() as connection:
                connection.execute(text('CREATE TABLE system_settings (id INTEGER PRIMARY KEY, "key" TEXT, value TEXT)'))
                connection.execute(text("INSERT INTO system_settings VALUES (1, 'manager_attendance_source', 'dingtalk')"))
                connection.execute(text('''CREATE TABLE monthly_reference_snapshots (
                    id INTEGER PRIMARY KEY, month TEXT, kind TEXT, business_key TEXT,
                    payload TEXT, provenance TEXT, quality TEXT, schema_version INTEGER,
                    created_at DATETIME, updated_at DATETIME)'''))
                connection.execute(text('''INSERT INTO monthly_reference_snapshots VALUES
                    (9, '2026-06', 'employee', 'E1', '{"name":"History"}',
                     '{"source":"archive"}', 'verified', 1, '2026-06-01', '2026-06-01')'''))
            source.dispose()

            read_db, write_db = SQLAlchemy(), SQLAlchemy()
            init_target = write_db.init_app

            def init_mysql_target(app):
                init_target(app)
                with app.app_context():
                    # Execute the transfer locally, using MySQL identifier rules
                    # and rejecting the unquoted reserved word as MySQL does.
                    write_db.engine.dialect.identifier_preparer = mysql.dialect().identifier_preparer

                    @event.listens_for(write_db.engine, "before_cursor_execute", retval=True)
                    def mysql_sql_boundary(connection, cursor, statement, parameters, context, executemany):
                        if statement.startswith("INSERT INTO") and "system_settings" in statement:
                            if "`key`" not in statement:
                                raise RuntimeError("MySQL rejects the unquoted reserved column key")
                        if statement.startswith("ALTER TABLE") and "AUTO_INCREMENT" in statement:
                            return "SELECT 1", ()
                        return statement, parameters

            with patch("flask_sqlalchemy.SQLAlchemy", side_effect=[read_db, write_db]), patch.object(
                write_db, "init_app", side_effect=init_mysql_target
            ), patch("flask_migrate.stamp"):
                results = migrate_sqlite_to_mysql(source_url, target_url)

            self.assertIn({"table": "system_settings", "rows": 1, "status": "ok"}, results)
            self.assertIn({"table": "monthly_reference_snapshots", "rows": 1, "status": "ok"}, results)
            target = create_engine(target_url)
            with target.connect() as connection:
                self.assertEqual(
                    connection.execute(text('SELECT "key", value FROM system_settings')).one(),
                    ("manager_attendance_source", "dingtalk"),
                )
                self.assertEqual(connection.execute(text(
                    'SELECT business_key, payload, quality FROM monthly_reference_snapshots')).one(),
                    ('E1', '{"name":"History"}', 'verified'))
            target.dispose()


def test_followup_business_rows_and_cursor_survive_whole_database_transfer(tmp_path):
    """Use the real transfer path on isolated SQLite, without a live MySQL."""
    from datetime import date
    from models import db
    from models.account_set import AccountSet
    from models.employee import Employee
    from models.meal_ticket import (MealTicketBatch, MealTicketItem, MealTicketPayment,
                                   MealTicketFollowupTask, MealTicketFollowupAllocation)
    from services.migration_service import migrate_mysql_to_sqlite
    source_url = 'sqlite:///' + str(tmp_path/'followup-source.db')
    target_url = 'sqlite:///' + str(tmp_path/'followup-target.db')
    source = create_engine(source_url)
    db.metadata.create_all(source)
    with source.begin() as conn:
        conn.execute(AccountSet.__table__.insert(), dict(id=11, month='2026-06', name='六月'))
        conn.execute(Employee.__table__.insert(), dict(id=12, emp_no='00123', name='甲'))
        conn.execute(MealTicketBatch.__table__.insert(), dict(id=13, key='b'*32, account_set_id=11,
            month='2026-06', recharge_month='2026-07', source_digest='x', created_by='admin', status='confirmed',
            followup_state={'current_task_key':'t'*32, 'skip_sequence':3}))
        conn.execute(MealTicketItem.__table__.insert(), dict(id=14, key='i'*32, batch_key='b'*32,
            month='2026-06', emp_id=12, emp_no_snapshot='00123', name='甲', dept_name='',
            is_manager=False, days=1, base_cents=800, source={}))
        conn.execute(MealTicketPayment.__table__.insert(), dict(id=15, key='p'*32, item_key='i'*32,
            month='2026-06', kind='recharge', amount_cents=1000, payment_date=date(2026,7,2),
            reference='到账', operator='admin', request_key='payment', request_digest='x'))
        conn.execute(MealTicketFollowupTask.__table__.insert(), dict(id=16, key='t'*32, item_key='i'*32,
            batch_key='b'*32, month='2026-06', kind='recharge', amount_cents=2400, status='partial',
            offset_enabled=False, skip_order=3, source_snapshot={}, operator='admin'))
        conn.execute(MealTicketFollowupAllocation.__table__.insert(), dict(id=17, key='a'*32,
            task_key='t'*32, payment_key='p'*32, month='2026-06', amount_cents=1000, operator='admin'))
    source.dispose()
    results = migrate_mysql_to_sqlite(source_url, target_url)
    assert {'table':'meal_ticket_followup_tasks', 'rows':1, 'status':'ok'} in results
    assert {'table':'meal_ticket_followup_allocations', 'rows':1, 'status':'ok'} in results
    target = create_engine(target_url)
    with target.connect() as conn:
        assert conn.execute(text('SELECT amount_cents, status, skip_order FROM meal_ticket_followup_tasks')).one() == (2400,'partial',3)
        assert conn.execute(text('SELECT amount_cents FROM meal_ticket_payments')).scalar() == 1000
        assert conn.execute(text('SELECT task_key, payment_key FROM meal_ticket_followup_allocations')).one() == ('t'*32,'p'*32)
        import json
        assert json.loads(conn.execute(text('SELECT followup_state FROM meal_ticket_batches')).scalar())['current_task_key'] == 't'*32
    target.dispose()
