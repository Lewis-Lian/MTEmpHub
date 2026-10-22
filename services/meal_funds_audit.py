"""Read-only, range-wide comparison of all posted card funds and local evidence.

Results are deliberately transient: a backup or an old successful check cannot
certify the current contents of the external card database.
"""
from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import func, or_, text

from models import db
from models.meal_ticket import MealTicketItem, MealTicketPayment
from models.meal_guest_card import MealGuestCard, MealGuestRecharge
from models.meal_ledger import MealLedgerRecord
from services.card_db_client import CardDBClient, CardDBClientError, card_db_config_from_settings
from services.meal_ticket_reconciliation import DATABASE_REQUEST_PREFIX, SOURCE_LABELS, database_status
from services.meal_ticket_service import MealError, cents, digest


def audit_funds(body):
    status = database_status()
    if not status['enabled'] or not status['configured']:
        raise MealError('请先启用并配置菜票数据库核对', 409)
    try:
        start, end = (date.fromisoformat(body.get(key, '')) for key in ('start_date', 'end_date'))
        end_exclusive = end + timedelta(days=1)
        if end < start:
            raise ValueError
    except (ValueError, TypeError, OverflowError):
        raise MealError('请选择有效的核对起止日期') from None
    config = card_db_config_from_settings()
    database_id = digest({'host':config['host'].casefold(), 'port':config.get('port') or 1433,
                          'database':config['database']})[:24]
    prefix = f'{DATABASE_REQUEST_PREFIX}{database_id}:'
    try:
        rows = CardDBClient(config).meal_records(start, end_exclusive)
    except CardDBClientError:
        raise MealError('数据库读取失败，全部资金尚未核清；请重试', 502) from None

    remote = {}
    for row in rows:
        source, time = row.get('source'), row.get('time')
        if (source not in SOURCE_LABELS or type(row.get('id')) is not int
                or not isinstance(time, datetime) or not isinstance(row.get('emp_no'), str)):
            raise MealError('数据库资金流水字段异常，无法核清', 409)
        amount = cents(row.get('amount'))
        if amount < 0 or not start <= time.date() <= end:
            raise MealError('数据库资金流水日期或金额异常，无法核清', 409)
        content = digest({'source':source, 'id':row['id'], 'emp_no':row['emp_no'],
                          'time':time.isoformat(), 'amount_cents':amount})
        key = f'{prefix}{source}:{row["id"]}'
        if key in remote and remote[key]['digest'] != content:
            raise MealError('当前表与历史表的同编号流水不一致，无法核清', 409)
        remote[key] = dict(source=source, date=time.date().isoformat(), emp_no=row['emp_no'],
                           amount_cents=amount, digest=content)

    # Start a fresh local read snapshot after the remote read. No business writes,
    # locks, classifications, task allocations or persisted reports are created.
    db.session.rollback()
    if db.engine.dialect.name == 'sqlite':
        # Python's SQLite legacy mode does not begin a transaction for SELECT.
        # Hold one snapshot across all three ownership tables, including restore.
        db.session.execute(text('BEGIN'))
    elif db.engine.dialect.name == 'mysql':
        db.session.connection(execution_options={'isolation_level':'REPEATABLE READ'})
    owners = defaultdict(list)
    unlinked = []

    def add(key, owner, amount, day, emp_no, content, valid=True, source=None):
        inferred = key[len(prefix):].split(':')[0] if key and key.startswith(prefix) else None
        entry = dict(owner=owner, amount_cents=amount, date=day.isoformat(), emp_no=emp_no,
                     digest=content, valid=valid, source=inferred or source or 'unlinked')
        if inferred in SOURCE_LABELS:
            owners[key].append(entry)
        else:
            unlinked.append(entry)

    keys = list(remote)
    payments = MealTicketPayment.query.filter(or_(
        db.and_(MealTicketPayment.payment_date >= start, MealTicketPayment.payment_date <= end),
        MealTicketPayment.request_key.in_(keys))).all()
    items = {i.key:i for i in MealTicketItem.query.filter(
        MealTicketItem.key.in_({p.item_key for p in payments})).all()}
    by_key = {p.key:p for p in payments}
    cancelled = set()
    for p in payments:
        original = by_key.get(p.reversal_of)
        if (p.kind == 'reversal' and original and original.kind != 'reversal'
                and p.item_key == original.item_key and p.amount_cents == -original.amount_cents
                and not original.request_key.startswith(DATABASE_REQUEST_PREFIX)):
            cancelled.update((p.key, original.key))
    for p in payments:
        if p.key in cancelled:
            continue
        item = items.get(p.item_key)
        source = p.request_key[len(prefix):].split(':')[0] if p.request_key.startswith(prefix) else None
        debit = source == 'refund' or not source and p.kind == 'refund'
        add(p.request_key, 'employee', -p.amount_cents if debit else p.amount_cents,
            p.payment_date, item.emp_no_snapshot if item else '', p.request_digest,
            bool(item) and p.kind == ('refund' if debit else 'recharge'), 'refund' if debit else None)

    matches = MealGuestRecharge.query.filter(or_(
        db.and_(MealGuestRecharge.occurred_at >= start, MealGuestRecharge.occurred_at < end_exclusive),
        MealGuestRecharge.source_key.in_(keys))).all()
    visits = {r.key:r for r in MealLedgerRecord.query.filter(
        MealLedgerRecord.key.in_({m.record_key for m in matches})).all()}
    cards = {c.key:c for c in MealGuestCard.query.filter(
        MealGuestCard.key.in_({r.data.get('guest_card_key') for r in visits.values()})).all()}
    allocated = dict(db.session.query(MealGuestRecharge.record_key, func.sum(MealGuestRecharge.amount_cents))
        .filter(MealGuestRecharge.record_key.in_(visits)).group_by(MealGuestRecharge.record_key).all())
    for match in matches:
        record = visits.get(match.record_key)
        card = cards.get(record.data.get('guest_card_key')) if record else None
        valid = bool(record and record.kind == 'external' and not record.voided
                     and card and record.data.get('category') == 'card'
                     and card.emp_no == record.data.get('emp_no') and card.card_no == record.data.get('card_no')
                     and allocated[record.key] <= record.amount_cents)
        active = bool(record and record.kind == 'external' and not record.voided)
        add(match.source_key, 'guest', match.amount_cents if active else 0, match.occurred_at.date(),
            record.data.get('emp_no', '') if record else '', match.source_digest, valid)

    ledgers = MealLedgerRecord.query.filter(or_(
        db.and_(MealLedgerRecord.record_date >= start, MealLedgerRecord.record_date <= end),
        MealLedgerRecord.source_key.in_(keys))).all()
    for record in ledgers:
        if record.kind == 'clearance':
            if record.voided and not record.source_key:
                continue
            add(record.source_key, 'clearance', 0 if record.voided else record.amount_cents,
                record.record_date, record.data.get('emp_no', ''), record.data.get('database_digest'),
                not record.voided, 'refund')
        elif (record.kind == 'external' and record.data.get('category') == 'card'
                and not record.data.get('guest_card_key') and not record.voided):
            add(None, 'guest', record.amount_cents, record.record_date, record.data.get('emp_no', ''), None)

    summaries = {source:dict(source=source, database_count=0, database_cents=0, recorded_count=0,
        recorded_cents=0, employee_cents=0, guest_cents=0, clearance_cents=0) for source in SOURCE_LABELS}
    issues = []
    for key in sorted(remote.keys() | owners.keys()):
        row, local = remote.get(key), owners.get(key, [])
        source = row['source'] if row else local[0]['source']
        summary = summaries[source]
        if row:
            summary['database_count'] += 1
            summary['database_cents'] += row['amount_cents']
        for entry in local:
            summary['recorded_count'] += 1
            summary['recorded_cents'] += entry['amount_cents']
            summary[entry['owner'] + '_cents'] += entry['amount_cents']
        issue = None
        if not row:
            issue = 'missing'
        elif len(local) > 1:
            issue = 'duplicate'
        elif not local:
            issue = 'unassigned' if row['amount_cents'] else None
        elif (not local[0]['valid'] or source == 'refund' and local[0]['owner'] == 'guest'
              or source != 'refund' and local[0]['owner'] == 'clearance'):
            issue = 'invalid'
        elif any(local[0][field] != row[field] for field in ('digest', 'date', 'emp_no', 'amount_cents')):
            issue = 'changed'
        if issue:
            shown = row or local[0]
            issues.append(dict(source_key=key, source=source, status=issue, date=shown['date'],
                emp_no=shown['emp_no'], amount_cents=row['amount_cents'] if row else 0,
                recorded_cents=sum(e['amount_cents'] for e in local), owners=[e['owner'] for e in local]))
    for entry in unlinked:
        summary = summaries.setdefault(entry['source'], dict(source=entry['source'], database_count=0,
            database_cents=0, recorded_count=0, recorded_cents=0, employee_cents=0, guest_cents=0, clearance_cents=0))
        summary['recorded_count'] += 1
        summary['recorded_cents'] += entry['amount_cents']
        summary[entry['owner'] + '_cents'] += entry['amount_cents']
        issues.append(dict(source_key=None, source=entry['source'], status='unlinked', date=entry['date'],
            emp_no=entry['emp_no'], amount_cents=0, recorded_cents=entry['amount_cents'], owners=[entry['owner']]))

    database_net = sum(s['database_cents'] * (-1 if source == 'refund' else 1) for source,s in summaries.items())
    recorded_net = sum(s['recorded_cents'] * (-1 if source == 'refund' else 1) for source,s in summaries.items())
    return dict(start_date=start.isoformat(), end_date=end.isoformat(), checked_at=datetime.now().isoformat(timespec='seconds'),
        complete=not issues, database_net_cents=database_net, recorded_net_cents=recorded_net,
        sources=list(summaries.values()), issues=issues)
