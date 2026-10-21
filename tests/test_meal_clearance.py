"""Clearance can be confirmed directly without a monthly employee batch."""
import unittest
from datetime import datetime
from decimal import Decimal
from unittest.mock import patch

from models import db
from models.meal_ledger import MealLedgerRecord
from models.meal_ticket import MealTicketPayment
from services.card_db_client import CardDBClientError
from tests import test_meal_tickets as meal_tests
from tests import test_meal_ticket_reconciliation as reconciliation_tests


class MealClearanceTests(unittest.TestCase):
    setUp = meal_tests.MealTicketTests.setUp
    tearDown = meal_tests.MealTicketTests.tearDown
    enable = reconciliation_tests.MealReconciliationTests.enable
    generate = meal_tests.MealTicketTests.generate
    confirm = meal_tests.MealTicketTests.confirm
    post = meal_tests.MealTicketTests.post

    def rows(self):
        return [{'source':'refund', 'id':12, 'emp_no':'001',
                 'time':datetime(2026,9,30,23,59), 'amount':Decimal('20')}]

    def call(self, action, **values):
        return self.client.post('/api/meal-ledgers/clearance/' + action, headers=self.headers,
            json={'month':'2026-09', 'start_date':'2026-09-01', 'end_date':'2026-09-30', **values})

    def preview(self):
        response = self.call('preview')
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json()

    def apply(self, preview, **values):
        return self.call('confirm', source_digest=preview['source_digest'],
            source_keys=[row['source_key'] for row in preview['rows']], **values)

    def test_preview_is_readonly_and_confirm_is_idempotent_without_batch(self):
        self.enable()
        rows = self.rows()
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=rows + rows):
            preview = self.preview()
            self.assertEqual(len(preview['rows']), 1)
            self.assertEqual(preview['rows'][0]['name'], '员工甲')
            self.assertEqual(preview['rows'][0]['status'], 'available')
            with self.app.app_context():
                self.assertEqual(MealLedgerRecord.query.count(), 0)
            response = self.apply(preview)
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(response.get_json()['added'], 1)
            repeated = self.apply(preview)
            self.assertEqual(repeated.status_code, 200, repeated.get_json())
            self.assertEqual(repeated.get_json()['added'], 0)
            self.assertEqual(repeated.get_json()['existing'], 1)
            self.assertEqual(self.preview()['rows'][0]['status'], 'registered')
        with self.app.app_context():
            self.assertEqual(MealLedgerRecord.query.one().amount_cents, 2000)
            self.assertEqual(MealTicketPayment.query.count(), 0)
        annual = self.client.get('/api/meal-ledgers/annual?year=2026', headers=self.headers).get_json()
        self.assertEqual(annual['months'][8]['recovered_amount'], 20)

    def test_changed_source_or_query_failure_leaves_ledger_untouched(self):
        self.enable()
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.rows()):
            preview = self.preview()
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=[{**self.rows()[0], 'amount':Decimal('21')}]):
            self.assertEqual(self.apply(preview).status_code, 409)
        with patch('services.card_db_client.CardDBClient.meal_records', side_effect=CardDBClientError('unavailable')):
            self.assertEqual(self.apply(preview).status_code, 502)
        with self.app.app_context():
            self.assertEqual(MealLedgerRecord.query.count(), 0)

    def test_existing_refund_cannot_be_reclassified_as_clearance(self):
        self.enable()
        batch = self.confirm(self.generate())
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.rows()):
            preview = self.preview()
            response = self.post('/reconcile', {'batch_id':batch['id'], 'version':batch['version'],
                'start_date':'2026-09-01', 'end_date':'2026-09-30', 'refund_actions':{'12':'refund'}})
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(self.preview()['rows'][0]['status'], 'refunded')
            self.assertEqual(self.apply(preview).status_code, 409)
        with self.app.app_context():
            self.assertEqual(MealLedgerRecord.query.count(), 0)

    def test_clearance_from_new_entry_is_seen_by_original_reconciliation(self):
        self.enable()
        batch = self.confirm(self.generate())
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.rows()):
            self.assertEqual(self.apply(self.preview()).status_code, 200)
            result = self.post('/reconcile', {'batch_id':batch['id'], 'version':batch['version'],
                'start_date':'2026-09-01', 'end_date':'2026-09-30', 'refund_actions':{'12':'clearance'}})
            self.assertEqual(result.status_code, 200, result.get_json())
            self.assertEqual(result.get_json()['reconciliation']['clearance_added'], 0)
            self.assertEqual(result.get_json()['items'][0]['paid_amount'], 0)
        with self.app.app_context():
            self.assertEqual(MealLedgerRecord.query.count(), 1)

    def test_manual_duplicate_and_voided_source_are_not_imported(self):
        self.enable()
        manual = self.client.post('/api/meal-ledgers/clearance', headers=self.headers, json={
            'month':'2026-09', 'date':'2026-09-30', 'emp_no':'001', 'name':'员工甲',
            'amount':20, 'request_key':'manual-clearance'})
        self.assertEqual(manual.status_code, 200)
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.rows()):
            preview = self.preview()
            self.assertEqual(preview['rows'][0]['status'], 'manual_conflict')
            self.assertEqual(self.apply(preview).status_code, 409)
        self.client.post('/api/meal-ledgers/records/' + str(manual.get_json()['id']) + '/void',
            headers=self.headers, json={'reason':'核实为同一笔，以数据库为准'})
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.rows()):
            imported = self.apply(self.preview())
            self.assertEqual(imported.status_code, 200, imported.get_json())
            record = next(row for row in self.client.get('/api/meal-ledgers/clearance?month=2026-09', headers=self.headers).get_json() if not row['voided'])
            self.client.post(f'/api/meal-ledgers/records/{record["id"]}/void', headers=self.headers, json={'reason':'更正'})
            preview = self.preview()
            self.assertEqual(preview['rows'][0]['status'], 'voided')
            self.assertEqual(self.apply(preview).status_code, 409)

    def test_two_distinct_same_amount_withdrawals_are_both_imported(self):
        self.enable()
        rows = self.rows() + [{**self.rows()[0], 'id':13}]
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=rows):
            result = self.apply(self.preview())
            self.assertEqual(result.status_code, 200, result.get_json())
            self.assertEqual(result.get_json()['added'], 2)
        with self.app.app_context():
            self.assertEqual(MealLedgerRecord.query.count(), 2)

    def test_validation_permissions_and_empty_selection(self):
        self.assertEqual(self.call('preview').status_code, 409)
        self.enable()
        for values in ({'end_date':'2026-10-01'}, {'start_date':'2026-08-31'}, {'start_date':'bad'}):
            self.assertEqual(self.call('preview', **values).status_code, 400)
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.rows()):
            self.assertEqual(self.call('confirm', source_keys=[], source_digest='unused').status_code, 400)
            response = self.client.post('/api/meal-ledgers/clearance/preview',
                headers={'Authorization':'Bearer ' + self.viewer_token}, json={'month':'2026-09'})
            self.assertEqual(response.status_code, 403)

    def test_manual_entry_cannot_repeat_an_imported_database_withdrawal(self):
        self.enable()
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.rows()):
            self.assertEqual(self.apply(self.preview()).status_code, 200)
        response = self.client.post('/api/meal-ledgers/clearance', headers=self.headers, json={
            'month':'2026-09', 'date':'2026-09-30', 'emp_no':'001', 'name':'员工甲',
            'amount':20, 'request_key':'duplicate-manual'})
        self.assertEqual(response.status_code, 409, response.get_json())
        with self.app.app_context():
            self.assertEqual(MealLedgerRecord.query.count(), 1)

    def test_batch_conflict_rolls_back_all_selected_withdrawals(self):
        self.enable()
        response = self.client.post('/api/meal-ledgers/clearance', headers=self.headers, json={
            'month':'2026-09', 'date':'2026-09-30', 'emp_no':'001', 'name':'员工甲',
            'amount':30, 'request_key':'manual-conflict'})
        self.assertEqual(response.status_code, 200)
        rows = self.rows() + [{**self.rows()[0], 'id':13, 'amount':Decimal('30')}]
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=rows):
            self.assertEqual(self.apply(self.preview()).status_code, 409)
        with self.app.app_context():
            self.assertEqual(MealLedgerRecord.query.count(), 1)
            self.assertIsNone(MealLedgerRecord.query.one().source_key)

    def test_only_positive_refunds_are_candidates_and_conflicting_history_is_rejected(self):
        self.enable()
        rows = self.rows() + [{**self.rows()[0], 'id':13, 'amount':Decimal('0')},
                             {**self.rows()[0], 'source':'recharge', 'id':14}]
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=rows):
            self.assertEqual(len(self.preview()['rows']), 1)
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.rows() + [{**self.rows()[0], 'amount':Decimal('21')}]):
            self.assertEqual(self.call('preview').status_code, 409)

    def test_original_reconciliation_clearance_is_recognized_by_direct_preview(self):
        self.enable()
        batch = self.confirm(self.generate())
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=self.rows()):
            result = self.post('/reconcile', {'batch_id':batch['id'], 'version':batch['version'],
                'start_date':'2026-09-01', 'end_date':'2026-09-30', 'refund_actions':{'12':'clearance'}})
            self.assertEqual(result.status_code, 200, result.get_json())
            preview = self.preview()
            self.assertEqual(preview['rows'][0]['status'], 'registered')
            result = self.apply(preview)
            self.assertEqual(result.status_code, 200, result.get_json())
            self.assertEqual(result.get_json(), {'month':'2026-09', 'added':0, 'existing':1})
