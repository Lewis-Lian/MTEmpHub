"""Business-key preview and transactional account-set restoration."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
import fcntl
import json
import shutil
import uuid

from flask import current_app
from sqlalchemy import Date, DateTime, text
from sqlalchemy.exc import IntegrityError
from models import db
from models.account_set import AccountSet
from models.employee import Employee
from models.department import Department
from models.shift import Shift
from models.account_set_backup_restore import AccountSetBackupOrigin, AccountSetBackupRestore
from services.account_set_backup_schema import (
    DATASETS, REFS, HISTORY, DELETE_ALLOWED, ACCOUNT_FIELDS, BackupError,
    BackupTargetChanged, digest, business_key, options_checked, serial,
)
from services.account_set_backup_service import month_bounds, scoped_rows, serialize_row

LABELS = {
    'actual_hours': '实际工时', 'expected_hours': '应出勤工时', 'absent_hours': '缺勤工时',
    'work_hours': '工时', 'attendance_days': '出勤天数', 'late_minutes': '迟到分钟',
    'early_leave_minutes': '早退分钟', 'name': '姓名', 'card_no': '卡号', 'dept_no': '部门编号',
    'dept_name': '部门名称', 'shift_name': '班次名称', 'factory_rest_days': '厂休天数',
    'file_sha256': '文件内容校验值', 'file_size': '文件大小（字节）',
    'automatic_values': '系统自动值', 'manual_values': '手动修正值',
    'monthly_benefit_days': '福利天数', 'remaining_days': '剩余年假', 'duration': '时长',
}


def private_backup_root():
    root = Path(current_app.config.get('BACKUP_PRIVATE_DIR', Path(current_app.instance_path) / 'account_set_backups')).resolve()
    if current_app.static_folder:
        static = Path(current_app.static_folder).resolve()
        if root == static or static in root.parents:
            raise BackupError('备份预览目录不能位于公开静态文件目录')
    return root


@contextmanager
def restore_lock():
    # Shared by all workers on this host; DB locking protects other writers too.
    root = private_backup_root()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / 'restore.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def target_rows(document):
    account = AccountSet.query.filter_by(month=document['month']).first()
    result = {}
    employee_ids = [row.id for row in Employee.query.filter(Employee.emp_no.in_([
        item['emp_no'] for item in document['datasets']['employees']])).all()]
    for name, ds in DATASETS.items():
        if ds.scope == 'shared':
            # Include all shared unique keys so conflicts and stale previews are detected.
            rows = ds.model.query.order_by(ds.model.id).all()
        elif account:
            rows = scoped_rows(name, account, employee_ids if ds.scope == 'year' else None)
        elif ds.scope == 'account':
            rows = []
        else:
            proxy = type('MonthScope', (), {'month': document['month'], 'id': -1})()
            rows = scoped_rows(name, proxy, employee_ids if ds.scope == 'year' else None)
        if ds.scope == 'interval':
            field = ds.key[0]
            extras = ds.model.query.filter(getattr(ds.model, field).in_([
                item[field] for item in document['datasets'][name]])).all()
            rows = list({row.id: row for row in rows + extras}.values())
        result[name] = {business_key(name, serialize_row(name, row)): row for row in rows}
    return account, result


def fields_diff(system, backup):
    fields = []
    for field in sorted(set(system or {}) | set(backup or {})):
        if field in ('provenance', 'origin_key', 'created_at', 'file_key', 'started_at', 'finished_at'):
            continue
        left, right = (system or {}).get(field), (backup or {}).get(field)
        if left != right or (left is None) != (right is None):
            delta = right - left if type(left) in (int, float) and type(right) in (int, float) else None
            fields.append({'name': field, 'label': LABELS.get(field, field), 'system': left, 'backup': right, 'delta': delta})
    return fields


def affected_months(name, system, backup, month):
    ds = DATASETS.get(name)
    if ds and ds.scope == 'interval':
        months = set()
        for row in (system, backup):
            if not row:
                continue
            first, last = date.fromisoformat(row['start_time'][:10]), date.fromisoformat(row['end_time'][:10])
            cursor = first.replace(day=1)
            while cursor <= last:
                months.add(cursor.strftime('%Y-%m'))
                _, cursor = month_bounds(cursor.strftime('%Y-%m'))
        return sorted(months)
    if ds and ds.scope in ('shared', 'year'):
        return [row.month for row in AccountSet.query.order_by(AccountSet.month).all()]
    return [month]


def fingerprint_target(document, account, existing):
    state = {'account': {field: serial(getattr(account, field)) for field in ACCOUNT_FIELDS} if account else None,
             'locks': [(row.month, row.is_locked) for row in AccountSet.query.order_by(AccountSet.month).all()],
             'datasets': {name: {key: serialize_row(name, row) for key, row in items.items()} for name, items in existing.items()}}
    # A file replacement after preview is a material target change as well.
    state['files'] = []
    for row in existing['imports'].values():
        path = Path(row.stored_path)
        metadata = path.stat() if path.is_file() else None
        state['files'].append((row.id, row.stored_path, metadata.st_size if metadata else None, metadata.st_mtime_ns if metadata else None))
    return digest(state)


def build_preview(document, options):
    options = options_checked(options)
    account, existing = target_rows(document)
    rows = []
    system_account = {field: serial(getattr(account, field)) for field in ACCOUNT_FIELDS} if account else None
    for name in ('account_set', *DATASETS):
        if name == 'account_set':
            source, target, enabled = {'account': document['account_set']}, {'account': system_account} if account else {}, True
        else:
            ds = DATASETS[name]
            source = {business_key(name, row): row for row in document['datasets'][name]}
            target = {key: serialize_row(name, row) for key, row in existing[name].items()}
            enabled = not ds.option or options[ds.option]
            if ds.scope == 'shared':
                # Shared unrelated records do not belong to this backup.
                target = {key: value for key, value in target.items() if key in source}
        for key in sorted(source.keys() | target.keys()):
            left, right = target.get(key), source.get(key)
            fields = fields_diff(left, right)
            status = 'new' if left is None else 'system_only' if right is None else 'changed' if fields else 'same'
            default = 'backup' if status == 'new' else 'system'
            if status == 'system_only' and options['delete_month_only'] and name in DELETE_ALLOWED:
                default = 'backup'
            identity = right or left
            rows.append({'key': name + ':' + key, 'dataset': name, 'identity': key,
                         'status': status, 'enabled': enabled, 'system': left, 'backup': right,
                         'fields': fields, 'default_choice': default,
                         'affected_months': affected_months(name, left, right, document['month'])})
    preview = {'month': document['month'], 'source_locked': document.get('source_locked', False),
               'fingerprint': fingerprint_target(document, account, existing), 'rows': rows,
               'summary': {status: sum(row['enabled'] and row['status'] == status for row in rows) for status in ('new', 'changed', 'system_only', 'same')}}
    preview['blockers'] = validate_selection(document, options, rows, {})
    return preview


def selected_changes(rows, options, choices):
    if not isinstance(choices, dict) or set(choices) - {row['key'] for row in rows}:
        raise BackupError('差异选择无效')
    for row in rows:
        choice = choices.get(row['key'], row['default_choice'])
        if choice not in ('system', 'backup', 'skip'):
            raise BackupError('差异选择无效')
        if not row['enabled']:
            if row['key'] in choices:
                raise BackupError('未勾选资料不能导入')
            continue
        if choice != 'backup' or row['status'] == 'same':
            continue
        if row['status'] == 'system_only':
            if not options['delete_month_only'] or row['dataset'] not in DELETE_ALLOWED:
                raise BackupError('系统独有数据删除未启用')
        yield row


def validate_selection(document, options, rows, choices):
    changes = list(selected_changes(rows, options, choices))
    blockers = []
    def block(code, message):
        if not any(item['message'] == message for item in blockers):
            blockers.append({'code': code, 'message': message})
    maps = {
        'employees': {row.emp_no: serialize_row('employees', row) for row in Employee.query.all()},
        'departments': {row.dept_no: serialize_row('departments', row) for row in Department.query.all()},
        'shifts': {row.shift_no: serialize_row('shifts', row) for row in Shift.query.all()},
    }
    for row in changes:
        if row['dataset'] in maps and row['backup']:
            natural = DATASETS[row['dataset']].key[0]
            maps[row['dataset']][row['backup'][natural]] = row['backup']
    account = AccountSet.query.filter_by(month=document['month']).first()
    if account is None and not any(row['dataset'] == 'account_set' for row in changes):
        block('missing_account', '新账套必须选择以备份为准，不能跳过账套创建后导入明细')
    if account and account.is_locked:
        block('locked', '%s 账套已锁定，请先解锁' % document['month'])
    locked = {row.month for row in AccountSet.query.filter_by(is_locked=True).all()}
    for row in changes:
        for month in set(row['affected_months']) & locked:
            block('locked', '该修改影响已锁定账套 %s' % month)
        value = row['backup']
        if not value:
            continue
        for field, category, code in (('emp_no', 'employees', 'missing_employee'), ('dept_no', 'departments', 'missing_department'), ('parent_no', 'departments', 'missing_department'), ('shift_no', 'shifts', 'missing_shift')):
            identifier = value.get(field)
            if identifier and identifier not in maps[category]:
                block(code, '缺少关联资料 %s：%s；请选择导入对应资料或先补齐' % (field, identifier))
        if row['dataset'] == 'departments' and row['system'] and row['system'].get('is_locked'):
            block('department_locked', '部门 %s 已锁定' % value['dept_no'])
    cards = {}
    for number, employee in maps['employees'].items():
        card = employee.get('card_no')
        if card:
            if card in cards:
                block('card_conflict', '卡号 %s 同时对应工号 %s、%s' % (card, cards[card], number))
            cards[card] = number
    for number in maps['departments']:
        seen, cursor = set(), number
        while cursor:
            if cursor in seen:
                block('department_cycle', '部门层级存在循环：%s' % number)
                break
            seen.add(cursor)
            parent = maps['departments'].get(cursor)
            if parent is None:
                block('missing_department', '缺少父部门：%s' % cursor)
                break
            cursor = parent.get('parent_no')
    return blockers


def convert_fields(name, value):
    ds = DATASETS[name]
    fields = {}
    for field in ds.fields:
        item = value[field]
        kind = ds.model.__table__.columns[field].type
        if item is not None and isinstance(kind, DateTime):
            item = datetime.fromisoformat(item)
        elif item is not None and isinstance(kind, Date):
            item = date.fromisoformat(item)
        fields[field] = item
    if hasattr(ds.model, 'emp_id'):
        fields['emp_id'] = Employee.query.filter_by(emp_no=value['emp_no']).one().id
    for field, (natural, model, attribute) in REFS.get(name, {}).items():
        identifier = value[natural]
        fields[field] = model.query.filter(getattr(model, attribute) == identifier).one().id if identifier else None
    return fields


def cleanup_old_files(root):
    warnings = []
    journal = root / 'cleanup.json'
    if not journal.is_file():
        return warnings
    pending = json.loads(journal.read_text())
    referenced = {str(Path(row.stored_path).resolve()) for row in DATASETS['imports'].model.query.all()}
    remaining = []
    for filename in pending:
        try:
            if filename not in referenced:
                Path(filename).unlink(missing_ok=True)
        except OSError:
            remaining.append(filename)
    journal.write_text(json.dumps(remaining))
    if remaining:
        warnings.append('部分旧归档未清理，下次恢复时会重试；恢复数据已保存')
    return warnings


def restore_backup(document, options, choices, fingerprint, operator_id):
    options = options_checked(options)
    root = private_backup_root()
    destination = Path(current_app.config['UPLOAD_FOLDER']).resolve() / 'backup_restores' / uuid.uuid4().hex
    committed = False
    with restore_lock():
        db.session.rollback()
        try:
            if db.engine.dialect.name == 'sqlite':
                db.session.execute(text('BEGIN IMMEDIATE'))
            else:
                # Lock entire relevant key ranges, including uniqueness dependencies.
                AccountSet.query.order_by(AccountSet.id).with_for_update().all()
                for ds in DATASETS.values():
                    ds.model.query.order_by(ds.model.id).with_for_update().all()
            preview = build_preview(document, options)
            if preview['fingerprint'] != fingerprint:
                raise BackupTargetChanged('系统数据已变化，请重新预览后确认')
            blockers = validate_selection(document, options, preview['rows'], choices)
            if blockers:
                raise BackupError('；'.join(item['message'] for item in blockers))
            changes = list(selected_changes(preview['rows'], options, choices))
            account, existing = target_rows(document)
            if account is None:
                account = AccountSet(month=document['month'], **document['account_set'], is_active=False, is_locked=False)
                db.session.add(account)
                db.session.flush()
            counts = {'new': 0, 'updated': 0, 'deleted': 0, 'skipped': len(preview['rows']) - len(changes)}
            old_paths = []
            # Release only selected card assignments inside this transaction so a
            # valid two-way swap does not hit the unique index halfway through.
            for item in changes:
                if item['dataset'] == 'employees' and item['system'] and item['backup'] and item['system']['card_no'] != item['backup']['card_no']:
                    target = existing['employees'][business_key('employees', item['system'])]
                    target.card_no = None
            db.session.flush()
            # Persist all new bytes before DB writes; no source filesystem paths are used.
            for item in changes:
                if item['dataset'] == 'imports' and item['backup']:
                    destination.mkdir(parents=True, exist_ok=True)
                    path = destination / item['backup']['origin_key']
                    path.write_bytes(document['_files'][item['backup']['file_key']])
            # Departments are inserted in ancestor order, not source database order.
            ordered = []
            pending = [row for row in changes if row['dataset'] == 'departments']
            while pending:
                ready = [row for row in pending if not row['backup'].get('parent_no') or row['backup']['parent_no'] not in {other['backup']['dept_no'] for other in pending}]
                if not ready:
                    raise BackupError('部门层级存在循环')
                ordered.extend(ready)
                pending = [row for row in pending if row not in ready]
            for category in ('shifts', 'employees', 'employee_shift_assignments', 'account_set', *[name for name in DATASETS if name not in ('departments', 'shifts', 'employees', 'employee_shift_assignments')]):
                ordered.extend(row for row in changes if row['dataset'] == category)
            for item in ordered:
                name, value = item['dataset'], item['backup']
                if name == 'account_set':
                    for field in ACCOUNT_FIELDS:
                        setattr(account, field, value[field])
                    counts['updated' if item['system'] else 'new'] += 1
                    continue
                ds = DATASETS[name]
                key = business_key(name, item['system'] or value)
                target = existing[name].get(key)
                if value is None:
                    if name == 'imports':
                        old_paths.append(str(Path(target.stored_path).resolve()))
                    if name in HISTORY:
                        AccountSetBackupOrigin.query.filter_by(dataset=name, local_id=target.id).delete(synchronize_session=False)
                    db.session.delete(target)
                    counts['deleted'] += 1
                    continue
                fields = convert_fields(name, value)
                if ds.scope == 'account':
                    fields['account_set_id'] = account.id
                if name == 'imports':
                    fields['stored_path'] = str(destination / value['origin_key'])
                    if target:
                        old_paths.append(str(Path(target.stored_path).resolve()))
                if hasattr(ds.model, 'updated_by'):
                    fields['updated_by'] = operator_id
                if name == 'override_history':
                    fields['operator_user_id'] = None
                if target:
                    for field, content in fields.items():
                        setattr(target, field, content)
                    counts['updated'] += 1
                else:
                    target = ds.model(**fields)
                    db.session.add(target)
                    counts['new'] += 1
                db.session.flush()
                if name in HISTORY:
                    AccountSetBackupOrigin.query.filter(
                        AccountSetBackupOrigin.dataset == name,
                        AccountSetBackupOrigin.local_id == target.id,
                        AccountSetBackupOrigin.origin_key != value['origin_key'],
                    ).delete(synchronize_session=False)
                    origin = AccountSetBackupOrigin.query.filter_by(dataset=name, origin_key=value['origin_key']).first()
                    content = {key: item for key, item in value.items() if key not in ('created_at', 'origin_key', 'provenance', 'file_key', 'file_sha256', 'file_size')}
                    provenance = {**value['provenance'], '_content_hash': digest(content)}
                    if origin is None:
                        db.session.add(AccountSetBackupOrigin(dataset=name, origin_key=value['origin_key'], local_id=target.id, provenance=provenance))
                    else:
                        origin.local_id = target.id
                        origin.provenance = provenance
            db.session.add(AccountSetBackupRestore(month=document['month'], operator_id=operator_id,
                                                  backup_digest=digest({key: value for key, value in document.items() if key != '_files'}), counts=counts))
            # Journal before commit: cleanup verifies DB references before deleting.
            journal = root / 'cleanup.json'
            previous = json.loads(journal.read_text()) if journal.exists() else []
            journal.write_text(json.dumps(sorted(set(previous + old_paths))))
            restored_account_id = account.id
            db.session.commit()
            committed = True
            try:
                warnings = cleanup_old_files(root)
            except OSError:
                warnings = ['旧归档清理暂未完成，恢复数据已保存，下次恢复时会重试']
            return {'account_set_id': restored_account_id, 'month': document['month'], 'counts': counts, 'warnings': warnings}
        except IntegrityError as exc:
            db.session.rollback()
            raise BackupError('业务编号或卡号冲突，导入未保存，请重新预览') from exc
        finally:
            if not committed:
                db.session.rollback()
                if destination.exists():
                    shutil.rmtree(destination)
