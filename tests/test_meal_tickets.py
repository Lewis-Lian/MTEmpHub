import io
import tempfile
import unittest
from datetime import timedelta

from flask import Flask
from openpyxl import load_workbook, Workbook

from models import db
from models.account_set import AccountSet
from models.employee import Employee
from models.employee_attendance_override import EmployeeAttendanceOverride
from models.user import User, UserEmployeeAssignment
from routes import register_routes
from routes.auth_helpers import generate_token
from tests.csrf_helper import attach_origin


class MealTicketTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SECRET_KEY='meal-tests-secret',
            SQLALCHEMY_DATABASE_URI='sqlite:///' + self.tmp.name + '/test.db',
            SQLALCHEMY_TRACK_MODIFICATIONS=False, JWT_EXPIRES_DELTA=timedelta(hours=12),
            FRONTEND_ORIGIN='http://localhost:5173', UPLOAD_FOLDER=self.tmp.name,
            BACKUP_PRIVATE_DIR=self.tmp.name + '/private')
        db.init_app(self.app)
        register_routes(self.app)
        with self.app.app_context():
            db.create_all()
            admin = User(username='admin', role='admin', password_hash='unused')
            viewer = User(username='viewer', role='readonly', password_hash='unused',
                          page_permissions={'meal_ticket_query': True})
            emp = Employee(emp_no='001', name='员工甲')
            other = Employee(emp_no='002', name='员工乙')
            account = AccountSet(month='2026-08', name='八月', is_locked=True)
            db.session.add_all([admin, viewer, emp, other, account])
            db.session.flush()
            db.session.add_all([
                EmployeeAttendanceOverride(emp_id=emp.id, month='2026-08', actual_attendance_days=22),
                EmployeeAttendanceOverride(emp_id=other.id, month='2026-08', actual_attendance_days=0),
                UserEmployeeAssignment(user_id=viewer.id, emp_id=emp.id)])
            db.session.commit()
            self.emp_id, self.other_id, self.admin_id = emp.id, other.id, admin.id
            self.admin_token, self.viewer_token = generate_token(admin), generate_token(viewer)
        self.client = attach_origin(self.app.test_client())
        self.headers = {'Authorization': 'Bearer ' + self.admin_token}

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
        self.tmp.cleanup()

    def post(self, path, data):
        return self.client.post('/api/meal-tickets' + path, json=data, headers=self.headers)

    def generate(self):
        r = self.post('/generate', {'recharge_month': '2026-09'})
        self.assertEqual(r.status_code, 200, r.get_json())
        return r.get_json()

    def confirm(self, batch):
        r = self.post('/confirm', {'batch_id': batch['id'], 'version': batch['version']})
        self.assertEqual(r.status_code, 200, r.get_json())
        return r.get_json()

    def adjustment(self, batch, amount):
        r = self.post('/adjustments', {'batch_id': batch['id'], 'version': batch['version'],
            'item_id': batch['items'][0]['id'], 'amount': amount, 'reason': '额外情况'})
        self.assertEqual(r.status_code, 200, r.get_json())
        return r.get_json()

    def test_navigation_places_meal_tickets_immediately_after_query_center(self):
        response = self.client.get('/api/query/navigation', headers=self.headers)
        self.assertEqual(response.status_code, 200)
        slugs = [module['slug'] for module in response.get_json()['modules']]
        self.assertEqual(slugs[slugs.index('query') + 1], 'meal-tickets')

    def test_final_field_next_month_and_no_rounding(self):
        with self.app.app_context():
            EmployeeAttendanceOverride.query.filter_by(emp_id=self.emp_id).one().actual_attendance_days = 22.25
            db.session.commit()
        batch = self.generate()
        self.assertEqual(batch['month'], '2026-08')
        self.assertEqual(batch['recharge_month'], '2026-09')
        self.assertEqual(batch['items'][0]['days'], 22.25)
        self.assertEqual(batch['items'][0]['base_amount'], 178)
        self.assertEqual(batch['departments'][0]['due_amount'], 178)
        self.assertEqual(batch['rate_cents'], 800)
        self.assertEqual(batch['rule_version'], 'actual-days-v1')

    def test_adjustment_partial_payment_refund_and_idempotency(self):
        batch = self.adjustment(self.generate(), '16')
        batch = self.confirm(batch)
        body = {'batch_id': batch['id'], 'version': batch['version'], 'item_id': batch['items'][0]['id'],
                'amount': '176', 'kind': 'recharge', 'date': '2026-09-05',
                'reference': '凭证一', 'request_key': 'unique-payment-1'}
        paid = self.post('/payments', body)
        self.assertEqual(paid.status_code, 200, paid.get_json())
        self.assertEqual(paid.get_json()['items'][0]['difference'], 16)
        retry = self.post('/payments', body)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(len(retry.get_json()['items'][0]['payments']), 1)
        body['amount'] = '175'
        self.assertEqual(self.post('/payments', body).status_code, 409)
        batch = self.adjustment(paid.get_json(), '-24')
        self.assertEqual(batch['items'][0]['difference'], -8)
        body.update(version=batch['version'], amount='8', kind='refund', request_key='refund-1')
        batch = self.post('/payments', body).get_json()
        self.assertEqual(batch['items'][0]['difference'], 0)
        self.assertEqual(batch['items'][0]['paid_amount'], 168)

    def test_confirm_detects_changed_source_and_frozen_batch(self):
        batch = self.generate()
        with self.app.app_context():
            EmployeeAttendanceOverride.query.filter_by(emp_id=self.emp_id).one().actual_attendance_days = 23
            db.session.commit()
        self.assertEqual(self.post('/confirm', {'batch_id': batch['id'], 'version': batch['version']}).status_code, 409)
        batch = self.confirm(self.generate())
        self.assertEqual(self.post('/generate', {'recharge_month': '2026-09'}).status_code, 409)
        with self.app.app_context():
            EmployeeAttendanceOverride.query.filter_by(emp_id=self.emp_id).one().actual_attendance_days = 24
            db.session.commit()
        r = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers)
        self.assertTrue(r.get_json()['source_changed'])
        self.assertEqual(r.get_json()['items'][0]['base_amount'], 184)

    def test_permissions_export_and_delete_guard(self):
        batch = self.generate()
        viewer = {'Authorization': 'Bearer ' + self.viewer_token}
        r = self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=viewer)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.get_json()['items']), 1)
        self.assertEqual(self.client.post('/api/meal-tickets/generate', json={'recharge_month':'2026-09'}, headers=viewer).status_code, 403)
        exported = self.client.get('/api/meal-tickets/export?recharge_month=2026-09', headers=viewer)
        self.assertEqual(exported.status_code, 200)
        book = load_workbook(io.BytesIO(exported.data))
        self.assertEqual(book.sheetnames, ['人员明细', '部门汇总'])
        self.assertEqual(book['人员明细'].max_row, 4)
        self.assertEqual(self.client.delete(f'/api/admin/employees/{self.emp_id}', headers=self.headers).status_code, 409)

    def test_locked_source_required_and_missing_source_blocked(self):
        with self.app.app_context():
            db.session.add(Employee(emp_no='003', name='无来源'))
            db.session.commit()
        batch = self.generate()
        self.assertTrue(any(i['error'] for i in batch['items']))
        self.assertEqual(self.post('/confirm', {'batch_id':batch['id'], 'version':batch['version']}).status_code, 400)

    def test_historical_preview_confirm_and_department_not_added(self):
        book = Workbook()
        s = book.active
        s.title = '员工充值记录'
        s.append(['部门名称','人员编号','人员名称','实际充值金额'])
        s.append(['未分配部门','001','员工甲',176])
        t = book.create_sheet('菜票登记')
        t.append(['部门','金额','登记人','备注'])
        t.append(['未分配部门',176,None,None])
        stream = io.BytesIO()
        book.save(stream)
        r = self.client.post('/api/meal-tickets/imports', data={
            'file': (io.BytesIO(stream.getvalue()), 'history.xlsx'), 'month': '2026-08', 'month_kind': 'attendance'}, headers=self.headers)
        self.assertEqual(r.status_code, 200, r.get_json())
        preview = r.get_json()
        self.assertEqual(preview['person_total'], 176)
        self.assertEqual(preview['department_total'], 176)
        self.assertEqual(preview['status'], 'preview')
        compared = self.client.get(f"/api/meal-tickets/imports/{preview['id']}/comparison", headers=self.headers)
        self.assertEqual(compared.status_code, 200)
        self.assertEqual(compared.get_json()[0]['base_amount'], 176)
        self.assertEqual(compared.get_json()[0]['difference'], 0)
        self.assertIsNone(self.client.get('/api/meal-tickets?recharge_month=2026-09', headers=self.headers).get_json())
        result = self.post(f"/imports/{preview['id']}/confirm", {'rows': preview['rows']})
        self.assertEqual(result.status_code, 200, result.get_json())
        self.assertEqual(result.get_json()['person_total'], 176)
        batch = self.generate()
        self.assertEqual(batch['items'][0]['paid_amount'], 0)

    def test_backup_round_trip_preserves_meal_records_and_original_file(self):
        from services.account_set_backup_service import export_backup, read_backup
        batch = self.confirm(self.generate())
        with self.app.app_context():
            account = AccountSet.query.filter_by(month='2026-08').one()
            document = read_backup(export_backup(account.id))
            self.assertEqual(document['datasets']['meal_batches'][0]['status'], 'confirmed')
            self.assertEqual(len(document['datasets']['meal_items']), 2)
            self.assertEqual(document['datasets']['meal_items'][0]['base_cents'], 17600)

    def test_manager_punch_field_and_cross_year(self):
        from unittest.mock import patch
        with self.app.app_context():
            emp = db.session.get(Employee, self.emp_id)
            emp.is_manager = True
            db.session.commit()
        with patch('services.meal_ticket_service.build_manager_rows', return_value=[{'emp_id':self.emp_id, 'punch_days':7, 'actual_attendance_days':20}]), \
             patch('services.meal_ticket_service.selected_monthly_report_raw', return_value={'source':'present'}):
            batch = self.generate()
        self.assertEqual(batch['items'][0]['base_amount'], 56)
        from services.meal_ticket_service import shift_month
        self.assertEqual(shift_month('2027-01', -1), '2026-12')

    def test_reversal_is_once_and_preserves_original(self):
        batch = self.confirm(self.generate())
        body = {'batch_id':batch['id'], 'version':batch['version'], 'item_id':batch['items'][0]['id'],
                'amount':'176', 'kind':'recharge', 'date':'2026-09-05', 'reference':'原凭证', 'request_key':'p1'}
        batch = self.post('/payments',body).get_json()
        original = batch['items'][0]['payments'][0]['id']
        body.update(version=batch['version'], kind='reversal', reversal_id=original, amount='0', request_key='reverse1', reference='登记错误')
        batch = self.post('/payments',body).get_json()
        self.assertEqual(batch['items'][0]['paid_amount'], 0)
        self.assertTrue(batch['items'][0]['payments'][0]['reversed'])
        body.update(version=batch['version'], request_key='reverse2')
        self.assertEqual(self.post('/payments',body).status_code,409)

    def test_invalid_and_excess_payment_and_stale_version_rejected(self):
        batch = self.generate()
        old_version = batch['version']
        batch = self.adjustment(batch,'1.50')
        self.assertEqual(self.post('/adjustments', {'batch_id':batch['id'], 'version':old_version,
            'item_id':batch['items'][0]['id'], 'amount':'1', 'reason':'重复旧页面'}).status_code,409)
        self.assertEqual(self.post('/adjustments', {'batch_id':batch['id'], 'version':batch['version'],
            'item_id':batch['items'][0]['id'], 'amount':'NaN', 'reason':'无效'}).status_code,400)
        batch = self.confirm(batch)
        body = {'batch_id':batch['id'], 'version':batch['version'], 'item_id':batch['items'][0]['id'],
            'amount':'178', 'kind':'recharge', 'date':'2026-09-01', 'reference':'超发', 'request_key':'overpay'}
        self.assertEqual(self.post('/payments',body).status_code,400)

    def test_recalculation_preserves_adjustment_and_unlocked_blocks_confirmation(self):
        batch = self.adjustment(self.generate(),'16')
        batch = self.generate()
        self.assertEqual(batch['items'][0]['due_amount'],192)
        with self.app.app_context():
            AccountSet.query.first().is_locked = False
            db.session.commit()
        self.assertEqual(self.post('/confirm',{'batch_id':batch['id'], 'version':batch['version']}).status_code,400)

    def test_missing_formula_cache_can_be_corrected_but_requires_reason(self):
        book = Workbook(); s = book.active; s.title='员工充值记录'
        s.append(['部门名称','人员编号','人员名称','实际充值金额'])
        s.append(['未分配部门','001','员工甲','=22*8'])
        stream=io.BytesIO(); book.save(stream)
        r=self.client.post('/api/meal-tickets/imports',data={'file':(io.BytesIO(stream.getvalue()),'formula.xlsx'),
            'month':'2026-09','month_kind':'recharge'}, headers=self.headers)
        preview=r.get_json()
        self.assertEqual(preview['month'],'2026-08')
        self.assertIsNone(preview['rows'][0]['amount'])
        self.assertTrue(preview['rows'][0]['error'])
        preview['rows'][0]['amount']=176
        self.assertEqual(self.post(f"/imports/{preview['id']}/confirm",{'rows':preview['rows']}).status_code,400)
        preview['rows'][0]['correction_reason']='按原纸账核对金额'
        self.assertEqual(self.post(f"/imports/{preview['id']}/confirm",{'rows':preview['rows']}).status_code,200)

    def test_history_file_and_restore_round_trip(self):
        from services.account_set_backup_service import export_backup,read_backup
        from services.account_set_restore_service import build_preview,restore_backup
        from models.meal_ticket import MealTicketImport
        book=Workbook(); s=book.active; s.title='员工充值记录'
        s.append(['部门名称','人员编号','人员名称','实际充值金额'])
        s.append(['未分配部门','001','员工甲',176])
        stream=io.BytesIO(); book.save(stream)
        self.client.post('/api/meal-tickets/imports',data={'file':(io.BytesIO(stream.getvalue()),'original.xlsx'),
            'month':'2026-08','month_kind':'attendance'}, headers=self.headers)
        self.confirm(self.generate())
        with self.app.app_context():
            document=read_backup(export_backup(AccountSet.query.first().id))
            self.assertIn(stream.getvalue(),document['_files'].values())
            db.session.remove(); db.drop_all(); db.create_all()
            db.session.add(User(id=self.admin_id,username='admin',role='admin',password_hash='unused'))
            db.session.commit()
            options={'employees':True,'departments':True,'shifts':True}
            result=build_preview(document,options)
            choices={r['key']:'backup' for r in result['rows'] if r['enabled']}
            restore_backup(document,options,choices,result['fingerprint'],self.admin_id)
            self.assertEqual(MealTicketImport.query.one().status,'preview')
            from pathlib import Path
            self.assertEqual(Path(MealTicketImport.query.one().stored_path).read_bytes(),stream.getvalue())

    def test_restore_cannot_add_payment_to_different_retained_snapshot(self):
        from services.account_set_backup_service import collect_backup
        from services.account_set_restore_service import build_preview, validate_selection
        from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketPayment
        batch=self.confirm(self.generate())
        self.post('/payments', {'batch_id':batch['id'],'version':batch['version'],'item_id':batch['items'][0]['id'],
            'amount':'176','kind':'recharge','date':'2026-09-01','reference':'原凭证','request_key':'restore-payment'})
        with self.app.app_context():
            document=collect_backup(AccountSet.query.first().id)
            MealTicketPayment.query.delete()
            MealTicketBatch.query.one().status='draft'
            MealTicketItem.query.filter_by(emp_id=self.emp_id).one().base_cents=16000
            AccountSet.query.first().is_locked=False
            db.session.commit()
            p=build_preview(document,{})
            self.assertTrue(validate_selection(document,{},p['rows'],{}))

    def test_unlock_and_equal_total_source_correction_are_visible(self):
        from models.daily_attendance_override import DailyAttendanceOverride
        from datetime import date
        batch=self.generate()
        with self.app.app_context():
            db.session.add(DailyAttendanceOverride(emp_id=self.emp_id,record_date=date(2026,8,1),remark='新的核对说明'))
            db.session.commit()
        self.assertEqual(self.post('/confirm',{'batch_id':batch['id'],'version':batch['version']}).status_code,409)
        self.confirm(self.generate())
        with self.app.app_context():
            AccountSet.query.first().is_locked=False; db.session.commit()
        self.assertTrue(self.client.get('/api/meal-tickets?recharge_month=2026-09',headers=self.headers).get_json()['source_changed'])

    def test_conflicting_year_requires_explicit_confirmation(self):
        book=Workbook(); s=book.active; s.title='员工充值记录'
        s.append(['2025年8月充值']); s.append(['部门名称','人员编号','人员名称','实际充值金额'])
        s.append(['未分配部门','001','员工甲',176]); stream=io.BytesIO(); book.save(stream)
        r=self.client.post('/api/meal-tickets/imports',data={'file':(io.BytesIO(stream.getvalue()),'2025年8月充值.xlsx'),
            'month':'2026-08','month_kind':'attendance'},headers=self.headers)
        preview=r.get_json()
        self.assertTrue(preview['rows'][0]['period_conflict'])
        self.assertEqual(self.post(f"/imports/{preview['id']}/confirm",{'rows':preview['rows']}).status_code,400)


if __name__ == '__main__':
    unittest.main()
