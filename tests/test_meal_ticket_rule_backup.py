"""Restored rules and refund classifications must survive a different local setup."""
from datetime import date

import pytest

from models import db
from models.account_set import AccountSet
from models.daily_record import DailyRecord
from models.employee_attendance_override import EmployeeAttendanceOverride
from models.meal_ledger import MealLedgerRecord
from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketPayment, MealTicketAdjustment
from models.system_setting import SystemSetting
from models.user import User
from services.account_set_backup_service import export_backup, export_multi_backup, read_backup
from services.account_set_restore_service import build_preview, restore_backup, build_multi_preview, restore_multi_backup
from services.meal_ticket_service import generate, confirm, adjustment, attendance_recalculation_preview, recalculate_attendance, totals
from services.monthly_reference_service import ensure_month_reference
from tests.test_account_set_backup import backup_app


@pytest.mark.parametrize('format_version', [1, 2])
@pytest.mark.parametrize('automatic_deduction', [False, True])
def test_restored_settled_rules_and_refund_classes_do_not_reapply_deductions(backup_app, format_version, automatic_deduction):
    account = AccountSet.query.one()
    account.is_locked = True
    record = DailyRecord.query.one()
    record.raw_data = {'刷卡时间数据':'08:00'}
    record.check_in_times = ['08:00']
    db.session.add(EmployeeAttendanceOverride(emp_id=1, month='2026-06', actual_attendance_days=2))
    SystemSetting.set_value('meal_ticket_abnormal_deduction_enabled', 'true' if automatic_deduction else 'false')
    ensure_month_reference('2026-06')
    batch = generate('2026-07', 'admin')
    confirm(batch, 'admin')
    item = MealTicketItem.query.one()
    if not automatic_deduction:
        adjustment(batch, item.id, '-8', '异常刷卡', 'admin')
    db.session.add_all([
        MealTicketPayment(item_key=item.key, month=batch.month, kind='recharge', amount_cents=1600,
            payment_date=date(2026,7,1), reference='发放', operator='admin', request_key='recharge', request_digest='r'),
        MealTicketPayment(item_key=item.key, month=batch.month, kind='refund', amount_cents=-800,
            payment_date=date(2026,7,2), reference='异常扣回', operator='admin',
            request_key='card-meal:original:refund:1', request_digest='f'),
        MealLedgerRecord(kind='clearance', month='2026-06', record_date=date(2026,6,30), amount_cents=400,
            data={'emp_no':'E1', 'remark':'月末清零', 'database_digest':'clearance-digest'},
            request_key='clearance', request_digest='c', source_key='card-meal:original:refund:2', operator='admin'),
    ])
    db.session.commit()
    assert totals(item)[:2] == (800, 800)
    document = read_backup(export_backup(account.id) if format_version == 1 else export_multi_backup([account.id]),
                           normalized=format_version == 2)
    db.session.remove()
    db.drop_all()
    db.create_all()
    db.session.add(User(id=901, username='operator', role='admin', password_hash='unused'))
    # Installation settings deliberately differ from the restored business month.
    SystemSetting.set_value('meal_ticket_abnormal_deduction_enabled', 'false' if automatic_deduction else 'true')
    db.session.commit()
    if format_version == 1:
        options = {'employees':True, 'departments':True, 'shifts':True}
        preview = build_preview(document, options)
        choices = {row['key']:'backup' for row in preview['rows'] if row['enabled']}
        restore_backup(document, options, choices, preview['fingerprint'], 901)
    else:
        selection = {'months':['2026-06'], 'categories':['account_settings', 'departments', 'employees', 'shifts', 'attendance', 'meal_tickets', 'meal_ledgers']}
        preview = build_multi_preview(document, selection)
        assert preview['blockers'] == []
        restore_multi_backup(document, selection, {}, preview['fingerprint'], 901)
    batch, item = MealTicketBatch.query.one(), MealTicketItem.query.one()
    refund = MealTicketPayment.query.filter_by(kind='refund').one()
    clearance = MealLedgerRecord.query.one()
    assert (refund.amount_cents, refund.request_key) == (-800, 'card-meal:original:refund:1')
    assert (clearance.kind, clearance.amount_cents, clearance.source_key) == ('clearance', 400, 'card-meal:original:refund:2')
    assert clearance.data['database_digest'] == 'clearance-digest'
    assert totals(item)[:2] == (800, 800)
    preview = attendance_recalculation_preview(batch)
    assert preview['issues'] == []
    assert preview['total_amount'] == 0
    recalculate_attendance(batch, preview['source_digest'], 'operator')
    assert attendance_recalculation_preview(batch)['total_amount'] == 0
    override = EmployeeAttendanceOverride.query.one()
    override.actual_attendance_days = 3
    db.session.flush()
    changed = attendance_recalculation_preview(batch)
    assert changed['total_amount'] == 8
    recalculate_attendance(batch, changed['source_digest'], 'operator')
    assert attendance_recalculation_preview(batch)['total_amount'] == 0
    assert totals(item)[:2] == (1600, 800)
    assert MealTicketPayment.query.count() == 2
    assert MealLedgerRecord.query.count() == 1
    if not automatic_deduction:
        assert MealTicketAdjustment.query.filter_by(reason='异常刷卡').one().amount_cents == -800
