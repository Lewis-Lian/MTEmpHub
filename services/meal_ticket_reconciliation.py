"""Read posted card funds and append each remote transaction exactly once."""
from datetime import date, datetime, timedelta

from models import db
from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketPayment
from models.meal_ledger import MealLedgerRecord
from models.system_setting import SystemSetting
from services.card_db_client import CardDBClient, CardDBClientError, card_db_config_from_settings, card_db_configured
from services.meal_ticket_service import MealError, begin_write, batch_for_write, cents, digest

DATABASE_REQUEST_PREFIX = 'card-meal:'
SOURCE_LABELS = {'subsidy':'补贴发放', 'recharge':'充值', 'refund':'取款'}


def database_status():
    return {'enabled':SystemSetting.get_value('meal_ticket_db_enabled','false') == 'true',
            'configured':card_db_configured(card_db_config_from_settings())}


def reconcile(body, operator):
    refund_actions = body.get('refund_actions', {})
    if not isinstance(refund_actions, dict) or any(not str(k).isdigit() or v not in ('refund', 'clearance') for k, v in refund_actions.items()):
        raise MealError('取款分类无效')
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
    manual = {p.key:p for p in payments if not p.request_key.startswith(DATABASE_REQUEST_PREFIX)}
    cancelled = set()
    for reversal in manual.values():
        original = manual.get(reversal.reversal_of)
        if (reversal.kind == 'reversal' and original and original.kind != 'reversal'
                and reversal.item_key == original.item_key and reversal.amount_cents == -original.amount_cents):
            cancelled.update((original.key, reversal.key))
    if set(manual) - cancelled:
        raise MealError('本月已有手工发放或冲正记录，请先核对登记与数据库流水，避免重复计入',409)
    if any(p.request_key.startswith(DATABASE_REQUEST_PREFIX) and
            not p.request_key.startswith(f'{DATABASE_REQUEST_PREFIX}{database_id}:') for p in payments):
        raise MealError('本月已计入另一数据库的流水，请恢复原共享连接后核对，避免重复计入',409)

    report = {'checked_at':datetime.now().isoformat(timespec='seconds'),
              'start_date':start.isoformat(), 'end_date':end.isoformat(),
              'added':0, 'existing':0, 'unmatched':0, 'zero_amount':0, 'outside_subsidy_month':0,
              'sources':{source:0 for source in SOURCE_LABELS}, 'pending_refunds':[], 'clearance_added':0}
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
        if source == 'refund':
            posted = MealTicketPayment.query.filter_by(request_key=request_key).first()
            cleared = MealLedgerRecord.query.filter_by(source_key=request_key).first()
            action = refund_actions.get(str(row['id']))
            if posted and cleared:
                raise MealError('取款流水重复归属，请核对历史', 409)
            if cleared:
                if action == 'refund' or cleared.data.get('database_digest') != content:
                    raise MealError('已登记清零流水分类或内容不一致，请核对原始记录', 409)
                report['existing'] += 1
                report['sources']['refund'] += 1
                continue
            if posted and action == 'clearance':
                raise MealError('该取款已计入核算扣回，不能重复登记清零', 409)
            if not posted and action is None:
                report['pending_refunds'].append({'id':row['id'], 'emp_no':row['emp_no'],
                    'name':item.name if item else row['emp_no'], 'date':time.date().isoformat(), 'amount':amount/100})
                continue
            if not posted and action == 'clearance':
                from services.meal_ledger_service import create
                if any(not r.voided and r.month == time.strftime('%Y-%m') and r.data.get('emp_no') == row['emp_no'] and r.amount_cents == amount
                       for r in MealLedgerRecord.query.filter_by(kind='clearance').all()):
                    raise MealError('本月已有同人员同金额取款记录，请先核对手工/导入与数据库是否重复', 409)
                record = create('clearance', {'month':time.strftime('%Y-%m'), 'date':time.date().isoformat(),
                    'emp_no':row['emp_no'], 'name':item.name if item else row['emp_no'],
                    'dept_name':item.dept_name if item else '', 'amount':amount/100,
                    'remark':f'数据库清零流水 {row["id"]}', 'request_key':'db-clearance:' + digest(request_key)}, operator, request_key)
                record.data = {**record.data, 'database_digest':content}
                report['clearance_added'] += 1
                report['sources']['refund'] += 1
                continue
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
    for cleared in MealLedgerRecord.query.filter(MealLedgerRecord.source_key.startswith(f'{DATABASE_REQUEST_PREFIX}{database_id}:'),
            MealLedgerRecord.record_date >= start, MealLedgerRecord.record_date <= end).all():
        if seen.get(cleared.source_key) != cleared.data.get('database_digest'):
            raise MealError('已登记清零流水缺失或变化，请核对数据库；本次未更新账目', 409)
    if report['added'] or report['clearance_added']:
        batch.version += 1
    batch.reconciliation = report
    db.session.flush()
    from services.meal_ticket_followup_service import sync_batch_allocations
    sync_batch_allocations(batch, operator, automatic=True)
    db.session.flush()
    return batch, report
