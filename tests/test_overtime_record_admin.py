import unittest
from datetime import datetime

from models import db
from models.overtime import OvertimeRecord
from models.account_set import AccountSet
from tests import test_leave_record_admin as leave_tests


class OvertimeRecordAdminTests(unittest.TestCase):
    setUp = leave_tests.LeaveRecordAdminTests.setUp
    tearDown = leave_tests.LeaveRecordAdminTests.tearDown
    def _add_overtime(self):
        with self.app.app_context():
            row = OvertimeRecord(emp_id=self.manager_id, overtime_no='OT001',
                start_time=datetime(2026, 5, 13, 18), end_time=datetime(2026, 5, 13, 21),
                effective_hours=0.125, reason='核算工资', approval_status='已审批')
            db.session.add(row)
            db.session.commit()
            return row.id

    def test_overtime_revoke_restore_and_calendar(self):
        record_id = self._add_overtime()
        url = f'/api/admin/overtime-records/{record_id}'
        response = self.client.delete(url + '?month=2026-05')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['overtime']['is_revoked'])
        self.assertEqual(payload['calendar']['overtimes'], [])
        self.assertEqual(payload['calendar']['overtime_entries'][0]['overtime_no'], 'OT001')
        self.assertEqual(payload['calendar']['summary']['evening_overtime_hours'], 0)
        from services.daily_override_service import evening_overtime_dates_by_emp
        from services.manager_attendance_service import _overtime_rows_by_employee
        with self.app.app_context():
            self.assertEqual(evening_overtime_dates_by_emp('2026-05', [self.manager_id]), {})
            self.assertEqual(_overtime_rows_by_employee([self.manager_id], '2026-05')[self.manager_id], [])
        response = self.client.post(url + '/restore?month=2026-05')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['calendar']['summary']['evening_overtime_hours'], 3)

    def test_overtime_edit_validation_and_lock(self):
        record_id = self._add_overtime()
        url = f'/api/admin/overtime-records/{record_id}'
        data = dict(month='2026-05', start_time='2026-05-13 18:00',
                    end_time='2026-05-13 22:00', hours=4, reason='工资复核',
                    is_weekend=False, is_holiday=False, salary_option='事后调休')
        response = self.client.put(url, json=data)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['calendar']['summary']['evening_overtime_hours'], 4)
        with self.app.app_context():
            row = db.session.get(OvertimeRecord, record_id)
            self.assertTrue(row.is_manual_edited)
            self.assertAlmostEqual(row.effective_hours, 4 / 24)
        self.assertEqual(self.client.put(url, json={**data, 'hours': -1}).status_code, 400)
        self.assertEqual(self.client.put(url, json={**data, 'end_time': data['start_time']}).status_code, 400)
        with self.app.app_context():
            AccountSet.query.filter_by(month='2026-05').one().is_locked = True
            db.session.commit()
        self.assertEqual(self.client.put(url, json=data).status_code, 400)
        self.assertEqual(self.client.delete(url + '?month=2026-05').status_code, 400)
        self.assertEqual(self.client.post(url + '/restore?month=2026-05').status_code, 400)

    def test_import_preserves_revoked_and_manually_edited_overtime(self):
        from services.import_service import ImportService
        record_id = self._add_overtime()
        headers = ['加班单号', '工号', '开始时间', '结束时间', '有效工时', '加班事由']
        source = ['OT001', 'M001', '2026-05-13 08:00', '2026-05-13 17:00', '0.375', '原始值']
        with self.app.app_context():
            row = db.session.get(OvertimeRecord, record_id)
            row.is_manual_edited = True
            db.session.commit()
            ImportService._import_overtime([headers, source])
            self.assertEqual(row.reason, '核算工资')
            self.assertEqual(row.effective_hours, 0.125)
            row.is_manual_edited = False
            row.is_revoked = True
            db.session.commit()
            ImportService._import_overtime([headers, source])
            self.assertTrue(row.is_revoked)
            self.assertEqual(row.effective_hours, 0.125)

    def test_cross_month_locked_account_and_wrong_month_rejected(self):
        record_id = self._add_overtime()
        url = f'/api/admin/overtime-records/{record_id}'
        self.assertEqual(self.client.delete(url + '?month=2026-04').status_code, 400)
        with self.app.app_context():
            row = db.session.get(OvertimeRecord, record_id)
            row.end_time = datetime(2026, 6, 1, 8)
            db.session.add(AccountSet(month='2026-06', name='六月', is_locked=True))
            db.session.commit()
        self.assertEqual(self.client.delete(url + '?month=2026-05').status_code, 400)
        with self.app.app_context():
            self.assertFalse(db.session.get(OvertimeRecord, record_id).is_revoked)
