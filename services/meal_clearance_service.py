"""Explicit classification of real card withdrawals into the clearance ledger."""
from calendar import monthrange
from datetime import date, datetime, timedelta

from models import db
from models.employee import Employee
from models.meal_guest_card import MealGuestCard
from models.meal_ledger import MealLedgerRecord
from models.meal_ticket import MealTicketPayment
from models.system_setting import SystemSetting
from services.card_db_client import CardDBClient, CardDBClientError, card_db_config_from_settings
from services.meal_ledger_service import create, month_checked
from services.meal_ticket_reconciliation import DATABASE_REQUEST_PREFIX, database_status
from services.meal_ticket_service import MealError, begin_write, cents, digest


def lock_classification():
    # Both reconciliation and direct clearance use this lock before classifying
    # a source; the same withdrawal must never enter two different money tables.
    SystemSetting.query.filter_by(key='meal_ticket_db_enabled').populate_existing().with_for_update().first()


def classification(source_key, content, emp_no, month, amount):
    posted = MealTicketPayment.query.filter_by(request_key=source_key).first()
    cleared = MealLedgerRecord.query.filter_by(source_key=source_key).first()
    if posted and cleared:
        raise MealError('取款流水重复归属，请核对历史', 409)
    if cleared:
        if cleared.kind != 'clearance' or cleared.data.get('database_digest') != content:
            raise MealError('已登记清零流水分类或内容不一致，请核对原始记录', 409)
        return 'voided' if cleared.voided else 'registered'
    if posted:
        return 'refunded'
    if any(not (record.source_key or '').startswith(DATABASE_REQUEST_PREFIX)
           and record.data.get('emp_no') == emp_no and record.amount_cents == amount
           for record in MealLedgerRecord.query.filter_by(kind='clearance', month=month, voided=False)):
        return 'manual_conflict'
    return 'available'


def store_clearance(row, source_key, content, operator, name, dept_name='', card_no=''):
    status = classification(source_key, content, row['emp_no'], row['time'].strftime('%Y-%m'), cents(row['amount']))
    if status == 'registered':
        return False
    if status != 'available':
        messages = {'refunded':'该取款已计入核算扣回，不能重复登记清零',
                    'voided':'该数据库清零记录已作废，请核对原始记录，不能重复入账',
                    'manual_conflict':'本月已有同人员同金额取款记录，请先核对手工/导入与数据库是否重复'}
        raise MealError(messages[status], 409)
    record = create('clearance', {'month':row['time'].strftime('%Y-%m'), 'date':row['time'].date().isoformat(),
        'emp_no':row['emp_no'], 'name':name, 'dept_name':dept_name, 'card_no':card_no,
        'amount':cents(row['amount']) / 100, 'remark':f'数据库清零流水 {row["id"]}',
        'request_key':'db-clearance:' + digest(source_key)}, operator, source_key)
    record.data = {**record.data, 'database_digest':content}
    return True


def read_withdrawals(body):
    month = month_checked(body.get('month'))
    first = date.fromisoformat(month + '-01')
    last = first.replace(day=monthrange(first.year, first.month)[1])
    try:
        start = date.fromisoformat(body.get('start_date', first.isoformat()))
        end = date.fromisoformat(body.get('end_date', last.isoformat()))
        end_exclusive = end + timedelta(days=1)
    except (ValueError, TypeError, OverflowError):
        raise MealError('查询日期无效')
    if not first <= start <= end <= last:
        raise MealError('取款查询日期须属于所选业务月份，且结束日期不能早于开始日期')
    status = database_status()
    if not status['enabled'] or not status['configured']:
        raise MealError('请先在数据来源与同步中启用并配置菜票数据库核对', 409)
    config = card_db_config_from_settings()
    database_id = digest({'host':config['host'].casefold(), 'port':config.get('port') or 1433,
                          'database':config['database']})[:24]
    try:
        remote = CardDBClient(config).meal_records(start, end_exclusive)
    except CardDBClientError:
        raise MealError('共享数据库读取失败，请检查连接后重试；本次未更新清零台账', 502) from None
    rows = {}
    for row in remote:
        if row.get('source') != 'refund':
            continue
        time = row.get('time')
        if type(row.get('id')) is not int or not isinstance(time, datetime) or not isinstance(row.get('emp_no'), str):
            raise MealError('数据库取款流水字段无效', 409)
        amount = cents(row.get('amount'))
        if amount < 0 or not start <= time.date() <= end:
            raise MealError('数据库取款流水金额或日期异常', 409)
        if not amount:
            continue
        source_key = f'{DATABASE_REQUEST_PREFIX}{database_id}:refund:{row["id"]}'
        content = digest({'source':'refund', 'id':row['id'], 'emp_no':row['emp_no'],
                          'time':time.isoformat(), 'amount_cents':amount})
        if source_key in rows and rows[source_key]['content'] != content:
            raise MealError('当前表与历史表的同编号取款流水不一致，请核对数据库', 409)
        rows[source_key] = {'raw':row, 'content':content}
    source_digest = digest([month, start.isoformat(), end.isoformat(),
                            sorted((key, value['content']) for key, value in rows.items())])
    return month, start, end, rows, source_digest


def person(emp_no):
    employee = Employee.query.filter_by(emp_no=emp_no).first()
    if employee:
        return employee.name, employee.department.dept_name if employee.department else '未分配部门', employee.card_no or ''
    card = MealGuestCard.query.filter_by(emp_no=emp_no).first()
    return (card.name, '', card.card_no) if card else (emp_no or '未匹配人员', '', '')


def preview_clearance(body):
    month, start, end, remote, source_digest = read_withdrawals(body)
    rows = []
    for source_key, entry in remote.items():
        row = entry['raw']
        name, dept_name, card_no = person(row['emp_no'])
        rows.append({'source_key':source_key, 'emp_no':row['emp_no'], 'name':name,
            'dept_name':dept_name, 'card_no':card_no, 'date':row['time'].isoformat(),
            'amount':cents(row['amount']) / 100,
            'status':classification(source_key, entry['content'], row['emp_no'], month, cents(row['amount']))})
    return {'month':month, 'start_date':start.isoformat(), 'end_date':end.isoformat(),
            'source_digest':source_digest, 'rows':sorted(rows, key=lambda row:(row['date'], row['source_key']))}


def confirm_clearance(body, operator):
    selected = body.get('source_keys')
    if (not isinstance(selected, list) or not selected or any(not isinstance(key, str) for key in selected)
            or len(set(selected)) != len(selected)):
        raise MealError('请选择有效、不重复的取款流水')
    month, start, end, remote, source_digest = read_withdrawals(body)
    if source_digest != body.get('source_digest') or set(selected) - remote.keys():
        raise MealError('取款流水已变化，请重新查询并核对后确认', 409)
    begin_write()
    lock_classification()
    added = 0
    for source_key in selected:
        entry = remote[source_key]
        name, dept_name, card_no = person(entry['raw']['emp_no'])
        added += store_clearance(entry['raw'], source_key, entry['content'], operator, name, dept_name, card_no)
    db.session.flush()
    return {'month':month, 'added':added, 'existing':len(selected) - added}
