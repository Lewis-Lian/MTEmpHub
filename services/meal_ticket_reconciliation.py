"""Read posted card funds and append each remote transaction exactly once."""
from datetime import date, datetime, timedelta

from models import db
from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketPayment
from models.system_setting import SystemSetting
from services.card_db_client import CardDBClient, CardDBClientError, card_db_config_from_settings, card_db_configured
from services.meal_ticket_service import MealError, begin_write, batch_for_write, cents, digest

DATABASE_REQUEST_PREFIX = 'card-meal:'
SOURCE_LABELS = {'subsidy':'补贴发放', 'recharge':'充值', 'refund':'取款'}


def database_status():
    return {'enabled':SystemSetting.get_value('meal_ticket_db_enabled','false') == 'true',
            'configured':card_db_configured(card_db_config_from_settings())}


def reconcile(body, operator):
    status = database_status()
    if not status['enabled']:
        raise MealError('请先在数据来源与同步中启用菜票数据库核对',409)
    if not status['configured']:
        raise MealError('请先在数据来源与同步中配置共享数据库连接',409)
    identifier, version = body.get('batch_id'), body.get('version')
    if type(identifier) is not int or type(version) is not int:
        raise MealError('核算批次和版本无效')
    batch = db.session.get(MealTicketBatch, identifier)
    if not batch:
        raise MealError('核算批次不存在',404)
    if batch.status != 'confirmed':
        raise MealError('请先确认核算再核对数据库流水',409)
    if batch.version != version:
        raise MealError('数据已变化，请刷新后操作',409)
    try:
        start = date.fromisoformat(body.get('start_date',''))
        end = date.fromisoformat(body.get('end_date',''))
        end_exclusive = end + timedelta(days=1)
    except (ValueError,TypeError,OverflowError):
        raise MealError('核对日期无效')
    if start < date.fromisoformat(batch.recharge_month+'-01') or end < start:
        raise MealError('核对日期须从充值月开始，结束日期不能早于开始日期')
    config = card_db_config_from_settings()
    # Credentials may change without making old transactions eligible again.
    database_id = digest({'host':config['host'].casefold(), 'port':config.get('port') or 1433,
                          'database':config['database']})[:24]
    try:
        records = CardDBClient(config).meal_records(start,end_exclusive)
    except CardDBClientError:
        raise MealError('共享数据库读取失败，请检查连接或表访问权限后重试；本次未更新账目',502) from None

    # The remote read finishes before taking the local write lock. Recheck version
    # under that lock so an overlapping adjustment cannot reconcile a stale view.
    begin_write()
    batch = batch_for_write(identifier,version)
    if batch.status != 'confirmed':
        raise MealError('请先确认核算再核对数据库流水',409)
    items = MealTicketItem.query.filter_by(batch_key=batch.key).all()
    by_number = {item.emp_no_snapshot:item for item in items}
    if len(by_number) != len(items):
        raise MealError('核算人员编号重复，请核对后重试',409)
    payments = MealTicketPayment.query.filter(MealTicketPayment.item_key.in_([i.key for i in items])).all()
    if any(not p.request_key.startswith(DATABASE_REQUEST_PREFIX) for p in payments):
        raise MealError('本月已有手工发放或冲正记录，请先核对登记与数据库流水，避免重复计入',409)
    if any(not p.request_key.startswith(f'{DATABASE_REQUEST_PREFIX}{database_id}:') for p in payments):
        raise MealError('本月已计入另一数据库的流水，请恢复原共享连接后核对，避免重复计入',409)

    report = {'checked_at':datetime.now().isoformat(timespec='seconds'),
              'start_date':start.isoformat(), 'end_date':end.isoformat(),
              'added':0, 'existing':0, 'unmatched':0, 'zero_amount':0, 'outside_subsidy_month':0,
              'sources':{source:0 for source in SOURCE_LABELS}}
    seen = {}
    for row in records:
        source = row.get('source')
        time = row.get('time')
        if source not in SOURCE_LABELS or type(row.get('id')) is not int or not isinstance(time,datetime):
            raise MealError('数据库流水字段无效，本次未更新账目',409)
        amount = cents(row.get('amount'))
        if amount < 0 or not start <= time.date() <= end:
            raise MealError('数据库流水金额或日期异常，本次未更新账目',409)
        if source == 'subsidy' and time.strftime('%Y-%m') != batch.recharge_month:
            report['outside_subsidy_month'] += 1
            continue
        content = digest({'source':source,'id':row['id'],'emp_no':row['emp_no'],
                          'time':time.isoformat(),'amount_cents':amount})
        request_key = f"{DATABASE_REQUEST_PREFIX}{database_id}:{source}:{row['id']}"
        if request_key in seen:
            if seen[request_key] != content:
                raise MealError('当前表与历史表的同编号流水不一致，请核对数据库',409)
            continue
        seen[request_key] = content
        if not amount:
            report['zero_amount'] += 1
            continue
        item = by_number.get(row['emp_no'])
        if not item:
            report['unmatched'] += 1
            continue
        existing = MealTicketPayment.query.filter_by(request_key=request_key).first()
        if existing:
            if existing.item_key != item.key:
                raise MealError('所选范围含已计入其他月份的流水，请缩小核对日期范围',409)
            if existing.request_digest != content:
                raise MealError('已登记的数据库流水发生变化，请核对原始流水；本次未更新账目',409)
            report['existing'] += 1
        else:
            db.session.add(MealTicketPayment(item_key=item.key,month=batch.month,
                kind='refund' if source == 'refund' else 'recharge',
                amount_cents=-amount if source == 'refund' else amount,
                payment_date=time.date(),reference=f"数据库{SOURCE_LABELS[source]} · 流水 {row['id']} · {time.isoformat(sep=' ')}",
                operator=operator,request_key=request_key,request_digest=content))
            report['added'] += 1
        report['sources'][source] += 1
    for existing in payments:
        if (existing.request_key.startswith(f'{DATABASE_REQUEST_PREFIX}{database_id}:')
                and start <= existing.payment_date <= end):
            if existing.request_key not in seen:
                raise MealError('已登记流水在数据库中缺失，请核对原始流水；本次未更新账目',409)
            if seen[existing.request_key] != existing.request_digest:
                raise MealError('已登记的数据库流水发生变化，请核对原始流水；本次未更新账目',409)
    if report['added']:
        batch.version += 1
    db.session.flush()
    return batch, report
