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
            'start_date':'2026-09-01', 'end_date':'2026-09-30', 'refund_actions': {'12': 'refund'}, **kwargs})

    def test_unclassified_takefund_is_not_automatically_a_subsidy_refund(self):
        self.enable()
        batch = self.confirm(self.generate())
        rows = [self.records()[0], {**self.records()[2], 'amount': Decimal('20')}]
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=rows):
            result = self.reconcile(batch, refund_actions={}).get_json()
        self.assertEqual(result['items'][0]['paid_amount'], 160)
        self.assertEqual(len(result['reconciliation']['pending_refunds']), 1)
        refreshed = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        self.assertEqual(len(refreshed['reconciliation']['pending_refunds']), 1)

    def test_explicit_clearance_is_recorded_once_without_reducing_paid_amount(self):
        self.enable()
        batch = self.confirm(self.generate())
        rows = [{**self.records()[0], 'amount': Decimal('176')}, {**self.records()[2], 'amount': Decimal('20')}]
        with patch('services.card_db_client.CardDBClient.meal_records', return_value=rows):
            result = self.reconcile(batch, refund_actions={'12': 'clearance'}).get_json()
            self.assertEqual(result['items'][0]['paid_amount'], 176)
            self.assertEqual(result['items'][0]['difference'], 0)
            repeated = self.reconcile(result, refund_actions={'12': 'clearance'})
            self.assertEqual(repeated.status_code, 200)
        rows = self.client.get('/api/meal-ledgers/clearance?month=2026-09', headers=self.headers).get_json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['amount'], 20)

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

    def test_fully_reversed_manual_history_can_reconcile_without_double_counting(self):
        batch=self.confirm(self.generate())
        batch=self.post('/payments',{'batch_id':batch['id'],'version':batch['version'],
            'item_id':batch['items'][0]['id'],'kind':'recharge','amount':'176','date':'2026-09-04',
            'reference':'误登记全部充值','request_key':'manual-all'}).get_json()
        original=batch['items'][0]['payments'][0]
        batch=self.post('/payments',{'batch_id':batch['id'],'version':batch['version'],
            'item_id':batch['items'][0]['id'],'kind':'reversal','amount':'176','date':'2026-09-04',
            'reversal_id':original['id'],'reference':'改由数据库核对，撤销手工登记',
            'request_key':'cancel-manual-all'}).get_json()
        self.enable()
        with patch('services.card_db_client.CardDBClient.meal_records',return_value=self.records()):
            result=self.reconcile(batch)
            self.assertEqual(result.status_code,200,result.get_json())
            data=result.get_json()
            self.assertEqual(data['items'][0]['paid_amount'],176)
            self.assertEqual(data['items'][0]['difference'],0)
            self.assertEqual(len(data['items'][0]['payments']),5)
            again=self.reconcile(data)
            self.assertEqual(again.status_code,200,again.get_json())
            self.assertEqual(again.get_json()['reconciliation']['added'],0)


