"""Reusable guest accounts must reconcile each real transaction only once."""
import unittest
from datetime import datetime
from unittest.mock import patch

from tests import test_meal_ledgers as ledger_tests


class GuestCardTests(unittest.TestCase):
    setUp = ledger_tests.MealLedgerTests.setUp
    tearDown = ledger_tests.MealLedgerTests.tearDown
    ledger = ledger_tests.MealLedgerTests.ledger
    def card(self, **values):
        response = self.client.post('/api/meal-ledgers/guest-cards', json={
            'card_no':'0009001', 'emp_no':'G001', 'name':'客人卡01', **values}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json()

    def linked(self, card, **values):
        response = self.ledger('external', name='来访甲', dept_name='接待部', amount=100,
            category='card', guest_card_key=card['key'], **values)
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json()

    def enable_database(self):
        from models import db
        from models.system_setting import SystemSetting
        with self.app.app_context():
            for key, value in {'meal_ticket_db_enabled':'true','card_db_host':'example',
                    'card_db_database':'card','card_db_user':'reader','card_db_password':'test'}.items():
                SystemSetting.set_value(key,value)
            db.session.commit()

    def check(self, record, sources=None):
        return self.client.post(f'/api/meal-ledgers/records/{record["id"]}/recharge-check',
            json={'end_date':'2026-09-30', **({'source_keys':sources} if sources is not None else {})}, headers=self.headers)

    def test_registration_keeps_leading_zeros_and_rejects_duplicate_account(self):
        card = self.card()
        self.assertEqual(card['card_no'],'0009001')
        response = self.client.post('/api/meal-ledgers/guest-cards',json={
            'card_no':'9002','emp_no':'G001','name':'客人卡02'},headers=self.headers)
        self.assertEqual(response.status_code,409)
        rows = self.client.get('/api/meal-ledgers/guest-cards',headers=self.headers).get_json()
        self.assertEqual([r['key'] for r in rows],[card['key']])

    def test_edit_unused_card_preserves_key_and_leading_zeros(self):
        card = self.card()
        response = self.client.put('/api/meal-ledgers/guest-cards/' + card['key'], headers=self.headers,
            json={'card_no':'0009002', 'emp_no':'G002', 'name':'改名客人卡'})
        self.assertEqual(response.status_code, 200, response.get_json())
        updated = response.get_json()
        self.assertEqual((updated['key'], updated['card_no'], updated['emp_no'], updated['name']),
                         (card['key'], '0009002', 'G002', '改名客人卡'))
        self.assertFalse(updated['has_history'])

    def test_used_card_allows_name_changes_but_keeps_identity_and_history(self):
        card = self.card()
        record = self.linked(card)
        response = self.client.put('/api/meal-ledgers/guest-cards/' + card['key'], headers=self.headers,
            json={'card_no':card['card_no'], 'emp_no':card['emp_no'], 'name':'新名称'})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertTrue(response.get_json()['has_history'])
        for changes in ({'card_no':'different'}, {'emp_no':'different'}):
            response = self.client.put('/api/meal-ledgers/guest-cards/' + card['key'], headers=self.headers, json=changes)
            self.assertEqual(response.status_code, 409, response.get_json())
        from models import db
        from models.meal_ledger import MealLedgerRecord
        with self.app.app_context():
            saved = db.session.get(MealLedgerRecord, record['id'])
            self.assertEqual((saved.data['card_no'], saved.data['emp_no'], saved.data['name']),
                             (card['card_no'], card['emp_no'], record['name']))
            saved.voided = True
            db.session.commit()
        response = self.client.put('/api/meal-ledgers/guest-cards/' + card['key'], headers=self.headers, json={'emp_no':'different'})
        self.assertEqual(response.status_code, 409)

    def test_edit_rejects_duplicate_and_invalid_card_fields_without_partial_changes(self):
        card = self.card()
        self.card(card_no='other-card', emp_no='OTHER')
        for changes, status in [({'card_no':'other-card'},409), ({'emp_no':'OTHER'},409),
                                ({'name':'   '},400), ({'card_no':'x'*51},400),
                                ({'is_active':'false'},400), ({'unknown':'x'},400), ({},400)]:
            response = self.client.put('/api/meal-ledgers/guest-cards/' + card['key'], headers=self.headers, json=changes)
            self.assertEqual(response.status_code, status, response.get_json())
        self.assertEqual(self.client.put('/api/meal-ledgers/guest-cards/missing', headers=self.headers, json={'name':'改名'}).status_code, 404)
        cards = self.client.get('/api/meal-ledgers/guest-cards', headers=self.headers).get_json()
        unchanged = next(row for row in cards if row['key'] == card['key'])
        self.assertEqual((unchanged['card_no'], unchanged['emp_no'], unchanged['name']),
                         (card['card_no'], card['emp_no'], card['name']))

    def test_linked_pending_is_not_actual_department_spending(self):
        record = self.linked(self.card())
        self.assertEqual(record['emp_no'],'G001')
        self.assertEqual(record['card_no'],'0009001')
        self.assertEqual(record['recharge_status'],'pending')
        self.assertEqual(record['actual_amount'],0)
        data = self.client.get('/api/meal-ledgers/department?month=2026-09',headers=self.headers).get_json()
        self.assertEqual(data['items'][0]['external_card_amount'],0)

    def test_partial_complete_retry_and_reuse_do_not_consume_same_recharge_twice(self):
        self.enable_database()
        card = self.card()
        first = self.linked(card)
        remote = [dict(source='recharge',id=1,emp_no='G001',time=datetime(2026,9,30,10),amount='40'),
                  dict(source='recharge',id=2,emp_no='G001',time=datetime(2026,9,30,11),amount='60')]
        with patch('services.meal_guest_card_service.CardDBClient.meal_records',return_value=remote):
            result = self.check(first).get_json()
            self.assertEqual(result['record']['actual_amount'],0)  # a read is not a match
            keys = [r['source_key'] for r in result['candidates']]
            partial = self.check(first,keys[:1]).get_json()['record']
            self.assertEqual(partial['recharge_status'],'partial')
            self.assertEqual(partial['actual_amount'],40)
            done = self.check(first,keys).get_json()['record']
            self.assertEqual(done['recharge_status'],'complete')
            self.assertEqual(done['actual_amount'],100)
            self.assertEqual(self.check(first,keys).get_json()['record']['actual_amount'],100)
            second = self.linked(card,request_key='next-guest')
            self.assertEqual(self.check(second,keys[:1]).status_code,409)
        data = self.client.get('/api/meal-ledgers/department?month=2026-09',headers=self.headers).get_json()
        self.assertEqual(data['items'][0]['external_card_amount'],100)

    def test_database_failure_is_an_error_and_never_marks_paid(self):
        from services.card_db_client import CardDBClientError
        self.enable_database()
        record = self.linked(self.card())
        with patch('services.meal_guest_card_service.CardDBClient.meal_records',side_effect=CardDBClientError('failed')):
            self.assertEqual(self.check(record).status_code,502)
        rows = self.client.get('/api/meal-ledgers/external?month=2026-09',headers=self.headers).get_json()
        self.assertEqual(rows[0]['actual_amount'],0)

    def test_disabled_card_cannot_be_used_but_history_stays_readable(self):
        card = self.card()
        self.linked(card)
        response = self.client.put('/api/meal-ledgers/guest-cards/'+card['key'],json={'is_active':False},headers=self.headers)
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.ledger('external',name='访客',dept_name='接待部',amount=10,
            category='card',guest_card_key=card['key'],request_key='disabled').status_code,409)
        self.assertEqual(len(self.client.get('/api/meal-ledgers/external?month=2026-09',headers=self.headers).get_json()),1)

    def test_history_duplicates_deduplicate_but_changed_posted_evidence_blocks(self):
        self.enable_database()
        record = self.linked(self.card())
        row = dict(source='recharge',id=7,emp_no='G001',time=datetime(2026,9,30,10),amount='100')
        with patch('services.meal_guest_card_service.CardDBClient.meal_records',return_value=[row,row]):
            data = self.check(record).get_json()
            self.assertEqual(len(data['candidates']),1)
            key = data['candidates'][0]['source_key']
            self.assertEqual(self.check(record,[key]).status_code,200)
        with patch('services.meal_guest_card_service.CardDBClient.meal_records',return_value=[{**row,'amount':'99'}]):
            self.assertEqual(self.check(record).status_code,409)
        rows = self.client.get('/api/meal-ledgers/external?month=2026-09',headers=self.headers).get_json()
        self.assertEqual(rows[0]['actual_amount'],100)

    def test_overpayment_and_unselected_and_foreign_account_cannot_be_claimed(self):
        self.enable_database()
        record = self.linked(self.card())
        remote = [dict(source='recharge',id=1,emp_no='G001',time=datetime(2026,9,30,10),amount='101'),
                  dict(source='recharge',id=2,emp_no='OTHER',time=datetime(2026,9,30,10),amount='100')]
        with patch('services.meal_guest_card_service.CardDBClient.meal_records',return_value=remote):
            candidates = self.check(record).get_json()['candidates']
            self.assertEqual(len(candidates),1)
            self.assertEqual(self.check(record,[candidates[0]['source_key']]).status_code,409)
            self.assertEqual(self.check(record,['fake']).status_code,409)

    def test_staff_payment_source_cannot_be_claimed_by_guest(self):
        from models import db
        from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketPayment
        from services.meal_ticket_service import digest
        self.enable_database()
        record = self.linked(self.card())
        row = dict(source='recharge',id=9,emp_no='G001',time=datetime(2026,9,30,10),amount='100')
        with patch('services.meal_guest_card_service.CardDBClient.meal_records',return_value=[row]):
            key = self.check(record).get_json()['candidates'][0]['source_key']
            with self.app.app_context():
                from models.account_set import AccountSet
                batch = MealTicketBatch(account_set_id=AccountSet.query.first().id,month='2026-08',recharge_month='2026-09',rule_version=1,rate_cents=800,
                    status='confirmed',version=1,source_digest='test',created_by='admin')
                db.session.add(batch);db.session.flush()
                item = MealTicketItem(emp_id=self.emp_id,batch_key=batch.key,month='2026-08',emp_no_snapshot='G001',name='卡',
                    dept_name='部',is_manager=False,days=1,base_cents=10000,source={},error='')
                db.session.add(item);db.session.flush()
                db.session.add(MealTicketPayment(item_key=item.key,month='2026-08',kind='recharge',
                    amount_cents=10000,payment_date=row['time'].date(),reference='test',operator='admin',
                    request_key=key,request_digest=digest('test')))
                db.session.commit()
            result = self.check(record).get_json()
            self.assertTrue(result['candidates'][0]['occupied'])
            self.assertEqual(self.check(record,[key]).status_code,409)

    def test_registry_and_matching_require_admin(self):
        from models import db
        from models.user import User
        from routes.auth_helpers import generate_token
        with self.app.app_context():
            viewer = db.session.query(User).filter_by(username='viewer').one()
            viewer.page_permissions={'meal_ledger_query':True}
            db.session.commit()
            headers={'Authorization':'Bearer '+generate_token(viewer)}
        self.assertEqual(self.client.get('/api/meal-ledgers/guest-cards',headers=headers).status_code,200)
        self.assertEqual(self.client.post('/api/meal-ledgers/guest-cards',json={},headers=headers).status_code,403)
        self.assertEqual(self.client.put('/api/meal-ledgers/guest-cards/missing',json={'name':'改名'},headers=headers).status_code,403)
        self.assertEqual(self.client.post('/api/meal-ledgers/records/1/recharge-check',json={},headers=headers).status_code,403)

    def test_staff_reconcile_cannot_reuse_guest_source(self):
        self.enable_database()
        self.post = ledger_tests.MealLedgerTests.post.__get__(self)
        self.generate = ledger_tests.MealLedgerTests.generate.__get__(self)
        batch = ledger_tests.MealLedgerTests.confirm(self,self.generate())
        record = self.linked(self.card(emp_no='001'))
        row = dict(source='recharge',id=19,emp_no='001',time=datetime(2026,9,30,10),amount='100')
        with patch('services.meal_guest_card_service.CardDBClient.meal_records',return_value=[row]):
            key = self.check(record).get_json()['candidates'][0]['source_key']
            self.assertEqual(self.check(record,[key]).status_code,200)
        with patch('services.meal_ticket_reconciliation.CardDBClient.meal_records',return_value=[row]):
            response = self.post('/reconcile', {'batch_id':batch['id'],'version':batch['version'],
                'start_date':'2026-09-01','end_date':'2026-09-30'})
            self.assertEqual(response.status_code,409,response.get_json())

    def test_recharge_lookup_starts_at_business_month_first_and_matches_prepaid_funds(self):
        from datetime import date
        self.enable_database()
        record = self.linked(self.card())  # September 30 visit, prepaid September 1.
        remote = [dict(source='recharge',id=31,emp_no='G001',time=datetime(2026,9,1,10),amount='100')]
        with patch('services.meal_guest_card_service.CardDBClient.meal_records',return_value=remote) as read:
            result = self.check(record)
            self.assertEqual(result.status_code,200,result.get_json())
            read.assert_called_with(date(2026,9,1),date(2026,10,1))
            key = result.get_json()['candidates'][0]['source_key']
            matched = self.check(record,[key])
            self.assertEqual(matched.status_code,200,matched.get_json())
            self.assertEqual(matched.get_json()['record']['recharge_status'],'complete')
        # The range may end before the visit, but never before its business month.
        with patch('services.meal_guest_card_service.CardDBClient.meal_records',return_value=remote):
            response = self.client.post(f'/api/meal-ledgers/records/{record["id"]}/recharge-check',
                json={'end_date':'2026-09-10'},headers=self.headers)
            self.assertEqual(response.status_code,200,response.get_json())
            self.assertEqual(self.client.post(f'/api/meal-ledgers/records/{record["id"]}/recharge-check',
                json={'end_date':'2026-08-31'},headers=self.headers).status_code,400)
