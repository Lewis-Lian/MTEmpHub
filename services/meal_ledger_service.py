"""Separate ledgers for card recovery, guests, consumption and department notes."""
from datetime import date, datetime

from models import db
from models.meal_ledger import MealLedgerRecord
from models.meal_ticket import MealTicketBatch, MealTicketPayment
from services.meal_ticket_service import MealError, cents, digest, required_text, shift_month, serialize_batch

KINDS = ('external', 'clearance', 'consumption', 'department')


def month_checked(value):
    shift_month(value, 0)
    return value


def text_field(body, key, limit=500):
    value = body.get(key, '')
    if value is None:
        return ''
    if not isinstance(value, str) or len(value) > limit:
        raise MealError(f'{key} 格式或长度无效')
    return value.strip()


def validated(kind, body):
    if kind not in KINDS:
        raise MealError('台账类型无效')
    month = month_checked(body.get('month'))
    if kind in ('external', 'clearance') and not body.get('date'):
        raise MealError('处理日期不能为空')
    try:
        day = date.fromisoformat(body.get('date') or month + '-01')
    except (ValueError, TypeError):
        raise MealError('日期无效')
    if day.strftime('%Y-%m') != month:
        raise MealError('日期须属于所选业务月份')
    data = {key: text_field(body, key) for key in (
        'emp_no', 'name', 'dept_name', 'card_no', 'remark', 'registrar', 'unit', 'period', 'days')}
    amount = 0
    slot = None
    if kind in ('external', 'clearance'):
        data['name'] = required_text(body.get('name') or (body.get('unit') if kind == 'external' else None), '人员姓名或外来单位', 100)
        amount = cents(body.get('amount'))
        if amount <= 0:
            raise MealError('金额必须大于零')
        if kind == 'external':
            if body.get('category') not in ('card', 'paper'):
                raise MealError('领用类别须为充卡或纸质')
            data['category'] = body['category']
    elif kind == 'consumption':
        data['floor2_cents'], data['floor3_cents'] = cents(body.get('floor2')), cents(body.get('floor3'))
        if min(data['floor2_cents'], data['floor3_cents']) < 0:
            raise MealError('消费金额不能为负数')
        amount = data['floor2_cents'] + data['floor3_cents']
        for label in ('recharge', 'consumption', 'recovered'):
            value = body.get('historical_' + label)
            if value is not None:
                data['historical_' + label + '_cents'] = cents(value)
        slot = f'consumption:{month}'
    else:
        data['dept_name'] = required_text(body.get('dept_name'), '部门', 100)
        # Historical original amount is only a comparison, never an actual payment.
        if body.get('historical_amount') is not None:
            data['historical_cents'] = cents(body['historical_amount'])
        slot = 'department:' + digest([month, data['dept_name']])
    return month, day, amount, data, slot


def serialize(record):
    data = dict(record.data)
    for key in ('floor2', 'floor3', 'historical'):
        if key + '_cents' in data:
            data[key + '_amount'] = data.pop(key + '_cents') / 100
    return {'id': record.id, 'key': record.key, 'kind': record.kind, 'month': record.month,
        'date': record.record_date.isoformat(), 'amount': record.amount_cents / 100,
        **data, 'operator': record.operator, 'created_at': record.created_at.isoformat(),
        'voided': record.voided, 'void_reason': record.void_reason, 'source_key': record.source_key}


def create(kind, body, operator, source_key=None):
    month, day, amount, data, slot = validated(kind, body)
    request_key = required_text(body.get('request_key'), '请求标识', 100)
    content = digest([kind, month, day.isoformat(), amount, data, source_key])
    old = MealLedgerRecord.query.filter_by(request_key=request_key).first()
    if old:
        if old.request_digest != content:
            raise MealError('同一请求标识的内容不一致', 409)
        return old
    if source_key and MealLedgerRecord.query.filter_by(source_key=source_key).first():
        raise MealError('该来源记录已经登记，请核对避免重复计入', 409)
    if slot:
        previous = MealLedgerRecord.query.filter_by(active_slot=slot).with_for_update().first()
        if previous:
            # Original imported amounts remain available when notes or consumption are corrected.
            for key, value in previous.data.items():
                if key.startswith('historical_') or key in ('import_key', 'source_sheet', 'source_row'):
                    data.setdefault(key, value)
            void(previous, '更新月度登记', operator)
            db.session.flush()
    record = MealLedgerRecord(kind=kind, month=month, record_date=day, amount_cents=amount,
        data=data, active_slot=slot, request_key=request_key, request_digest=content,
        source_key=source_key, operator=operator)
    db.session.add(record)
    db.session.flush()
    return record


