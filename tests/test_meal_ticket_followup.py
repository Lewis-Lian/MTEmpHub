import pytest


def project(recharge, refund, enabled):
    from services.meal_ticket_followup_service import project_pending_amounts
    return project_pending_amounts(recharge, refund, enabled)


@pytest.mark.parametrize("recharge,refund,enabled,expected", [
    (4000, 1600, True, [{"kind": "recharge", "amount_cents": 2400}]),
    (1600, 4000, True, [{"kind": "refund", "amount_cents": 2400}]),
    (2400, 2400, True, []),
    (4000, 1600, False, [{"kind": "recharge", "amount_cents": 4000},
                        {"kind": "refund", "amount_cents": 1600}]),
    (1600, 4000, False, [{"kind": "recharge", "amount_cents": 1600},
                        {"kind": "refund", "amount_cents": 4000}]),
    (2400, 2400, False, [{"kind": "recharge", "amount_cents": 2400},
                        {"kind": "refund", "amount_cents": 2400}]),
    (0, 0, True, []), (0, 0, False, []),
    (1400, 0, True, [{"kind": "recharge", "amount_cents": 1400}]),
    (1400, 0, False, [{"kind": "recharge", "amount_cents": 1400}]),
    (0, 1, False, [{"kind": "refund", "amount_cents": 1}]),
    (1, 0, True, [{"kind": "recharge", "amount_cents": 1}]),
])
def test_pending_amount_projection(recharge, refund, enabled, expected):
    # Inputs are remaining obligations: 1400 already excludes the received 1000.
    assert project(recharge, refund, enabled) == expected


@pytest.mark.parametrize("invalid", [-1, 1.0, "1", None, True, False])
@pytest.mark.parametrize("field", [0, 1])
def test_rejects_non_integer_or_negative_obligations(invalid, field):
    amounts = [0, 0]
    amounts[field] = invalid
    with pytest.raises(ValueError):
        project(*amounts, True)


@pytest.mark.parametrize("invalid", [0, 1, "true", None])
def test_requires_boolean_offset(invalid):
    with pytest.raises(ValueError):
        project(0, 0, invalid)


from tests.test_meal_tickets import MealTicketTests


import unittest


