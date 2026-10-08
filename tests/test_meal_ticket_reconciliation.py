from datetime import datetime
from decimal import Decimal
from unittest.mock import patch

from models import db
from models.system_setting import SystemSetting
from services.card_db_client import CardDBClientError
import unittest
from tests import test_meal_tickets as meal_tests


class MealReconciliationTests(unittest.TestCase):
    setUp = meal_tests.MealTicketTests.setUp
    tearDown = meal_tests.MealTicketTests.tearDown
    post = meal_tests.MealTicketTests.post
    generate = meal_tests.MealTicketTests.generate
    confirm = meal_tests.MealTicketTests.confirm
    def enable(self):
        with self.app.app_context():
            for key, value in {'meal_ticket_db_enabled':'true', 'card_db_host':'192.0.2.10',
                    'card_db_database':'STCard_Test', 'card_db_user':'reader', 'card_db_password':'secret'}.items():
                SystemSetting.set_value(key, value)
            db.session.commit()

    def records(self):
        return [
            {'source':'subsidy', 'id':10, 'emp_no':'001', 'time':datetime(2026,9,4), 'amount':Decimal('160.00')},
            {'source':'recharge', 'id':11, 'emp_no':'001', 'time':datetime(2026,9,10,12), 'amount':Decimal('24.00')},
            {'source':'refund', 'id':12, 'emp_no':'001', 'time':datetime(2026,9,30,23,59), 'amount':Decimal('8.00')},
        ]

    def reconcile(self, batch, **kwargs):
        return self.post('/reconcile', {'batch_id':batch['id'], 'version':batch['version'],
            'start_date':'2026-09-01', 'end_date':'2026-09-30', **kwargs})

    def test_three_ledgers_settle_actual_amount_and_repeat_is_idempotent(self):
        self.enable()
        batch=self.confirm(self.generate())
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.records()):
            response=self.reconcile(batch)
            self.assertEqual(response.status_code,200,response.get_json())
            result=response.get_json()
            self.assertEqual(result['items'][0]['paid_amount'],176)
            self.assertEqual(result['items'][0]['difference'],0)
            self.assertEqual([p['amount'] for p in result['items'][0]['payments']],[160,24,-8])
            self.assertTrue(all(p['database_record'] for p in result['items'][0]['payments']))
            self.assertEqual(result['reconciliation']['added'],3)
            again=self.reconcile(result)
            self.assertEqual(again.status_code,200,again.get_json())
            self.assertEqual(again.get_json()['reconciliation']['added'],0)
            self.assertEqual(again.get_json()['version'],result['version'])
            self.assertEqual(len(again.get_json()['items'][0]['payments']),3)
        refreshed=self.client.get('/api/meal-tickets?recharge_month=2026-09',headers=self.headers).get_json()
        self.assertEqual(refreshed['items'][0]['difference'],0)

    def test_overpayment_is_truthful_and_archive_duplicates_only_count_once(self):
        self.enable()
        batch=self.confirm(self.generate())
        records=self.records()[:2]+[self.records()[0],
            {'source':'recharge','id':13,'emp_no':'999','time':datetime(2026,9,10),'amount':Decimal('8')},
            {'source':'subsidy','id':14,'emp_no':'002','time':datetime(2026,9,4),'amount':Decimal('0')}]
        with patch('services.card_db_client.CardDBClient.meal_records',return_value=records):
            result=self.reconcile(batch).get_json()
        self.assertEqual(result['items'][0]['paid_amount'],184)
        self.assertEqual(result['items'][0]['difference'],-8)
        self.assertEqual(result['reconciliation']['unmatched'],1)
        self.assertEqual(result['reconciliation']['zero_amount'],1)
        self.assertEqual(len(result['items'][0]['payments']),2)
        payment=result['items'][0]['payments'][0]
        rejected=self.post('/payments',{'batch_id':result['id'],'version':result['version'],
            'item_id':result['items'][0]['id'],'kind':'reversal','reversal_id':payment['id'],
            'amount':'160','date':'2026-09-04','reference':'不能改实际流水','request_key':'remote-reversal'})
        self.assertEqual(rejected.status_code,409)

    def test_query_failure_and_changed_remote_record_leave_accounts_unchanged(self):
        self.enable()
        batch=self.confirm(self.generate())
        with patch('services.card_db_client.CardDBClient.meal_records',side_effect=CardDBClientError('query failed')):
            self.assertEqual(self.reconcile(batch).status_code,502)
        with patch('services.card_db_client.CardDBClient.meal_records',return_value=self.records()):
            batch=self.reconcile(batch).get_json()
        changed=self.records()
        changed[0]['amount']=Decimal('168')
        with patch('services.card_db_client.CardDBClient.meal_records',return_value=changed):
            self.assertEqual(self.reconcile(batch).status_code,409)
        refreshed=self.client.get('/api/meal-tickets?recharge_month=2026-09',headers=self.headers).get_json()
        self.assertEqual(refreshed['items'][0]['paid_amount'],176)
        self.assertEqual(refreshed['version'],batch['version'])

    def test_disabled_draft_stale_manual_and_invalid_range_cannot_import(self):
        batch=self.generate()
        self.assertEqual(self.reconcile(batch).status_code,409)
        self.enable()
        self.assertEqual(self.reconcile(batch).status_code,409)
        batch=self.confirm(batch)
        with patch('services.card_db_client.CardDBClient.meal_records',return_value=self.records()):
            self.assertEqual(self.reconcile(batch,version=1).status_code,409)
            self.assertEqual(self.reconcile(batch,end_date='2026-08-31').status_code,400)
            self.assertEqual(self.reconcile(batch,start_date='2026-08-01').status_code,400)
        batch=self.post('/payments',{'batch_id':batch['id'],'version':batch['version'],
            'item_id':batch['items'][0]['id'],'kind':'recharge','amount':'8','date':'2026-09-04',
            'reference':'手工登记','request_key':'manual-first'}).get_json()
        with patch('services.card_db_client.CardDBClient.meal_records',return_value=self.records()):
            self.assertEqual(self.reconcile(batch).status_code,409)
        viewer={'Authorization':'Bearer '+self.viewer_token}
        response=self.client.post('/api/meal-tickets/reconcile',json={'batch_id':batch['id'],'version':batch['version']},headers=viewer)
        self.assertEqual(response.status_code,403)

    def test_deleted_posted_record_is_not_silently_treated_as_verified(self):
        self.enable()
        batch=self.confirm(self.generate())
        with patch('services.card_db_client.CardDBClient.meal_records',return_value=self.records()):
            batch=self.reconcile(batch).get_json()
        with patch('services.card_db_client.CardDBClient.meal_records',return_value=self.records()[1:]):
            self.assertEqual(self.reconcile(batch).status_code,409)

    def test_extended_range_includes_late_topup_but_not_next_month_subsidy(self):
        self.enable()
        batch=self.confirm(self.generate())
        records=self.records()[:1]+[
            {'source':'subsidy','id':100,'emp_no':'001','time':datetime(2026,10,4),'amount':Decimal('176')},
            {'source':'recharge','id':101,'emp_no':'001','time':datetime(2026,10,6),'amount':Decimal('16')}]
        with patch('services.card_db_client.CardDBClient.meal_records',return_value=records):
            response=self.reconcile(batch,end_date='2026-10-06')
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual(response.get_json()['items'][0]['paid_amount'],176)
        self.assertEqual(response.get_json()['reconciliation']['outside_subsidy_month'],1)

    def test_manual_request_cannot_impersonate_a_database_record(self):
        batch=self.confirm(self.generate())
        response=self.post('/payments',{'batch_id':batch['id'],'version':batch['version'],
            'item_id':batch['items'][0]['id'],'kind':'recharge','amount':'8','date':'2026-09-04',
            'reference':'manual','request_key':'card-meal:forged'})
        self.assertEqual(response.status_code,400)

    def test_remote_record_changed_to_zero_or_unmatched_cannot_leave_stale_paid_amount(self):
        self.enable()
        batch=self.confirm(self.generate())
        with patch('services.card_db_client.CardDBClient.meal_records',return_value=self.records()):
            batch=self.reconcile(batch).get_json()
        for changes in ({'amount':Decimal('0')},{'emp_no':'999'}):
            changed=self.records()
            changed[0].update(changes)
            with patch('services.card_db_client.CardDBClient.meal_records',return_value=changed):
                self.assertEqual(self.reconcile(batch).status_code,409)

    def test_connection_change_cannot_double_import_from_another_database(self):
        self.enable()
        batch=self.confirm(self.generate())
        with patch('services.card_db_client.CardDBClient.meal_records',return_value=self.records()):
            batch=self.reconcile(batch).get_json()
            with self.app.app_context():
                SystemSetting.set_value('card_db_host','192.0.2.11')
                db.session.commit()
            self.assertEqual(self.reconcile(batch).status_code,409)

    def test_database_managed_batch_rejects_manual_payment_even_if_switch_is_disabled(self):
        self.enable()
        batch=self.confirm(self.generate())
        with patch('services.card_db_client.CardDBClient.meal_records',return_value=self.records()[:1]):
            batch=self.reconcile(batch).get_json()
        with self.app.app_context():
            SystemSetting.set_value('meal_ticket_db_enabled','false')
            db.session.commit()
        response=self.post('/payments',{'batch_id':batch['id'],'version':batch['version'],
            'item_id':batch['items'][0]['id'],'kind':'recharge','amount':'16','date':'2026-09-10',
            'reference':'manual','request_key':'manual-after-db'})
        self.assertEqual(response.status_code,409)