def void(record, reason, operator):
    reason = required_text(reason, '作废原因')
    if record.voided:
        raise MealError('记录已作废', 409)
    record.voided = True
    record.active_slot = None
    record.void_reason, record.void_operator, record.voided_at = reason, operator, datetime.utcnow()


def records(kind, month=None, year=None):
    query = MealLedgerRecord.query.filter_by(kind=kind)
    if month:
        query = query.filter_by(month=month_checked(month))
    if year:
        query = query.filter(MealLedgerRecord.month.startswith(str(year) + '-'))
    return query.order_by(MealLedgerRecord.record_date, MealLedgerRecord.id).all()


def departments(month, accessible=None):
    month_checked(month)
    batch = MealTicketBatch.query.filter_by(recharge_month=month).first()
    rows = serialize_batch(batch, accessible)['departments'] if batch else []
    notes = {r.data['dept_name']: r for r in records('department', month) if not r.voided}
    # Historical-only departments are available to whole-company ledger readers.
    if accessible is None:
        known = {r['dept_name'] for r in rows}
        for name in notes.keys() - known:
            rows.append({'dept_name': name, 'count': 0, 'due_amount': 0, 'paid_amount': 0})
    for row in rows:
        note = notes.get(row['dept_name'])
        row.update({'registrar': note.data.get('registrar', '') if note else '',
            'remark': note.data.get('remark', '') if note else '',
            'historical_amount': note.data.get('historical_cents', 0) / 100 if note and 'historical_cents' in note.data else None})
    return {'month': month, 'status': batch.status if batch else 'no_batch', 'items': rows}


def annual(year):
    try:
        if not str(year).isdigit() or not 1 <= int(year) <= 9999:
            raise ValueError
        year = int(year)
    except (ValueError, TypeError):
        raise MealError('年份无效')
    months = []
    payments = MealTicketPayment.query.filter(MealTicketPayment.payment_date >= date(year, 1, 1),
        MealTicketPayment.payment_date <= date(year, 12, 31)).all()
    external = records('external', year=year)
    clearance = records('clearance', year=year)
    consumption = {r.month: r for r in records('consumption', year=year) if not r.voided}
    for index in range(1, 13):
        month = f'{year:04d}-{index:02d}'
        employee = sum(p.amount_cents for p in payments if p.payment_date.month == index)
        card = sum(r.amount_cents for r in external if not r.voided and r.month == month and r.data['category'] == 'card')
        paper = sum(r.amount_cents for r in external if not r.voided and r.month == month and r.data['category'] == 'paper')
        recovered = sum(r.amount_cents for r in clearance if not r.voided and r.month == month)
        consume = consumption.get(month)
        months.append({'month': month, 'employee_amount': employee / 100, 'external_card_amount': card / 100,
            'recharge_amount': (employee + card) / 100, 'paper_amount': paper / 100,
            'floor2_amount': consume.data['floor2_cents'] / 100 if consume else None,
            'floor3_amount': consume.data['floor3_cents'] / 100 if consume else None,
            'consumption_amount': consume.amount_cents / 100 if consume else None,
            'recovered_amount': recovered / 100,
            **{'historical_' + label + '_amount': consume.data.get('historical_' + label + '_cents') / 100
               if consume and consume.data.get('historical_' + label + '_cents') is not None else None
               for label in ('recharge', 'consumption', 'recovered')}})
    totals = {key: sum(int(round(r[key] * 100)) for r in months if r[key] is not None) / 100
        for key in months[0] if key != 'month'}
    return {'year': year, 'months': months, 'totals': totals,
        'consumption_months': sum(r['consumption_amount'] is not None for r in months)}