class FollowupReconciliationIntegrationTests(unittest.TestCase):
    setUp = MealReconciliationTests.setUp
    tearDown = MealReconciliationTests.tearDown
    post = MealReconciliationTests.post
    generate = MealReconciliationTests.generate
    confirm = MealReconciliationTests.confirm
    enable = MealReconciliationTests.enable
    reconcile = MealReconciliationTests.reconcile
    from tests.test_meal_ticket_followup import FollowupPersistenceTests as _helpers
    queue = _helpers.queue
    refresh = _helpers.refresh
    progress = _helpers.progress
    adjustment = _helpers.adjustment

    def batch(self):
        return self.client.get('/api/meal-tickets?recharge_month=2026-09',headers=self.headers).get_json()

    def prepare(self, enabled=True):
        from models.meal_ticket import MealTicketFollowupTask
        self.enable()
        self.base = {'source':'subsidy','id':1,'emp_no':'001','time':datetime(2026,9,1),'amount':Decimal('176')}
        with patch('services.card_db_client.CardDBClient.meal_records',return_value=[self.base]):
            response = self.reconcile(self.confirm(self.generate()))
            self.assertEqual(response.status_code,200,response.get_json())
        self.refresh()
        self.client.put('/api/admin/more-settings',json={'meal_ticket_offset_enabled':enabled},headers=self.headers)
        batch = self.adjustment(self.batch(),40)
        self.adjustment(batch,-16)
        queue = self.refresh()
        # Simulate a queue established on September 1, before remote September 2 funds.
        with self.app.app_context():
            for task in MealTicketFollowupTask.query.all():
                task.source_snapshot = {**task.source_snapshot,'baseline_at':'2026-09-01T00:00:00'}
                task.created_at = datetime(2026,9,1)
            db.session.commit()
        return queue

    def read(self, rows, **kwargs):
        with patch('services.card_db_client.CardDBClient.meal_records',return_value=[self.base]+rows):
            return self.reconcile(self.batch(),**kwargs)

    def row(self, amount=10, identifier=2, source='recharge', time=None):
        return {'source':source,'id':identifier,'emp_no':'001','time':time or datetime(2026,9,2,12),'amount':Decimal(str(amount))}

    def test_partial_delayed_repeat_and_failure_preserve_task(self):
        queue = self.prepare()
        self.progress(queue,queue['tasks'][0],'complete')
        response = self.read([])
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual(self.queue()['tasks'][0]['status'],'awaiting')
        self.assertEqual(self.read([self.row()]).status_code,200)
        task = self.queue()['tasks'][0]
        self.assertEqual((task['status'],task['remaining_cents']),('partial',1400))
        response = self.read([self.row(),self.row(14,3,time=datetime(2026,10,2))],end_date='2026-10-02')
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual(self.queue()['tasks'][0]['status'],'verified')
        before = self.batch()
        response = self.read([self.row(),self.row(14,3,time=datetime(2026,10,2))],end_date='2026-10-02')
        self.assertEqual(response.get_json()['version'],before['version'])
        self.assertEqual(len(response.get_json()['items'][0]['payments']),3)
        with patch('services.card_db_client.CardDBClient.meal_records',side_effect=CardDBClientError('offline')):
            self.assertEqual(self.reconcile(self.batch()).status_code,502)
        self.assertEqual(self.queue()['tasks'][0]['status'],'verified')

    def test_same_amount_ambiguity_explicit_link_checks_available_and_versions(self):
        queue = self.prepare()
        self.progress(queue,queue['tasks'][0],'complete')
        response = self.read([self.row(12,2),self.row(12,3)])
        self.assertEqual(response.status_code,200,response.get_json())
        queue = self.queue(); task = queue['tasks'][0]
        self.assertEqual(task['allocated_cents'],0)
        self.assertTrue(task['candidates']['requires_confirmation'])
        candidate = task['candidates']['payments'][0]
        body = {'batch_id':queue['batch_id'],'version':queue['batch_version'],'task_version':task['version'],
                'payment_key':candidate['payment_key'],'amount_cents':1300,'request_key':'link'}
        endpoint = '/followup-tasks/'+task['key']+'/allocations'
        self.assertEqual(self.post(endpoint,body).status_code,409)
        body['amount_cents']=1200
        response = self.post(endpoint,body)
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual(self.post(endpoint,body).get_json(),response.get_json())
        self.assertEqual(response.get_json()['tasks'][0]['remaining_cents'],1200)
        self.assertEqual(self.post(endpoint,{**body,'request_key':'stale'}).status_code,409)
        queue=self.queue();task=queue['tasks'][0]
        remaining=task['candidates']['payments'][0]
        response=self.post(endpoint,{**body,'version':queue['batch_version'],'task_version':task['version'],
            'payment_key':remaining['payment_key'],'request_key':'other'})
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual(response.get_json()['tasks'][0]['status'],'verified')

    def test_clearance_does_not_close_refund_and_classified_refund_does(self):
        self.prepare(enabled=False)
        rows=[self.row(40),self.row(16,3,'refund')]
        response=self.read(rows,refund_actions={})
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual([t['status'] for t in self.queue()['tasks']],['verified','pending'])
        response=self.read(rows,refund_actions={'3':'clearance'})
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual(self.queue()['tasks'][1]['allocated_cents'],0)
        response=self.read(rows+[self.row(16,4,'refund')],refund_actions={'4':'refund'})
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual([t['status'] for t in self.queue()['tasks']],['verified','verified'])
        self.assertEqual(response.get_json()['items'][0]['paid_amount'],200)

    def test_late_imported_old_funds_never_verify_new_task(self):
        queue=self.prepare()
        self.progress(queue,queue['tasks'][0],'complete')
        # A remote event before the task baseline is newly imported locally.
        response=self.read([self.row(24,time=datetime(2026,9,1,7))])
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual(self.queue()['tasks'][0]['allocated_cents'],0)

    def test_failure_after_fund_import_rolls_back_funds_and_allocations(self):
        from services.meal_ticket_service import MealError
        self.prepare()
        before=self.batch()
        with patch('services.meal_ticket_followup_service.allocate_payment',side_effect=MealError('分配失败',409)):
            response=self.read([self.row(24)])
        self.assertEqual(response.status_code,409,response.get_json())
        after=self.batch()
        self.assertEqual(after['version'],before['version'])
        self.assertEqual(after['items'][0]['payments'],before['items'][0]['payments'])
        self.assertEqual(self.queue()['tasks'][0]['allocated_cents'],0)


    def test_overlarge_single_fund_requires_confirmation(self):
        self.prepare()
        response=self.read([self.row(40)])
        self.assertEqual(response.status_code,200,response.get_json())
        task=self.queue()['tasks'][0]
        self.assertEqual(task['allocated_cents'],0)
        self.assertTrue(task['candidates']['requires_confirmation'])

    def test_old_fund_between_financial_baseline_and_new_task_not_reused(self):
        from models.meal_ticket import MealTicketFollowupTask
        self.prepare()
        with self.app.app_context():
            task=MealTicketFollowupTask.query.one()
            task.created_at=datetime(2026,9,3)
            db.session.commit()
        response=self.read([self.row(24)])
        self.assertEqual(response.status_code,200,response.get_json())
        task=self.queue()['tasks'][0]
        self.assertEqual(task['allocated_cents'],0)
        self.assertEqual(task['candidates']['payments'],[])

    def test_stale_unoperated_task_does_not_auto_match_changed_sources(self):
        self.prepare()
        self.adjustment(self.batch(),-8)
        response=self.read([self.row(24)])
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual(self.queue()['tasks'][0]['allocated_cents'],0)

    def test_two_same_direction_tasks_wait_for_explicit_link(self):
        from models.meal_ticket import MealTicketFollowupTask
        queue=self.prepare()
        self.progress(queue,queue['tasks'][0],'complete')
        self.adjustment(self.batch(),24)
        queue=self.refresh()
        with self.app.app_context():
            for task in MealTicketFollowupTask.query.all():
                task.created_at=datetime(2026,9,1)
                task.source_snapshot={**task.source_snapshot,'baseline_at':'2026-09-01T00:00:00'}
            db.session.commit()
        response=self.read([self.row(24)])
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual([t['allocated_cents'] for t in self.queue()['tasks']],[0,0])
        self.assertTrue(all(t['candidates']['requires_confirmation'] for t in self.queue()['tasks']))


    def test_link_rejects_invalid_payment_key_before_query(self):
        queue=self.prepare()
        task=queue['tasks'][0]
        response=self.post('/followup-tasks/'+task['key']+'/allocations', {
            'batch_id':queue['batch_id'],'version':queue['batch_version'],'task_version':task['version'],
            'payment_key':['bad'],'amount_cents':100,'request_key':'invalid-key'})
        self.assertEqual(response.status_code,400,response.get_json())
