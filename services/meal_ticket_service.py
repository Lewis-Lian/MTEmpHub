"""Monthly meal subsidies use the existing final attendance fields without reinterpreting punches."""
from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import json
import re

from sqlalchemy import or_, text

from models import db
from models.account_set import AccountSet
from models.employee import Employee
from models.employee_attendance_override import EmployeeAttendanceOverride
from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketAdjustment, MealTicketPayment
from services.attendance_source_service import (
    attendance_views_by_employee, attendance_source_for_context, selected_monthly_report_raw,
    EMPLOYEE_STATS_CONTEXT, MANAGER_STATS_CONTEXT,
)
from services.daily_override_service import daily_override_maps
from services.manager_attendance_service import build_manager_rows, ManagerAttendanceOptions


class MealError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def shift_month(month, offset):
    if not isinstance(month, str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
        raise MealError('月份格式应为 YYYY-MM')
    number = int(month[:4]) * 12 + int(month[5:]) - 1 + offset
    year, index = divmod(number, 12)
    if not 1 <= year <= 9999:
        raise MealError('月份超出范围')
    return f'{year:04d}-{index + 1:02d}'


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def cents(value):
    try:
        if isinstance(value, bool):
            raise InvalidOperation
        amount = Decimal(str(value))
        if not amount.is_finite() or amount != amount.quantize(Decimal('.01')) or abs(amount) > Decimal('10000000'):
            raise InvalidOperation
        return int(amount * 100)
    except (InvalidOperation, ValueError, TypeError):
        raise MealError('金额必须是最多两位小数的有效数值')


def required_text(value, label, limit=500):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise MealError(f'{label}不能为空且不能超过 {limit} 字')
    return value.strip()


def begin_write():
    # Authentication has already queried this session. Start a fresh transaction
    # and serialize writers on SQLite; MySQL locks the batch below.
    db.session.rollback()
    if db.engine.dialect.name == 'sqlite':
        db.session.execute(text('BEGIN IMMEDIATE'))


def batch_for_write(identifier, version):
    if type(identifier) is not int or type(version) is not int:
        raise MealError('核算批次和版本无效')
    batch = MealTicketBatch.query.filter_by(id=identifier).with_for_update().first()
    if not batch:
        raise MealError('核算批次不存在', 404)
    if batch.version != version:
        raise MealError('数据已变化，请刷新后操作', 409)
    return batch


def source_snapshot(month):
    # These are the very same final result builders used by the query pages.
    from routes.query_core import _build_final_rows
    first = date.fromisoformat(month + '-01')
    employees = Employee.query.filter(or_(Employee.resigned_at.is_(None), Employee.resigned_at >= first)).order_by(Employee.emp_no).all()
    ordinary = [e for e in employees if not e.is_manager]
    managers = [e for e in employees if e.is_manager]
    employee_values = {str(row[1]): row[4] for row in _build_final_rows(month, [e.id for e in ordinary])}
    manager_values = {row['emp_id']: row['punch_days'] for row in build_manager_rows(
        ManagerAttendanceOptions(month=month), [e.id for e in managers], include_resigned=True)}
    overrides = {r.emp_id:r for r in EmployeeAttendanceOverride.query.filter_by(month=month).all()}
    daily = daily_override_maps(month, [e.id for e in employees])
    views = {}
    for group, context in ((ordinary, EMPLOYEE_STATS_CONTEXT), (managers, MANAGER_STATS_CONTEXT)):
        views.update(attendance_views_by_employee(month, group, context))
    result = []
    for emp in employees:
        context = MANAGER_STATS_CONTEXT if emp.is_manager else EMPLOYEE_STATS_CONTEXT
        value = manager_values.get(emp.id) if emp.is_manager else employee_values.get(emp.emp_no)
        override = overrides.get(emp.id) if not emp.is_manager else None
        source = {'context':context, 'configured_source':attendance_source_for_context(emp, context),
                  'field':'punch_days' if emp.is_manager else 'actual_attendance_days',
                  'monthly_override':override.actual_attendance_days if override else None,
                  'remark':override.remark if override else None}
        source['daily_corrections'] = [
            {'date':day.isoformat(), 'actual':record.is_actual_attendance, 'remark':record.remark}
            for day, record in sorted(daily.get(emp.id, {}).items())]
        source['selected_sources'] = sorted({view.source for view in views.get(emp.id, [])})
        source['evidence_digest'] = digest([
            {'date':view.record_date.isoformat() if view.record_date else None,
             'source':view.source, 'in':[str(x) for x in view.check_in_times],
             'out':[str(x) for x in view.check_out_times], 'raw':view.raw_data}
            for view in sorted(views.get(emp.id, []), key=lambda v: str(v.record_date))])
        error = ''
        has_source = bool(views.get(emp.id) or daily.get(emp.id) or selected_monthly_report_raw(emp, month, context))
        has_source = has_source or (override is not None and override.actual_attendance_days is not None)
        if not has_source:
            error = '缺少考勤来源，请核对'
        try:
            days = Decimal(str(value))
            if not days.is_finite() or days < 0 or days > monthrange(first.year, first.month)[1]:
                raise InvalidOperation
            base = int((days * 800).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        except (InvalidOperation, ValueError, TypeError):
            error, days, base = '实际打卡天数字段异常，请先修正考勤', Decimal(0), 0
        result.append({'emp_id':emp.id, 'emp_no_snapshot':emp.emp_no, 'name':emp.name,
            'dept_name':emp.department.dept_name if emp.department else '未分配部门',
            'is_manager':bool(emp.is_manager), 'days':float(days), 'base_cents':base,
            'source':source, 'error':error})
    return result


def generate(recharge_month, operator):
    month = shift_month(recharge_month, -1)
    account = AccountSet.query.filter_by(month=month).with_for_update().first()
    if not account:
        raise MealError(f'请先建立 {month} 考勤账套')
    batch = MealTicketBatch.query.filter_by(month=month).with_for_update().first()
    if batch and batch.status != 'draft':
        raise MealError('已确认的核算不能重算，请通过额外补扣处理', 409)
    rows = source_snapshot(month)
    if not rows and not batch:
        raise MealError('没有可核算人员')
    if not batch:
        batch = MealTicketBatch(month=month, recharge_month=recharge_month, account_set_id=account.id,
                               source_digest=digest(rows), created_by=operator)
        db.session.add(batch)
        db.session.flush()
    else:
        batch.version += 1
        batch.source_digest = digest(rows)
    existing = {r.emp_id:r for r in MealTicketItem.query.filter_by(batch_key=batch.key).all()}
    for data in rows:
        item = existing.pop(data['emp_id'], None)
        if item is None:
            db.session.add(MealTicketItem(batch_key=batch.key, month=month, **data))
        else:
            if 'participation_history' in item.source:
                data['source']['participation_history'] = item.source['participation_history']
            for name, value in data.items():
                setattr(item, name, value)
    for removed in existing.values():
        removed.error = '人员已移出当前考勤范围，请核对'
    db.session.flush()
    return batch


def confirm(batch, operator):
    if batch.status != 'draft':
        raise MealError('该核算已确认', 409)
    account = AccountSet.query.filter_by(id=batch.account_set_id).with_for_update().one()
    if not account.is_locked:
        raise MealError('请先核对并锁定源考勤账套')
    if digest(source_snapshot(batch.month)) != batch.source_digest:
        raise MealError('考勤字段或人员资料已变化，请重算草稿', 409)
    rows = serialize_batch(batch)['items']
    if any((row['error'] and not row['excluded']) or row['due_amount'] < 0 for row in rows):
        raise MealError('存在待核对人员或负数应发金额，不能确认')
    batch.status, batch.confirmed_by, batch.confirmed_at = 'confirmed', operator, datetime.utcnow()
    batch.version += 1


def unconfirm(batch):
    if batch.status != 'confirmed':
        raise MealError('只有已确认的核算可以退回草稿', 409)
    has_payments = MealTicketPayment.query.join(
        MealTicketItem, MealTicketPayment.item_key == MealTicketItem.key
    ).filter(MealTicketItem.batch_key == batch.key).first()
    if has_payments:
        raise MealError('已登记发放流水，不能退回草稿，请通过补扣或冲正处理', 409)
    batch.status = 'draft'
    batch.confirmed_by = None
    batch.confirmed_at = None
    batch.version += 1


def item_for_batch(batch, identifier):
    if type(identifier) is not int:
        raise MealError('人员明细无效')
    item = MealTicketItem.query.filter_by(batch_key=batch.key, id=identifier).first()
    if not item:
        raise MealError('人员明细不存在', 404)
    return item


def adjustment(batch, item_id, amount, reason, operator):
    item = item_for_batch(batch, item_id)
    if batch.status == 'draft' and participation_state(item).get('excluded'):
        raise MealError('本月不发人员请先恢复核算，再登记补扣')
    value = cents(amount)
    if value == 0:
        raise MealError('调整金额不能为零')
    if batch.status == 'confirmed' and totals(item)[0] + value < 0:
        raise MealError('调整后应发金额不能为负数')
    db.session.add(MealTicketAdjustment(item_key=item.key, month=batch.month, amount_cents=value,
        reason=required_text(reason, '调整原因'), operator=operator))
    batch.version += 1
    db.session.flush()


def participation_state(item):
    history = item.source.get('participation_history', [])
    return history[-1] if history else {}


def participation(batch, item_id, excluded, reason, operator):
    if batch.status != 'draft':
        raise MealError('已确认核算不能更改发放选择，请通过额外补扣处理', 409)
    if type(excluded) is not bool:
        raise MealError('发放选择必须为布尔值')
    item = item_for_batch(batch, item_id)
    reason = required_text(reason, '核算处理原因')
    adjustments = MealTicketAdjustment.query.filter_by(item_key=item.key).all()
    entry = {'excluded':excluded, 'reason':reason, 'operator':operator,
             'created_at':datetime.utcnow().isoformat(),
             'adjustment_cents':sum(a.amount_cents for a in adjustments)}
    item.source = {**item.source, 'participation_history':[
        *item.source.get('participation_history', []), entry]}
    batch.version += 1
    db.session.flush()


def totals(item):
    adjustments = MealTicketAdjustment.query.filter_by(item_key=item.key).all()
    payments = MealTicketPayment.query.filter_by(item_key=item.key).order_by(MealTicketPayment.id).all()
    due = item.base_cents + sum(a.amount_cents for a in adjustments)
    state = participation_state(item)
    if state.get('excluded'):
        due -= item.base_cents + state['adjustment_cents']
    paid = sum(p.amount_cents for p in payments)
    return due, paid, adjustments, payments


def payment_payload(body):
    return {key:body.get(key) for key in ('batch_id','item_id','kind','amount','date','reference','reversal_id')}


def payment(body, operator):
    request_key = required_text(body.get('request_key'), '请求标识', 100)
    if request_key.startswith('card-meal:'):
        raise MealError('请求标识不能使用数据库流水保留前缀')
    request_digest = digest(payment_payload(body))
    existing = MealTicketPayment.query.filter_by(request_key=request_key).first()
    if existing:
        if existing.request_digest != request_digest:
            raise MealError('请求标识已用于不同内容', 409)
        return MealTicketBatch.query.filter_by(key=MealTicketItem.query.filter_by(key=existing.item_key).one().batch_key).one()
    batch = batch_for_write(body.get('batch_id'), body.get('version'))
    if batch.status != 'confirmed':
        raise MealError('请先确认核算再登记充值')
    if MealTicketPayment.query.join(MealTicketItem, MealTicketItem.key == MealTicketPayment.item_key).filter(
            MealTicketItem.batch_key == batch.key,
            MealTicketPayment.request_key.startswith('card-meal:')).first():
        raise MealError('本月已由数据库核对实际流水，请在菜票软件处理并启用数据库重新核对，不可手工重复登记', 409)
    item = item_for_batch(batch, body.get('item_id'))
    amount, kind = cents(body.get('amount')), body.get('kind')
    due, paid, _, _ = totals(item)
    reversal = None
    if kind == 'recharge':
        if amount <= 0 or amount > due - paid:
            raise MealError('充值金额必须大于零且不能超过待发金额')
    elif kind == 'refund':
        if amount <= 0 or amount > paid - due:
            raise MealError('扣回金额必须大于零且不能超过待扣回金额')
        amount = -amount
    elif kind == 'reversal':
        original = MealTicketPayment.query.filter_by(id=body.get('reversal_id'), item_key=item.key).first()
        if not original or original.kind == 'reversal':
            raise MealError('原充值或扣回记录不存在')
        if original.request_key.startswith('card-meal:'):
            raise MealError('数据库实际流水不能手工冲正，请在菜票软件处理后重新核对', 409)
        if MealTicketPayment.query.filter_by(reversal_of=original.key).first():
            raise MealError('该记录已冲正', 409)
        reversal, amount = original.key, -original.amount_cents
    else:
        raise MealError('发放类型无效')
    try:
        payment_date = date.fromisoformat(body.get('date', ''))
    except (ValueError, TypeError):
        raise MealError('实际日期无效')
    db.session.add(MealTicketPayment(item_key=item.key, month=batch.month, kind=kind,
        amount_cents=amount, payment_date=payment_date, reference=required_text(body.get('reference'), '凭证或冲正原因'),
        operator=operator, request_key=request_key, request_digest=request_digest, reversal_of=reversal))
    batch.version += 1
    db.session.flush()
    return batch


def serialize_batch(batch, accessible=None, check_source=False):
    from models.meal_ledger import MealLedgerRecord
    clearances = {}
    for record in MealLedgerRecord.query.filter_by(kind='clearance', month=batch.recharge_month).all():
        clearances.setdefault(record.data.get('emp_no'), []).append({'date':record.record_date.isoformat(),
            'amount':record.amount_cents/100, 'remark':record.data.get('remark', ''), 'voided':record.voided})
    query = MealTicketItem.query.filter_by(batch_key=batch.key).order_by(MealTicketItem.emp_no_snapshot)
    if accessible is not None:
        query = query.filter(MealTicketItem.emp_id.in_(accessible))
    items, departments = [], {}
    for item, employee_id, resigned_at in query.with_entities(
            MealTicketItem, Employee.id, Employee.resigned_at).outerjoin(
                Employee, Employee.id == MealTicketItem.emp_id).all():
        due, paid, adjustments, payments = totals(item)
        excluded = bool(participation_state(item).get('excluded'))
        base = 0 if excluded else item.base_cents
        row = {'id':item.id, 'emp_id':item.emp_id, 'emp_no':item.emp_no_snapshot, 'name':item.name,
               'dept_name':item.dept_name, 'is_manager':item.is_manager, 'days':item.days,
               'base_amount':base / 100, 'adjustment_amount':(due-base)/100,
               'original_base_amount':item.base_cents / 100, 'excluded':excluded,
               'participation_history':item.source.get('participation_history', []),
               'due_amount':due/100, 'paid_amount':paid/100, 'difference':(due-paid)/100,
               'error':item.error, 'source':item.source,
               'clearances':clearances.get(item.emp_no_snapshot, []),
               'employment_status':'missing' if employee_id is None else 'resigned' if resigned_at else 'active',
               'resigned_at':resigned_at.isoformat() if resigned_at else None,
               'adjustments':[{'id':a.id, 'amount':a.amount_cents/100, 'reason':a.reason, 'operator':a.operator,
                               'created_at':a.created_at.isoformat()} for a in adjustments],
               'payments':[{'id':p.id, 'kind':p.kind, 'amount':p.amount_cents/100, 'date':p.payment_date.isoformat(),
                            'reference':p.reference, 'operator':p.operator, 'reversal_of':p.reversal_of,
                            'database_record':p.request_key.startswith('card-meal:'),
                            'reversed':any(other.reversal_of == p.key for other in payments)} for p in payments]}
        items.append(row)
        department = departments.setdefault(item.dept_name, {'dept_name':item.dept_name, 'count':0,
            'base_amount':0, 'adjustment_amount':0, 'due_amount':0, 'paid_amount':0, 'difference':0})
        department['count'] += 1
        for name in ('base_amount','adjustment_amount','due_amount','paid_amount','difference'):
            department[name] = round(department[name] + row[name], 2)
    changed = False
    if check_source:
        account = db.session.get(AccountSet, batch.account_set_id)
        changed = (batch.status == 'confirmed' and not account.is_locked) or digest(source_snapshot(batch.month)) != batch.source_digest
    from services.meal_ticket_reconciliation import database_status
    return {'id':batch.id, 'month':batch.month, 'recharge_month':batch.recharge_month, 'status':batch.status,
            'reconciliation':batch.reconciliation if accessible is None else None,
            'database':database_status(),
            'rule_version':batch.rule_version, 'rate_cents':batch.rate_cents,
            'version':batch.version, 'source_changed':changed, 'created_at':batch.created_at.isoformat(),
            'confirmed_by':batch.confirmed_by, 'items':items, 'departments':list(departments.values())}


def guard_employee_delete(ids):
    from models.meal_ticket import MealTicketImportRow
    return (MealTicketItem.query.filter(MealTicketItem.emp_id.in_(ids)).first() is not None or
            MealTicketImportRow.query.filter(MealTicketImportRow.emp_id.in_(ids)).first() is not None)
