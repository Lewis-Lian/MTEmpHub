"""Read-only card DB lookup; explicit, exclusive allocation of actual recharges."""
from datetime import date, datetime, timedelta

from models import db
from models.meal_guest_card import MealGuestCard, MealGuestRecharge
from models.meal_ledger import MealLedgerRecord
from models.meal_ticket import MealTicketPayment
from services.card_db_client import CardDBClient, CardDBClientError, card_db_config_from_settings
from services.meal_ticket_reconciliation import database_status, DATABASE_REQUEST_PREFIX
from services.meal_ticket_service import MealError, begin_write, cents, digest, required_text


def serialize_card(card):
    return {field:getattr(card, field) for field in ('key','card_no','emp_no','name','is_active')}


def register(body, operator):
    values = {key:required_text(body.get(key), label, limit) for key, label, limit in (
        ('card_no','卡号',50), ('emp_no','数据库人员编号',50), ('name','客人卡名称',100))}
    if MealGuestCard.query.filter(db.or_(MealGuestCard.card_no == values['card_no'],
                                       MealGuestCard.emp_no == values['emp_no'])).first():
        raise MealError('卡号或数据库人员编号已登记',409)
    card = MealGuestCard(**values,operator=operator)
    db.session.add(card)
    db.session.flush()
    return card


def card_for_record(body):
    key = body.get('guest_card_key')
    if not key:
        return None
    if body.get('category') != 'card':
        raise MealError('只有充卡领用可以选择客人卡')
    if not isinstance(key,str):
        raise MealError('客人卡编号无效')
    card = MealGuestCard.query.filter_by(key=key).with_for_update().first()
    if not card or not card.is_active:
        raise MealError('客人卡不存在或已停用',409)
    return card


def matched_cents(record):
    return sum(row.amount_cents for row in MealGuestRecharge.query.filter_by(record_key=record.key).all())


def evidence(record):
    if not record.data.get('guest_card_key'):
        return {'actual_amount':record.amount_cents / 100, 'recharge_status':'manual', 'recharges':[]}
    rows = MealGuestRecharge.query.filter_by(record_key=record.key).order_by(MealGuestRecharge.occurred_at, MealGuestRecharge.key).all()
    total = sum(row.amount_cents for row in rows)
    return {'actual_amount':total / 100,
            'recharge_status':'complete' if total == record.amount_cents else 'partial' if total else 'pending',
            'recharges':[{'source_key':row.source_key, 'date':row.occurred_at.isoformat(),
                          'amount':row.amount_cents / 100} for row in rows]}


def actual_cents(record):
    return matched_cents(record) if record.data.get('guest_card_key') else record.amount_cents


def check_recharge(identifier, body, operator):
    record = db.session.get(MealLedgerRecord,identifier)
    if not record or record.kind != 'external' or not record.data.get('guest_card_key'):
        raise MealError('请选择已绑定客人卡的领用记录',404)
    if record.voided:
        raise MealError('已作废领用不能核对充值',409)
    status = database_status()
    if not status['enabled'] or not status['configured']:
        raise MealError('请先在数据来源与同步中启用并配置菜票数据库核对',409)
    try:
        end = date.fromisoformat(body.get('end_date',''))
        end_exclusive = end + timedelta(days=1)
    except (TypeError,ValueError,OverflowError):
        raise MealError('核对结束日期无效')
    start = date.fromisoformat(record.month + '-01')
    if end < start:
        raise MealError('结束日期不能早于业务月份月初')
    selected = body.get('source_keys',[])
    if not isinstance(selected,list) or any(not isinstance(key,str) for key in selected) or len(set(selected)) != len(selected):
        raise MealError('充值流水选择无效')
    guest_key = record.data['guest_card_key']
    original = digest([record.key, record.data, record.record_date.isoformat(), record.amount_cents])
    config = card_db_config_from_settings()
    database_id = digest({'host':config['host'].casefold(), 'port':config.get('port') or 1433,
                          'database':config['database']})[:24]
    try:
        remote = CardDBClient(config).meal_records(start,end_exclusive)
    except CardDBClientError:
        raise MealError('数据库读取失败，充值状态未更新，请检查连接后重试',502) from None
    candidates = {}
    for row in remote:
        if row.get('source') not in ('subsidy','recharge') or row.get('emp_no') != record.data['emp_no']:
            continue
        time = row.get('time')
        if type(row.get('id')) is not int or not isinstance(time,datetime):
            raise MealError('充值流水字段异常',409)
        amount = cents(row.get('amount'))
        if amount < 0 or not start <= time.date() <= end:
            raise MealError('充值流水日期或金额异常',409)
        if not amount:
            continue
        source = f"{DATABASE_REQUEST_PREFIX}{database_id}:{row['source']}:{row['id']}"
        content = digest({'source':row['source'], 'id':row['id'], 'emp_no':row['emp_no'],
                          'time':time.isoformat(),'amount_cents':amount})
        value = {'source_key':source,'digest':content,'time':time,'amount_cents':amount}
        if source in candidates and candidates[source] != value:
            raise MealError('当前表与历史表同编号充值流水不一致',409)
        candidates[source] = value

    # Serialize this reusable account with staff reconciliation and other visits.
    begin_write()
    card = MealGuestCard.query.filter_by(key=guest_key).with_for_update().first()
    record = MealLedgerRecord.query.filter_by(id=identifier).populate_existing().with_for_update().first()
    if (not card or record.voided or original != digest([record.key, record.data, record.record_date.isoformat(), record.amount_cents])):
        raise MealError('客人卡或领用记录已变化，请刷新',409)
    existing = MealGuestRecharge.query.filter_by(record_key=record.key).all()
    for row in existing:
        value = candidates.get(row.source_key)
        if not value or value['digest'] != row.source_digest:
            raise MealError('已匹配充值流水缺失、变化或不在核对日期内，请核查原始记录',409)
    for source in selected:
        if source not in candidates:
            raise MealError('所选充值流水不存在，请重新查询',409)
        used = MealGuestRecharge.query.filter_by(source_key=source).first()
        if ((used and used.record_key != record.key)
                or MealTicketPayment.query.filter_by(request_key=source).first()
                or MealLedgerRecord.query.filter_by(source_key=source).first()):
            raise MealError('该流水已计入其他领用或员工账目，不能重复匹配',409)
    old_keys = {row.source_key for row in existing}
    added = [candidates[key] for key in selected if key not in old_keys]
    if sum(row.amount_cents for row in existing) + sum(row['amount_cents'] for row in added) > record.amount_cents:
        raise MealError('所选流水合计超过本次应充值金额，请核对是否属于其他领用',409)
    for row in added:
        db.session.add(MealGuestRecharge(month=record.month,record_key=record.key,
            source_key=row['source_key'],source_digest=row['digest'],amount_cents=row['amount_cents'],
            occurred_at=row['time'],operator=operator))
    db.session.flush()
    result = []
    for source, row in candidates.items():
        used = MealGuestRecharge.query.filter_by(source_key=source).first()
        occupied = bool((used and used.record_key != record.key)
            or MealTicketPayment.query.filter_by(request_key=source).first()
            or MealLedgerRecord.query.filter_by(source_key=source).first())
        result.append({'source_key':source,'date':row['time'].isoformat(),'amount':row['amount_cents']/100,
                       'matched':bool(used and used.record_key == record.key),'occupied':occupied})
    from services.meal_ledger_service import serialize
    return {'record':serialize(record),'candidates':sorted(result,key=lambda row:(row['date'],row['source_key']))}