class FollowupPersistenceTests(unittest.TestCase):
    setUp = MealTicketTests.setUp
    tearDown = MealTicketTests.tearDown
    post = MealTicketTests.post
    generate = MealTicketTests.generate
    confirm = MealTicketTests.confirm
    adjustment = MealTicketTests.adjustment
    def queue(self):
        response = self.client.get('/api/meal-tickets/followup-tasks?recharge_month=2026-09', headers=self.headers)
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json()

    def refresh(self, batch=None, **extra):
        queue = self.queue()
        response = self.post('/followup-tasks/refresh', {
            'batch_id': queue['batch_id'], 'version': queue['batch_version'],
            'settings_digest': queue['settings_digest'], 'request_key': 'refresh-' + str(queue['batch_version']), **extra})
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json()

    def settled(self):
        batch = self.confirm(self.generate())
        response = self.post('/payments', {'batch_id': batch['id'], 'version': batch['version'],
            'item_id': batch['items'][0]['id'], 'kind': 'recharge', 'amount': 176,
            'date': '2026-09-01', 'reference': '已核实基线', 'request_key': 'baseline'})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.refresh()
        return response.get_json()

    def progress(self, queue, task, action, **extra):
        return self.post('/followup-tasks/' + task['key'] + '/progress', {
            'batch_id': queue['batch_id'], 'version': queue['batch_version'],
            'task_version': task['version'], 'action': action, 'request_key': action + '-' + task['key'], **extra})

    def test_get_is_read_only_and_baseline_required(self):
        self.assertEqual(self.queue()['tasks'], [])
        self.confirm(self.generate())
        self.assertTrue(self.queue()['baseline_required'])
        self.assertEqual(self.queue()['tasks'], [])
        response = self.post('/followup-tasks/refresh', {'batch_id': self.queue()['batch_id'],
            'version': self.queue()['batch_version'], 'settings_digest': self.queue()['settings_digest'],
            'request_key': 'unsafe'})
        self.assertEqual(response.status_code, 409)

    def test_operation_is_not_funds_and_settings_preserve_awaiting(self):
        batch = self.settled()
        batch = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        batch = self.adjustment(batch, 40)
        batch = self.adjustment(batch, -16)
        queue = self.refresh()
        self.assertEqual([(t['kind'], t['amount_cents']) for t in queue['tasks']], [('recharge', 2400)])
        task = queue['tasks'][0]
        response = self.progress(queue, task, 'complete')
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()['tasks'][0]['status'], 'awaiting')
        # Retry the exact original request despite its now-stale versions.
        self.assertEqual(self.progress(queue, task, 'complete').get_json(), response.get_json())
        after = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        for field in ('due_amount', 'paid_amount', 'difference'):
            self.assertEqual(batch['items'][0][field], after['items'][0][field])
        self.client.put('/api/admin/more-settings', json={'meal_ticket_offset_enabled': False}, headers=self.headers)
        self.assertTrue(self.queue()['settings_changed'])
        queue = self.refresh()
        self.assertEqual(len([t for t in queue['tasks'] if t['status'] != 'superseded']), 1)
        self.assertEqual(queue['tasks'][0]['key'], task['key'])
        self.assertEqual(queue['tasks'][0]['status'], 'awaiting')

    def test_disabled_preserves_both_directions_and_skip_survives(self):
        self.settled()
        self.client.put('/api/admin/more-settings', json={'meal_ticket_offset_enabled': False}, headers=self.headers)
        batch = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        batch = self.adjustment(batch, 24)
        self.adjustment(batch, -24)
        queue = self.refresh()
        self.assertEqual([(t['kind'], t['amount_cents'], t['emp_no']) for t in queue['tasks']],
                         [('recharge', 2400, '001'), ('refund', 2400, '001')])
        task = queue['tasks'][0]
        response = self.progress(queue, task, 'skip')
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(self.queue()['tasks'][-1]['key'], task['key'])
        self.assertEqual(self.queue()['current_task_key'], queue['tasks'][1]['key'])
        stale = self.progress(queue, queue['tasks'][1], 'complete')
        self.assertEqual(stale.status_code, 409)

    def test_one_direction_operation_does_not_consume_other_direction(self):
        self.settled()
        self.client.put('/api/admin/more-settings', json={'meal_ticket_offset_enabled': False}, headers=self.headers)
        batch = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        batch = self.adjustment(batch, 40)
        self.adjustment(batch, -16)
        queue = self.refresh()
        self.progress(queue, queue['tasks'][0], 'complete')
        queue = self.refresh()
        active = [(t['kind'], t['amount_cents'], t['status']) for t in queue['tasks'] if t['status'] != 'superseded']
        self.assertEqual(active, [('recharge',4000,'awaiting'), ('refund',1600,'pending')])

    def test_unchanged_refresh_preserves_skip_key_and_order(self):
        self.settled()
        batch = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        self.adjustment(batch, 24)
        queue = self.refresh()
        response = self.progress(queue, queue['tasks'][0], 'skip').get_json()
        refreshed = self.refresh()
        self.assertEqual(refreshed['tasks'][0]['key'], response['tasks'][0]['key'])
        self.assertEqual(refreshed['tasks'][0]['status'], 'skipped')

    def test_zero_offset_can_be_refreshed_to_separate_directions(self):
        self.settled()
        batch = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        batch = self.adjustment(batch, 24)
        self.adjustment(batch, -24)
        self.assertEqual(self.refresh()['tasks'], [])
        self.client.put('/api/admin/more-settings', json={'meal_ticket_offset_enabled':False}, headers=self.headers)
        self.assertEqual([t['amount_cents'] for t in self.refresh()['tasks']], [2400,2400])

    def test_old_history_requires_explicit_confirmed_directions(self):
        batch = self.confirm(self.generate())
        queue = self.queue()
        item_key = batch['items'][0]['key'] if 'key' in batch['items'][0] else None
        from models.meal_ticket import MealTicketItem
        with self.app.app_context():
            item_key = MealTicketItem.query.filter_by(id=batch['items'][0]['id']).one().key
        response = self.refresh(baselines={item_key:{'recharge_cents':17600, 'refund_cents':0, 'reason':'已核对无充值'}})
        self.assertEqual(response['tasks'][0]['amount_cents'], 17600)

    def test_adjustment_after_queue_rejects_stale_card_until_refresh(self):
        self.settled()
        batch = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        batch = self.adjustment(batch, 24)
        queue = self.refresh()
        batch = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        self.adjustment(batch, -8)
        # Even submitting a current batch version cannot operate an old card.
        queue['batch_version'] = self.queue()['batch_version']
        self.assertEqual(self.progress(queue, queue['tasks'][0], 'complete').status_code, 409)
        refreshed = self.refresh()
        self.assertEqual([t['amount_cents'] for t in refreshed['tasks'] if t['status']=='pending'], [1600])

    def test_retry_keeps_received_funds_and_survives_setting_change(self):
        from services.meal_ticket_followup_service import allocate_payment
        from models import db
        from models.meal_ticket import MealTicketPayment
        from datetime import date
        self.settled()
        batch = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        self.adjustment(batch, 24)
        queue = self.refresh()
        self.progress(queue, queue['tasks'][0], 'complete')
        with self.app.app_context():
            old = MealTicketPayment.query.filter_by(request_key='baseline').one()
            p = MealTicketPayment(item_key=old.item_key, month=old.month, kind='recharge', amount_cents=1000,
                payment_date=date(2026,9,2), reference='部分到账', operator='admin', request_key='partial', request_digest='x')
            db.session.add(p); db.session.flush()
            allocate_payment(queue['tasks'][0]['key'], p.key, 1000, 'admin')
            db.session.commit()
        queue = self.queue()
        self.assertEqual(self.progress(queue, queue['tasks'][0], 'undo').status_code, 409)
        self.assertEqual(self.progress(queue, queue['tasks'][0], 'retry').status_code, 400)
        result = self.progress(queue, queue['tasks'][0], 'retry', reason='核实设备只充值10元')
        self.assertEqual(result.status_code, 200, result.get_json())
        self.client.put('/api/admin/more-settings', json={'meal_ticket_offset_enabled':False}, headers=self.headers)
        queue = self.refresh()
        self.assertEqual(queue['tasks'][0]['remaining_cents'], 1400)
        self.assertEqual(queue['tasks'][0]['status'], 'pending')
        result = self.progress(queue, queue['tasks'][0], 'complete', request_key='second-complete')
        self.assertEqual(result.status_code, 200, result.get_json())

    def test_ambiguous_funds_wait_for_explicit_link_and_multiple_payments(self):
        from services.meal_ticket_followup_service import allocate_payment, payment_candidates
        from models import db
        from models.meal_ticket import MealTicketPayment
        from datetime import date
        self.settled()
        batch = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        self.adjustment(batch, 24)
        queue = self.refresh()
        self.progress(queue, queue['tasks'][0], 'complete')
        with self.app.app_context():
            old = MealTicketPayment.query.filter_by(request_key='baseline').one()
            payments = []
            for number in range(2):
                p = MealTicketPayment(item_key=old.item_key, month=old.month, kind='recharge', amount_cents=1200,
                    payment_date=date(2026,9,2), reference='分笔到账', operator='admin', request_key=str(number), request_digest='x')
                db.session.add(p); payments.append(p)
            db.session.flush()
            candidates = payment_candidates(queue['tasks'][0]['key'])
            self.assertTrue(candidates['requires_confirmation'])
            self.assertEqual(len(candidates['payments']), 2)
            from models.meal_ticket import MealTicketFollowupAllocation
            self.assertEqual(MealTicketFollowupAllocation.query.count(), 0)
            for p in payments:
                allocate_payment(queue['tasks'][0]['key'], p.key, 1200, 'admin')
            db.session.commit()
        self.assertEqual(self.queue()['tasks'][0]['status'], 'verified')

    def test_same_request_with_changed_content_conflicts_and_admin_only(self):
        self.settled()
        batch = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        self.adjustment(batch, 24)
        queue = self.refresh()
        task = queue['tasks'][0]
        self.assertEqual(self.progress(queue, task, 'skip').status_code, 200)
        self.assertEqual(self.progress(queue, task, 'complete', request_key='skip-' + task['key']).status_code, 409)
        response = self.client.get('/api/meal-tickets/followup-tasks?recharge_month=2026-09',
            headers={'Authorization':'Bearer ' + self.viewer_token})
        self.assertEqual(response.status_code, 403)

    def test_concurrent_distinct_requests_do_not_overwrite_progress(self):
        from concurrent.futures import ThreadPoolExecutor
        from tests.csrf_helper import attach_origin
        self.settled()
        batch = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        self.adjustment(batch, 24)
        queue = self.refresh()
        task = queue['tasks'][0]
        def complete(number):
            client = attach_origin(self.app.test_client())
            return client.post('/api/meal-tickets/followup-tasks/' + task['key'] + '/progress',
                json={'batch_id':queue['batch_id'], 'version':queue['batch_version'], 'task_version':task['version'],
                    'action':'complete', 'request_key':'concurrent-' + str(number)}, headers=self.headers).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(complete, range(2))), [200,409])
        self.assertEqual(self.queue()['tasks'][0]['status'], 'awaiting')

    def test_historical_adjustments_already_paid_are_not_requeued(self):
        batch = self.confirm(self.generate())
        batch = self.adjustment(batch, 40)
        batch = self.adjustment(batch, -16)
        response = self.post('/payments', {'batch_id':batch['id'], 'version':batch['version'],
            'item_id':batch['items'][0]['id'], 'kind':'recharge', 'amount':200, 'date':'2026-09-01',
            'reference':'历史调整已实际到账', 'request_key':'historical'})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.client.put('/api/admin/more-settings', json={'meal_ticket_offset_enabled':False}, headers=self.headers)
        self.assertEqual(self.refresh()['tasks'], [])

    def test_real_queue_state_zip_preserves_awaiting_and_portable_idempotency(self):
        from services.account_set_backup_service import export_multi_backup, read_backup
        from services.account_set_restore_service import build_multi_preview
        self.settled()
        batch = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        self.adjustment(batch, 24)
        queue = self.refresh()
        self.progress(queue, queue['tasks'][0], 'complete')
        with self.app.app_context():
            document = read_backup(export_multi_backup([1]), normalized=True)
            datasets = document['monthly']['2026-08']['datasets']
            self.assertEqual(datasets['meal_followup_tasks'][0]['status'], 'awaiting')
            requests = datasets['meal_batches'][0]['followup_state']['requests']
            self.assertTrue(requests)
            self.assertTrue(all('batch_id' not in r['result'] and 'batch_key' in r['result'] for r in requests.values()))
            preview = build_multi_preview(document, {'months':['2026-08'], 'categories':['meal_tickets']})
            self.assertEqual(preview['blockers'], [])

    def test_awaiting_operations_prevent_retreat_to_draft(self):
        from models.meal_ticket import MealTicketItem
        batch = self.confirm(self.generate())
        with self.app.app_context():
            item_key = MealTicketItem.query.filter_by(id=batch['items'][0]['id']).one().key
        queue = self.refresh(baselines={item_key:{'recharge_cents':17600,'refund_cents':0,'reason':'核实未到账'}})
        response = self.progress(queue, queue['tasks'][0], 'complete').get_json()
        result = self.post('/unconfirm', {'batch_id':response['batch_id'],'version':response['batch_version']})
        self.assertEqual(result.status_code, 409)
        self.assertEqual(self.queue()['tasks'][0]['status'], 'awaiting')

    def test_unoperated_queue_is_invalidated_when_retreating_to_draft(self):
        from models.meal_ticket import MealTicketItem
        batch = self.confirm(self.generate())
        with self.app.app_context():
            item_key = MealTicketItem.query.filter_by(id=batch['items'][0]['id']).one().key
        queue = self.refresh(baselines={item_key:{'recharge_cents':17600,'refund_cents':0,'reason':'核实未到账'}})
        result = self.post('/unconfirm', {'batch_id':queue['batch_id'],'version':queue['batch_version']})
        self.assertEqual(result.status_code, 200, result.get_json())
        self.assertEqual(self.queue()['tasks'][0]['status'], 'superseded')
        self.assertIsNone(self.queue()['current_task_key'])
        from services.account_set_backup_service import export_multi_backup
        from models.employee_attendance_override import EmployeeAttendanceOverride
        from models import db
        with self.app.app_context():
            self.assertTrue(export_multi_backup([1]))
            EmployeeAttendanceOverride.query.filter_by(emp_id=self.emp_id, month='2026-08').one().actual_attendance_days = 20
            db.session.commit()
        self.confirm(self.generate())
        refreshed = self.refresh(baselines={item_key:{'recharge_cents':16000,'refund_cents':0,'reason':'重算后重新核实'}})
        self.assertEqual([t['amount_cents'] for t in refreshed['tasks'] if t['status']=='pending'], [16000])

    def test_partial_allocation_old_funds_rejection_and_reversal(self):
        from services.meal_ticket_followup_service import allocate_payment, refresh_allocations
        from models.meal_ticket import MealTicketPayment
        from services.meal_ticket_service import MealError
        self.settled()
        batch = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()
        self.adjustment(batch, 24)
        queue = self.refresh()
        task = queue['tasks'][0]
        self.progress(queue, task, 'complete')
        with self.app.app_context():
            old = MealTicketPayment.query.filter_by(request_key='baseline').one()
            with self.assertRaises(MealError):
                allocate_payment(task['key'], old.key, 1000, 'admin')
            p = MealTicketPayment(item_key=old.item_key, month=old.month, kind='recharge', amount_cents=1000,
                payment_date=old.payment_date, reference='到账', operator='admin', request_key='new', request_digest='x')
            from datetime import date
            p.payment_date = date(2026, 9, 2)
            db = __import__('models', fromlist=['db']).db
            db.session.add(p)
            db.session.flush()
            allocate_payment(task['key'], p.key, 1000, 'admin')
            allocate_payment(task['key'], p.key, 1000, 'admin')
            with self.assertRaises(MealError):
                allocate_payment(task['key'], p.key, 1001, 'admin')
            db.session.commit()
        result = self.queue()['tasks'][0]
        self.assertEqual((result['status'], result['allocated_cents'], result['remaining_cents']), ('partial', 1000, 1400))
        with self.app.app_context():
            p = MealTicketPayment.query.filter_by(request_key='new').one()
            db.session.add(MealTicketPayment(item_key=p.item_key, month=p.month, kind='reversal', amount_cents=-1000,
                payment_date=p.payment_date, reference='冲正', operator='admin', request_key='reversed', request_digest='x', reversal_of=p.key))
            db.session.flush()
            refresh_allocations(task['key'])
            db.session.commit()
        self.assertEqual(self.queue()['tasks'][0]['status'], 'awaiting')


