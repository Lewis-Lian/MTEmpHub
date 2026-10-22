"""All card funds must have exactly one unchanged, active local destination."""
from datetime import date, datetime
from decimal import Decimal
from unittest.mock import patch
import unittest

from models import db
from models.meal_ticket import MealTicketBatch, MealTicketPayment
from models.meal_guest_card import MealGuestCard, MealGuestRecharge
from models.meal_ledger import MealLedgerRecord
from services.card_db_client import CardDBClientError
from services.meal_ticket_service import digest
from tests import test_meal_ticket_reconciliation as reconciliation_tests


class MealFundsAuditTests(unittest.TestCase):
    setUp = reconciliation_tests.MealReconciliationTests.setUp
    tearDown = reconciliation_tests.MealReconciliationTests.tearDown
    post = reconciliation_tests.MealReconciliationTests.post
    generate = reconciliation_tests.MealReconciliationTests.generate
    confirm = reconciliation_tests.MealReconciliationTests.confirm
    enable = reconciliation_tests.MealReconciliationTests.enable
    reconcile = reconciliation_tests.MealReconciliationTests.reconcile
    records = reconciliation_tests.MealReconciliationTests.records

    def row(self, source='recharge', identifier=20, emp_no='UNKNOWN', amount='25', time=None):
        return dict(source=source, id=identifier, emp_no=emp_no,
                    amount=Decimal(amount), time=time or datetime(2026, 9, 20, 12))

    def identity(self, row):
        database_id = digest({'host':'192.0.2.10', 'port':1433, 'database':'STCard_Test'})[:24]
        key = f'card-meal:{database_id}:{row["source"]}:{row["id"]}'
        content = digest({'source':row['source'], 'id':row['id'], 'emp_no':row['emp_no'],
                          'time':row['time'].isoformat(), 'amount_cents':int(row['amount'] * 100)})
        return key, content

    def audit(self, rows, **body):
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=rows):
            return self.post('/funds-audit', {'start_date':'2026-09-01', 'end_date':'2026-09-30', **body})

    def guest(self, row, voided=False):
        key, content = self.identity(row)
        card = MealGuestCard.query.filter_by(emp_no=row['emp_no']).first()
        if not card:
            card = MealGuestCard(card_no='card-' + row['emp_no'], emp_no=row['emp_no'], name='客人卡', operator='admin')
            db.session.add(card)
            db.session.flush()
        record = MealLedgerRecord(kind='external', month='2026-09', record_date=row['time'].date(),
            amount_cents=int(row['amount'] * 100), data={'emp_no':row['emp_no'], 'category':'card',
                'guest_card_key':card.key, 'card_no':card.card_no, 'name':'访客'}, request_key='visit-' + key,
            request_digest='visit', operator='admin', voided=voided)
        db.session.add(record)
        db.session.flush()
        matched = MealGuestRecharge(month='2026-09', record_key=record.key, source_key=key,
            source_digest=content, amount_cents=record.amount_cents, occurred_at=row['time'], operator='admin')
        db.session.add(matched)
        return matched

    def test_no_batch_still_lists_all_unknown_funds_and_deduplicates_archive(self):
        self.enable()
        rows = [self.row('subsidy', 1, amount='100'), self.row(amount='25'), self.row('refund', 3, amount='8')]
        result = self.audit(rows + rows[:1])
        self.assertEqual(result.status_code, 200, result.get_json())
        report = result.get_json()
        self.assertFalse(report['complete'])
        self.assertEqual(report['database_net_cents'], 11700)
        self.assertEqual(report['recorded_net_cents'], 0)
        self.assertEqual([(r['source'], r['database_count'], r['database_cents']) for r in report['sources']],
                         [('subsidy', 1, 10000), ('recharge', 1, 2500), ('refund', 1, 800)])
        self.assertEqual([r['status'] for r in report['issues']], ['unassigned'] * 3)
        self.assertEqual({r['emp_no'] for r in report['issues']}, {'UNKNOWN'})
        with self.app.app_context():
            self.assertEqual(MealTicketPayment.query.count(), 0)
            self.assertEqual(MealTicketBatch.query.count(), 0)

    def test_employee_settled_then_unknown_recharge_remains_unassigned_without_mutation(self):
        self.enable()
        batch = self.confirm(self.generate())
        rows = self.records()
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=rows):
            settled = self.reconcile(batch).get_json()
        self.assertEqual(settled['items'][0]['difference'], 0)
        report = self.audit(rows + [self.row()]).get_json()
        self.assertFalse(report['complete'])
        self.assertEqual(report['recorded_net_cents'], 17600)
        self.assertEqual(report['database_net_cents'], 20100)
        self.assertEqual([(r['status'], r['amount_cents']) for r in report['issues']], [('unassigned', 2500)])
        with self.app.app_context():
            saved = db.session.get(MealTicketBatch, settled['id'])
            self.assertEqual(saved.version, settled['version'])
            self.assertEqual(saved.reconciliation, settled['reconciliation'])
            self.assertEqual(MealTicketPayment.query.count(), 3)

    def test_employee_guest_and_clearance_all_count_once_with_gross_totals(self):
        self.enable()
        batch = self.confirm(self.generate())
        rows = self.records() + [self.row(amount='25'), self.row('refund', 21, 'OTHER', '50')]
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=rows):
            result = self.reconcile(batch, refund_actions={'12':'refund', '21':'clearance'})
            self.assertEqual(result.status_code, 200, result.get_json())
        with self.app.app_context():
            self.guest(rows[3])
            db.session.commit()
        report = self.audit(rows).get_json()
        self.assertTrue(report['complete'])
        self.assertEqual(report['issues'], [])
        self.assertEqual(report['database_net_cents'], 15100)
        self.assertEqual(report['recorded_net_cents'], 15100)
        recharge = report['sources'][1]
        self.assertEqual((recharge['database_cents'], recharge['recorded_cents']), (4900, 4900))
        self.assertEqual((recharge['employee_cents'], recharge['guest_cents']), (2400, 2500))
        self.assertEqual(report['sources'][2]['clearance_cents'], 5000)

    def test_changed_and_missing_posted_sources_are_issues_even_when_net_totals_balance(self):
        self.enable()
        batch = self.confirm(self.generate())
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.records()):
            self.reconcile(batch)
        changed = self.records()
        changed[0]['amount'] = Decimal('168')
        changed[1]['amount'] = Decimal('16')
        report = self.audit(changed).get_json()
        self.assertFalse(report['complete'])
        self.assertEqual(report['database_net_cents'], report['recorded_net_cents'])
        self.assertEqual([r['status'] for r in report['issues']], ['changed', 'changed'])
        missing = self.audit(self.records()[1:]).get_json()
        self.assertEqual([r['status'] for r in missing['issues']], ['missing'])
        self.assertEqual(missing['issues'][0]['recorded_cents'], 16000)

    def test_duplicate_owner_and_voided_guest_never_count_as_verified(self):
        self.enable()
        batch = self.confirm(self.generate())
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.records()):
            self.reconcile(batch)
        with self.app.app_context():
            self.guest(self.records()[1])
            db.session.commit()
        report = self.audit(self.records()).get_json()
        self.assertFalse(report['complete'])
        self.assertEqual([r['status'] for r in report['issues']], ['duplicate'])
        with self.app.app_context():
            MealGuestRecharge.query.delete()
            MealLedgerRecord.query.filter_by(kind='external').delete()
            self.guest(self.row(), voided=True)
            db.session.commit()
        report = self.audit(self.records() + [self.row()]).get_json()
        self.assertEqual([r['status'] for r in report['issues']], ['invalid'])
        self.assertFalse(report['complete'])

    def test_other_month_subsidy_in_selected_range_is_not_ignored(self):
        self.enable()
        report = self.audit([self.row('subsidy', 50, amount='176', time=datetime(2026,10,1))],
                            end_date='2026-10-02').get_json()
        self.assertEqual(report['sources'][0]['database_cents'], 17600)
        self.assertEqual(len(report['issues']), 1)
        self.assertFalse(report['complete'])

    def test_posted_identity_or_amount_change_is_detected_even_with_old_digest(self):
        self.enable()
        batch = self.confirm(self.generate())
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.records()):
            self.reconcile(batch)
        with self.app.app_context():
            payment = MealTicketPayment.query.filter_by(amount_cents=16000).one()
            payment.amount_cents = 15900
            db.session.commit()
        report = self.audit(self.records()).get_json()
        self.assertEqual([r['status'] for r in report['issues']], ['changed'])
        self.assertEqual(report['recorded_net_cents'], 17500)
        with self.app.app_context():
            payment = MealTicketPayment.query.filter_by(amount_cents=15900).one()
            payment.amount_cents = 16000
            payment.payment_date = date(2026, 10, 1)
            db.session.commit()
        report = self.audit(self.records()).get_json()
        self.assertEqual([r['status'] for r in report['issues']], ['changed'])
        self.assertFalse(report['complete'])

    def test_missing_guest_and_voided_clearance_are_included_in_the_same_audit(self):
        self.enable()
        batch = self.confirm(self.generate())
        rows = self.records()
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=rows):
            self.reconcile(batch, refund_actions={'12':'clearance'})
        with self.app.app_context():
            self.guest(self.row())
            MealLedgerRecord.query.filter_by(kind='clearance').one().voided = True
            db.session.commit()
        report = self.audit(rows).get_json()
        self.assertEqual({r['status'] for r in report['issues']}, {'missing', 'invalid'})
        self.assertFalse(report['complete'])

    def test_fully_reversed_manual_history_does_not_duplicate_current_database_funds(self):
        batch = self.confirm(self.generate())
        batch = self.post('/payments', {'batch_id':batch['id'], 'version':batch['version'],
            'item_id':batch['items'][0]['id'], 'kind':'recharge', 'amount':'176', 'date':'2026-09-04',
            'reference':'误登记', 'request_key':'manual'}).get_json()
        payment_id = batch['items'][0]['payments'][0]['id']
        batch = self.post('/payments', {'batch_id':batch['id'], 'version':batch['version'],
            'item_id':batch['items'][0]['id'], 'kind':'reversal', 'reversal_id':payment_id,
            'amount':'176', 'date':'2026-09-04', 'reference':'撤销误登记', 'request_key':'cancel'}).get_json()
        self.enable()
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.records()):
            self.reconcile(batch)
        report = self.audit(self.records()).get_json()
        self.assertTrue(report['complete'])
        self.assertEqual(report['recorded_net_cents'], 17600)

    def test_zero_funds_are_counted_and_database_switch_cannot_reuse_old_certification(self):
        from models.system_setting import SystemSetting
        self.enable()
        batch = self.confirm(self.generate())
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.records()):
            self.reconcile(batch)
        response = self.audit(self.records() + [self.row(amount='0')])
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertTrue(response.get_json()['complete'])
        self.assertEqual(response.get_json()['sources'][1]['database_count'], 2)
        with self.app.app_context():
            SystemSetting.set_value('card_db_host', '192.0.2.11')
            db.session.commit()
        self.assertFalse(self.audit(self.records()).get_json()['complete'])

    def test_guest_reference_identity_and_total_allocation_must_remain_valid(self):
        self.enable()
        with self.app.app_context():
            self.guest(self.row())
            db.session.commit()
        for changes in ({'guest_card_key':'missing-card'}, {'emp_no':'OTHER'}, {'card_no':'OTHER'}):
            with self.app.app_context():
                record = MealLedgerRecord.query.filter_by(kind='external').one()
                original = dict(record.data)
                record.data = {**original, **changes}
                db.session.commit()
            report = self.audit([self.row()]).get_json()
            self.assertFalse(report['complete'])
            self.assertEqual(report['issues'][0]['status'], 'invalid')
            self.assertEqual(report['recorded_net_cents'], 2500)
            with self.app.app_context():
                record = MealLedgerRecord.query.filter_by(kind='external').one()
                record.data = original
                db.session.commit()
        with self.app.app_context():
            MealLedgerRecord.query.filter_by(kind='external').one().amount_cents = 1
            db.session.commit()
        self.assertFalse(self.audit([self.row()]).get_json()['complete'])

    def test_local_evidence_reads_hold_one_sqlite_snapshot(self):
        import sqlite3
        from sqlalchemy import event
        self.enable()
        batch = self.confirm(self.generate())
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.records()):
            self.reconcile(batch)
        blocked = []
        def try_concurrent_write(conn, cursor, statement, parameters, context, executemany):
            if blocked or 'FROM meal_ticket_items' not in statement:
                return
            writer = sqlite3.connect(self.tmp.name + '/test.db', timeout=0)
            try:
                writer.execute('UPDATE meal_ticket_payments SET amount_cents=16100 WHERE amount_cents=16000')
                writer.commit()
                blocked.append(False)
            except sqlite3.OperationalError as exc:
                self.assertIn('locked', str(exc))
                blocked.append(True)
            finally:
                writer.close()
        with self.app.app_context():
            engine = db.engine
            event.listen(engine, 'before_cursor_execute', try_concurrent_write)
            try:
                report = self.audit(self.records()).get_json()
            finally:
                event.remove(engine, 'before_cursor_execute', try_concurrent_write)
                db.session.rollback()
        self.assertEqual(blocked, [True])
        self.assertTrue(report['complete'])

    def test_manual_card_funds_are_unlinked_but_paper_is_not_card_database_money(self):
        self.enable()
        with self.app.app_context():
            for category in ('card', 'paper'):
                db.session.add(MealLedgerRecord(kind='external', month='2026-09', record_date=date(2026,9,2),
                    amount_cents=1000, data={'category':category,'emp_no':'X'}, request_key=category,
                    request_digest=category, operator='admin'))
            db.session.commit()
        report = self.audit([]).get_json()
        self.assertFalse(report['complete'])
        self.assertEqual(len(report['issues']), 1)
        self.assertEqual(report['issues'][0]['status'], 'unlinked')
        self.assertEqual(report['issues'][0]['recorded_cents'], 1000)

    def test_conflicting_archive_duplicate_invalid_row_and_offline_never_produce_success(self):
        self.enable()
        row = self.row()
        for rows in ([row, {**row, 'amount':Decimal('26')}], [{**row, 'amount':Decimal('-1')}],
                     [{**row, 'source':'unexpected'}], [{**row,'emp_no':None}]):
            self.assertEqual(self.audit(rows).status_code, 409)
        with patch('services.card_db_client.CardDBClient.meal_records', side_effect=CardDBClientError('offline')):
            self.assertEqual(self.post('/funds-audit', {'start_date':'2026-09-01', 'end_date':'2026-09-30'}).status_code, 502)

    def test_admin_only_valid_range_enabled_database_and_no_stored_certification(self):
        body = {'start_date':'2026-09-01', 'end_date':'2026-09-30'}
        self.assertEqual(self.post('/funds-audit', body).status_code, 409)
        self.enable()
        for invalid in ({'start_date':None}, {'end_date':'2026-08-31'}, {'end_date':'9999-12-31'}):
            self.assertEqual(self.audit([], **invalid).status_code, 400)
        response = self.client.post('/api/meal-tickets/funds-audit', json=body,
            headers={'Authorization':'Bearer ' + self.viewer_token})
        self.assertEqual(response.status_code, 403)
        self.assertTrue(self.audit([]).get_json()['complete'])
        self.assertFalse(self.audit([self.row()]).get_json()['complete'])