del MealTicketTests


class FollowupFundsIntegrationTests(unittest.TestCase):
    setUp = FollowupPersistenceTests.setUp
    tearDown = FollowupPersistenceTests.tearDown
    post = FollowupPersistenceTests.post
    generate = FollowupPersistenceTests.generate
    confirm = FollowupPersistenceTests.confirm
    adjustment = FollowupPersistenceTests.adjustment
    queue = FollowupPersistenceTests.queue
    refresh = FollowupPersistenceTests.refresh
    settled = FollowupPersistenceTests.settled
    progress = FollowupPersistenceTests.progress

    def batch(self):
        return self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json()

    def prepare(self, enabled=False, positive=40, negative=-16):
        self.settled()
        self.client.put('/api/admin/more-settings', json={'meal_ticket_offset_enabled': enabled}, headers=self.headers)
        batch = self.adjustment(self.batch(), positive)
        self.adjustment(batch, negative)
        return self.refresh()

    def pay_task(self, task_kind, payment_amount, **overrides):
        queue = self.queue()
        task = next(t for t in queue['tasks'] if t['kind'] == task_kind and t['status'] != 'superseded')
        return self.post('/payments', {'batch_id': queue['batch_id'], 'version': queue['batch_version'],
            'item_id': self.batch()['items'][0]['id'], 'kind': task_kind, 'amount': payment_amount,
            'date': '2026-09-02', 'reference': '实际设备凭证', 'request_key': task_kind + '-' + str(queue['batch_version']),
            'task_key': task['key'], 'task_version': task['version'], **overrides})

    def test_disabled_funds_both_orders_and_ordinary_payment_protection(self):
        self.prepare()
        for kind, amount, paid in [('recharge',40,216), ('refund',16,200)]:
            if kind == 'recharge':
                ordinary = self.pay_task(kind, amount, task_key=None)
                self.assertEqual(ordinary.status_code, 400, ordinary.get_json())
            response = self.pay_task(kind, amount)
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(response.get_json()['items'][0]['paid_amount'], paid)
        self.assertEqual([t['status'] for t in self.queue()['tasks']], ['verified','verified'])

    def test_disabled_refund_first(self):
        self.prepare()
        for kind, amount, paid in [('refund',16,160),('recharge',40,200)]:
            response = self.pay_task(kind, amount)
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(response.get_json()['items'][0]['paid_amount'], paid)
        self.assertTrue(all(t['status'] == 'verified' for t in self.queue()['tasks']))

    def test_partial_manual_funds_and_reversal_restore_only_remaining(self):
        queue = self.prepare(enabled=True)
        self.progress(queue, queue['tasks'][0], 'complete')
        response = self.pay_task('recharge', 10)
        self.assertEqual(response.status_code, 200, response.get_json())
        task = self.queue()['tasks'][0]
        self.assertEqual((task['status'],task['allocated_cents'],task['remaining_cents']),('partial',1000,1400))
        self.assertEqual(self.pay_task('recharge',15).status_code, 409)
        response = self.pay_task('recharge',14)
        self.assertEqual(response.status_code,200,response.get_json())
        batch = response.get_json()
        payment = batch['items'][0]['payments'][-1]
        response = self.post('/payments', {'batch_id':batch['id'],'version':batch['version'],
            'item_id':batch['items'][0]['id'],'kind':'reversal','reversal_id':payment['id'],'amount':14,
            'date':'2026-09-03','reference':'设备撤销14元','request_key':'reverse'})
        self.assertEqual(response.status_code,200,response.get_json())
        task = self.queue()['tasks'][0]
        self.assertEqual((task['status'],task['allocated_cents'],task['remaining_cents']),('partial',1000,1400))
        self.assertEqual(self.batch()['items'][0]['paid_amount'],186)

    def test_net_zero_is_not_task_completion(self):
        self.prepare(positive=24,negative=-24)
        self.assertEqual(self.batch()['items'][0]['difference'],0)
        self.assertEqual([t['status'] for t in self.queue()['tasks']],['pending','pending'])
        self.assertEqual(self.pay_task('refund',24).status_code,200)
        self.assertEqual(self.pay_task('recharge',24).status_code,200)
        self.assertEqual([t['status'] for t in self.queue()['tasks']],['verified','verified'])

    def test_task_validation_and_rollback(self):
        queue = self.prepare()
        before = self.batch()
        for override in [{'task_version':0}, {'kind':'refund'}, {'item_id':before['items'][1]['id']},
                         {'task_key':'missing'}, {'date':'2026-08-01'}, {'amount':41}]:
            response = self.pay_task('recharge',40,**override)
            self.assertIn(response.status_code,(400,404,409),response.get_json())
            after = self.batch()
            self.assertEqual(after['version'],before['version'])
            self.assertEqual(after['items'][0]['payments'],before['items'][0]['payments'])
        self.adjustment(before,-8)
        self.assertEqual(self.pay_task('recharge',40).status_code,409)

    def test_manual_request_key_cannot_be_reused_for_other_task(self):
        self.prepare()
        response = self.pay_task('recharge',40,request_key='same')
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual(self.pay_task('refund',16,request_key='same').status_code,409)


    def test_old_month_baseline_response_has_portable_item_and_real_totals(self):
        self.confirm(self.generate())
        queue=self.queue()
        first=queue['baseline_items'][0]
        self.assertEqual((first['emp_no'],first['due_cents'],first['paid_cents'],first['difference_cents']),('001',17600,0,17600))
        self.assertNotIn('item_id',first)
        self.assertIn('item_key',first)


    def test_manual_task_key_rejects_non_string_without_writing(self):
        self.prepare()
        before=self.batch()
        response=self.pay_task('recharge',40,task_key=['invalid'])
        self.assertEqual(response.status_code,400,response.get_json())
        self.assertEqual(self.batch()['version'],before['version'])


    def test_manual_partial_without_declaration_retry_remains_portable(self):
        from services.account_set_backup_service import export_multi_backup, read_backup
        from services.account_set_restore_service import build_multi_preview
        self.prepare(enabled=True)
        self.assertEqual(self.pay_task('recharge',10).status_code,200)
        queue=self.queue();task=queue['tasks'][0]
        response=self.progress(queue,task,'retry',reason='核实实际只充值10，需重新办理14')
        self.assertEqual(response.status_code,200,response.get_json())
        self.assertEqual(response.get_json()['tasks'][0]['remaining_cents'],1400)
        with self.app.app_context():
            document=read_backup(export_multi_backup([1]),normalized=True)
            preview=build_multi_preview(document,{'months':['2026-08'],'categories':['meal_tickets']})
            self.assertEqual(preview['blockers'],[])


    def test_concurrent_manual_task_payments_accept_only_one_current_version(self):
        from concurrent.futures import ThreadPoolExecutor
        from tests.csrf_helper import attach_origin
        queue=self.prepare()
        task=queue['tasks'][0]
        item_id=self.batch()['items'][0]['id']
        def pay(number):
            return attach_origin(self.app.test_client()).post('/api/meal-tickets/payments',headers=self.headers,json={
                'batch_id':queue['batch_id'],'version':queue['batch_version'],'item_id':item_id,
                'task_key':task['key'],'task_version':task['version'],'kind':'recharge','amount':40,
                'date':'2026-09-02','reference':'实际凭证','request_key':'parallel-'+str(number)}).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(pay,range(2))),[200,409])
        self.assertEqual(self.batch()['items'][0]['paid_amount'],216)
        self.assertEqual(self.queue()['tasks'][0]['allocated_cents'],4000)
        self.assertEqual(len(self.batch()['items'][0]['payments']),2)

    def test_task_payment_exact_retry_does_not_recreate_payment_or_allocation(self):
        from models.meal_ticket import MealTicketFollowupAllocation
        queue=self.prepare();task=queue['tasks'][0]
        body={'batch_id':queue['batch_id'],'version':queue['batch_version'],'item_id':self.batch()['items'][0]['id'],
              'task_key':task['key'],'task_version':task['version'],'kind':'recharge','amount':40,
              'date':'2026-09-02','reference':'真实凭证','request_key':'exact-repeat'}
        first=self.post('/payments',body)
        self.assertEqual(first.status_code,200,first.get_json())
        second=self.post('/payments',body)
        self.assertEqual(second.status_code,200,second.get_json())
        self.assertEqual(first.get_json()['version'],second.get_json()['version'])
        with self.app.app_context():
            self.assertEqual(MealTicketFollowupAllocation.query.count(),1)
