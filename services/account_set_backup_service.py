"""Account-set snapshot and bounded ZIP codec. Never extracts archive paths."""
from __future__ import annotations

from datetime import date, datetime
from io import BytesIO
from pathlib import Path, PurePosixPath
import hashlib
import json
import math
import re
import stat
import zipfile

from sqlalchemy import Date, DateTime, Boolean, Float, Integer, String, JSON
from sqlalchemy import or_
from flask import current_app
from models import db
from models.account_set import AccountSet
from models.employee import Employee
from models.department import Department
from models.shift import Shift
from models.employee_shift import EmployeeShiftAssignment
from models.account_set_backup_restore import AccountSetBackupOrigin
from services.account_set_backup_schema import (
    DATASETS, REFS, HISTORY, ACCOUNT_FIELDS, BackupError, canonical, digest, serial, business_key, MEAL_DATASETS, FILE_DATASETS,
    V2_DATASETS, V2_REFS, DATASET_CATEGORIES, DATASET_VERSIONS,
)

MAX_UPLOAD = 100 * 1024 * 1024
MAX_TOTAL = 500 * 1024 * 1024
MAX_MEMBERS = 10000


def file_digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(64 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def month_bounds(month):
    if not isinstance(month, str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
        raise BackupError('账套月份格式无效')
    try:
        year, number = map(int, month.split('-'))
        start = date(year, number, 1)
        end = date(year + (number == 12), number % 12 + 1, 1)
    except ValueError as exc:
        raise BackupError('账套月份无效') from exc
    return start, end


def scoped_rows(name, account, employee_ids=None):
    ds = V2_DATASETS[name]
    model = ds.model
    query = model.query
    start, end = month_bounds(account.month)
    if ds.scope == 'account':
        query = query.filter_by(account_set_id=account.id)
    elif ds.scope == 'date':
        query = query.filter(model.record_date >= start, model.record_date < end)
    elif ds.scope in ('month', 'report_month'):
        if name == 'meal_ledger_imports':
            from models.meal_ledger import MealLedgerRecord
            keys = [r.data['import_key'] for r in MealLedgerRecord.query.filter_by(month=account.month).all() if r.data.get('import_key')]
            query = query.filter(or_(model.month == account.month, model.key.in_(keys)))
        else:
            query = query.filter(getattr(model, ds.scope) == account.month)
    elif ds.scope == 'interval':
        query = query.filter(model.start_time < datetime.combine(end, datetime.min.time()),
                             model.end_time > datetime.combine(start, datetime.min.time()))
    elif ds.scope == 'year':
        query = query.filter_by(year=start.year)
    if employee_ids is not None and hasattr(model, 'emp_id'):
        query = query.filter(model.emp_id.in_(employee_ids))
    return query.order_by(model.id).all()


def serialize_row(name, row):
    ds = DATASETS[name]
    result = {field: serial(getattr(row, field)) for field in ds.fields}
    if hasattr(row, 'emp_id'):
        employee = db.session.get(Employee, row.emp_id)
        if not employee and row.emp_id is not None:
            raise BackupError('考勤数据引用的员工缺失')
        result['emp_no'] = employee.emp_no if employee else None
    for field, (out, model, natural) in REFS.get(name, {}).items():
        identifier = getattr(row, field)
        ref = db.session.get(model, identifier) if identifier else None
        if identifier and ref is None:
            raise BackupError('关联资料缺失：%s' % out)
        result[out] = getattr(ref, natural) if ref else None
    if name in HISTORY:
        mapping = AccountSetBackupOrigin.query.filter_by(dataset=name, local_id=row.id).first()
        content = {key: value for key, value in result.items() if key != 'created_at'}
        if mapping and mapping.provenance.get('_content_hash') != digest(content):
            mapping = None
        # Original identity is stable across restoration and content-identical re-export.
        result['origin_key'] = mapping.origin_key if mapping else digest({'dataset': name, 'source_id': row.id, 'content': content})
        result['provenance'] = {key: value for key, value in mapping.provenance.items() if key != '_content_hash'} if mapping else {
            'source_id': row.id,
            'operator_id': getattr(row, 'operator_user_id', None),
        }
    if name in FILE_DATASETS:
        identity = result['key'] if name.startswith('meal_') else result['origin_key']
        result['file_key'] = 'files/%s/%s' % (identity, Path(row.source_filename).name)
        path = Path(row.stored_path)
        result['file_sha256'] = file_digest(path) if path.is_file() else None
        result['file_size'] = path.stat().st_size if path.is_file() else None
    return result


def serialize_rows(name, rows):
    # Keep bulk-loaded references alive while serializing: the session identity
    # map uses weak references and otherwise repeats lookups for every day.
    references = []
    if hasattr(DATASETS[name].model, 'emp_id'):
        ids = {row.emp_id for row in rows}
        if ids:
            references.extend(Employee.query.filter(Employee.id.in_(ids)).all())
    for field, (_, model, _) in REFS.get(name, {}).items():
        ids = {getattr(row, field) for row in rows if getattr(row, field)}
        if ids:
            references.extend(model.query.filter(model.id.in_(ids)).all())
    return [serialize_row(name, row) for row in rows]


def _shared_avatar(avatar):
    metadata = dict(avatar_file_key=None, avatar_sha256=None, avatar_size=None, avatar_preset=None)
    if not avatar:
        return metadata, {}
    if avatar.startswith('default:') and len(avatar) > len('default:'):
        metadata['avatar_preset'] = avatar
        return metadata, {}
    prefix = '/api/auth/avatar/'
    filename = avatar[len(prefix):] if avatar.startswith(prefix) else ''
    if not filename or filename in ('.', '..') or Path(filename).name != filename or '\\' in filename:
        raise BackupError('头像引用无效')
    directory = (Path(current_app.config['UPLOAD_FOLDER']) / 'avatars').resolve()
    path = directory / filename
    if path.is_symlink() or path.resolve().parent != directory or not path.is_file():
        raise BackupError('头像文件缺失或引用无效')
    try:
        with path.open('rb') as stream:
            data = stream.read(MAX_UPLOAD + 1)
    except OSError as exc:
        raise BackupError('头像文件无法读取') from exc
    if len(data) > MAX_UPLOAD:
        raise BackupError('头像文件超过 100 MiB')
    checksum = hashlib.sha256(data).hexdigest()
    key = 'files/' + checksum
    metadata.update(avatar_file_key=key, avatar_sha256=checksum, avatar_size=len(data))
    return metadata, {key: data}


def collect_shared_backup(categories=None, progress=None):
    """Complete V2 shared data, independent of any month's business records.

    Does not write a ZIP or enable restore. The multi-month exporter must collect
    this once and include it in its whole-document consistency check.
    """
    shared, files, file_bytes = {}, {}, 0
    for name, ds in V2_DATASETS.items():
        if ds.scope != 'shared' or (categories is not None and DATASET_CATEGORIES[name] not in categories):
            continue
        rows = ds.model.query.order_by(ds.model.id).all()
        references = {}
        for field, (output, model, natural) in V2_REFS.get(name, {}).items():
            identifiers = {getattr(row, field) for row in rows if getattr(row, field) is not None}
            references[field] = {ref.id: getattr(ref, natural)
                                 for ref in model.query.filter(model.id.in_(identifiers)).all()} if identifiers else {}
        items = []
        for row in rows:
            item = {field: serial(getattr(row, field)) for field in ds.fields}
            for field, (output, _, _) in V2_REFS.get(name, {}).items():
                identifier = getattr(row, field)
                if identifier is not None and identifier not in references[field]:
                    raise BackupError('关联资料缺失：%s' % output)
                item[output] = references[field].get(identifier)
            if name == 'users':
                metadata, contents = _shared_avatar(row.avatar)
                item.update(metadata)
                file_bytes += sum(len(data) for key, data in contents.items() if key not in files)
                if file_bytes > MAX_TOTAL:
                    raise BackupError('共享头像文件超过大小限制')
                files.update(contents)
            items.append(item)
        shared[name] = sorted(items, key=lambda item: canonical([item[field] for field in ds.key]))
        if progress:
            progress(name)
    parents = {row['dept_no']: row['parent_no'] for row in shared.get('departments', [])}
    checked = set()
    for number in parents:
        seen = set()
        while number is not None and number not in checked:
            if number in seen:
                raise BackupError('部门层级存在循环')
            seen.add(number)
            number = parents[number]
        checked.update(seen)
    return {'shared': shared, '_files': files,
            'coverage': {'shared/' + name: {'included': True, 'complete': True} for name in shared}}


def collect_backup(account_set_id, progress=None, phase="data"):
    account = db.session.get(AccountSet, account_set_id)
    if account is None:
        raise BackupError('账套不存在')
    datasets, employee_ids, shift_ids = {}, set(), set()
    def report_data():
        if progress:
            completed, total = len(datasets), len(DATASETS)
            progress(phase=phase, completed=completed, total=total,
                     percent=completed * 100 // total,
                     stage=('读取账套数据' if phase == 'data' else '校验备份数据') + '（%s/%s 类）' % (completed, total))
    report_data()
    for name, ds in DATASETS.items():
        if ds.scope in ('shared', 'year'):
            continue
        rows = scoped_rows(name, account)
        datasets[name] = serialize_rows(name, rows)
        report_data()
        employee_ids.update(row.emp_id for row in rows if hasattr(row, 'emp_id') and row.emp_id is not None)
        shift_ids.update(row.shift_id for row in rows if getattr(row, 'shift_id', None))
    employees = Employee.query.filter(Employee.id.in_(employee_ids)).order_by(Employee.id).all()
    assignments = EmployeeShiftAssignment.query.filter(EmployeeShiftAssignment.emp_id.in_(employee_ids)).all()
    shift_ids.update(row.shift_id for row in assignments if row.shift_id)
    departments = {}
    for employee in employees:
        identifier, seen = employee.dept_id, set()
        while identifier:
            if identifier in seen:
                raise BackupError('部门层级存在循环')
            seen.add(identifier)
            row = db.session.get(Department, identifier)
            if row is None:
                raise BackupError('关联部门缺失')
            departments[row.id] = row
            identifier = row.parent_id
    datasets['employees'] = [serialize_row('employees', row) for row in employees]
    report_data()
    datasets['departments'] = [serialize_row('departments', row) for row in departments.values()]
    report_data()
    datasets['shifts'] = [serialize_row('shifts', row) for row in Shift.query.filter(Shift.id.in_(shift_ids)).all()]
    report_data()
    datasets['employee_shift_assignments'] = serialize_rows('employee_shift_assignments', assignments)
    report_data()
    for name, ds in DATASETS.items():
        if ds.scope == 'year':
            datasets[name] = serialize_rows(name, scoped_rows(name, account, employee_ids))
            report_data()
    return {'format_version': 1, 'month': account.month,
            'account_set': {field: serial(getattr(account, field)) for field in ACCOUNT_FIELDS},
            'source_locked': account.is_locked, 'datasets': datasets}


def export_backup(account_set_id, progress=None):
    document = collect_backup(account_set_id, progress)
    content = canonical(document).encode()
    output = BytesIO()
    files, total = [], len(content)
    account = db.session.get(AccountSet, account_set_id)
    sources = {(name, business_key(name, serialize_row(name, row))): row for name in FILE_DATASETS for row in scoped_rows(name, account)}
    file_items = [(name, item) for name in FILE_DATASETS for item in document['datasets'][name]]
    byte_total = sum(item['file_size'] or 0 for _, item in file_items)
    bytes_done = 0
    def report_packing(filename=''):
        if progress:
            progress(phase='packing', completed=bytes_done, total=byte_total,
                     percent=bytes_done * 100 // byte_total if byte_total else 100,
                     stage='打包原始文件' + ('：' + filename if filename else ''))
    report_packing()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('data.json', content)
        for name, item in file_items:
            source = sources.get((name, business_key(name, item)))
            path = Path(source.stored_path) if source else None
            if not path or not path.is_file():
                raise BackupError('原始文件缺失：%s' % item['source_filename'])
            before = path.stat()
            if before.st_size > MAX_UPLOAD:
                raise BackupError('原始文件超过 100 MiB')
            checksum, size = hashlib.sha256(), 0
            with path.open('rb') as stream, archive.open(item['file_key'], 'w') as target:
                while True:
                    chunk = stream.read(64 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    total += len(chunk)
                    if size > MAX_UPLOAD or total > MAX_TOTAL:
                        raise BackupError('账套备份超过大小限制')
                    target.write(chunk)
                    checksum.update(chunk)
                    bytes_done += len(chunk)
                    report_packing(item['source_filename'])
            after = path.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or checksum.hexdigest() != item['file_sha256']:
                raise BackupError('原始文件发生变化，请重新导出')
            files.append({'path': item['file_key'], 'size': size, 'sha256': checksum.hexdigest()})
        archive.writestr('manifest.json', canonical({'format_version': 1, 'data_sha256': hashlib.sha256(content).hexdigest(), 'files': files}))
    if output.tell() > MAX_UPLOAD:
        raise BackupError('压缩备份超过 100 MiB')
    if digest(collect_backup(account_set_id, progress, phase='verification')) != digest(document):
        raise BackupError('账套数据发生变化，请重新导出')
    return output.getvalue()


def validate_document(document):
    if not isinstance(document, dict) or document.get('format_version') != 1:
        raise BackupError('不支持的备份版本')
    start, end = month_bounds(document.get('month'))
    datasets = document.get('datasets')
    if isinstance(datasets, dict):
        for name in MEAL_DATASETS:
            datasets.setdefault(name, [])
    if not isinstance(datasets, dict) or set(datasets) != set(DATASETS):
        raise BackupError('备份数据类别不完整')
    account = document.get('account_set')
    if not isinstance(account, dict) or set(account) != set(ACCOUNT_FIELDS):
        raise BackupError('账套参数无效')
    if not isinstance(account['name'], str) or not account['name'] or len(account['name']) > 100:
        raise BackupError('账套名称无效')
    for field in ACCOUNT_FIELDS[1:]:
        if type(account[field]) not in (float, int) or not math.isfinite(account[field]) or account[field] < 0:
            raise BackupError('账套参数无效')
    for name, ds in DATASETS.items():
        rows = datasets[name]
        if not isinstance(rows, list):
            raise BackupError('数据列表无效：%s' % name)
        seen = set()
        expected = set(ds.fields)
        if hasattr(ds.model, 'emp_id'):
            expected.add('emp_no')
        expected.update(ref[0] for ref in REFS.get(name, {}).values())
        if name in HISTORY:
            expected.update(('origin_key', 'provenance'))
        if name in FILE_DATASETS:
            expected.update(('file_key', 'file_sha256', 'file_size'))
        for row in rows:
            if name == 'employees' and isinstance(row, dict):
                row.setdefault('meal_ticket_as_manager', False)
            if name == 'meal_batches' and isinstance(row, dict):
                row.setdefault('reconciliation', None)
            if name == 'manager_stats' and isinstance(row, dict):
                # Backups made before source tracking keep their numeric fields as legacy corrections.
                row.setdefault('automatic_values', None)
                row.setdefault('manual_values', None)
            if name == 'overtime_records' and isinstance(row, dict):
                row.setdefault('is_revoked', False)
                row.setdefault('is_manual_edited', False)
            if not isinstance(row, dict) or set(row) != expected:
                raise BackupError('备份字段无效：%s' % name)
            for field in ds.fields:
                column = ds.model.__table__.columns[field]
                value = row[field]
                if value is None:
                    if not column.nullable:
                        raise BackupError('字段不能为空：%s' % field)
                    continue
                kind = column.type
                valid = True
                if isinstance(kind, Boolean):
                    valid = type(value) is bool
                elif isinstance(kind, Integer):
                    valid = type(value) is int
                elif isinstance(kind, Float):
                    valid = type(value) in (int, float) and math.isfinite(value)
                elif isinstance(kind, DateTime):
                    parsed = datetime.fromisoformat(value)
                    valid = parsed.tzinfo is None
                elif isinstance(kind, Date):
                    date.fromisoformat(value)
                elif isinstance(kind, String):
                    valid = isinstance(value, str) and (not kind.length or len(value) <= kind.length)
                if name == 'manager_stats' and field in ('automatic_values', 'manual_values'):
                    allowed_keys = {f'm{month}' for month in range(1, 13)} | {'prev_dec'}
                    valid = isinstance(value, dict) and set(value) <= allowed_keys and all(
                        type(days) in (int, float) and math.isfinite(days) for days in value.values())
                if not valid:
                    raise BackupError('字段类型无效：%s' % field)
            for key in ('emp_no', 'dept_no', 'shift_no', 'parent_no'):
                if key in row and row[key] is not None and (not isinstance(row[key], str) or not row[key] or len(row[key]) > 50):
                    raise BackupError('业务编号无效')
            if name in HISTORY and (not re.fullmatch('[0-9a-f]{64}', row['origin_key']) or not isinstance(row['provenance'], dict)):
                raise BackupError('历史来源无效')
            if name in FILE_DATASETS:
                if not isinstance(row['file_sha256'], str) or not re.fullmatch('[0-9a-f]{64}', row['file_sha256']) or type(row['file_size']) is not int or row['file_size'] < 0:
                    raise BackupError('归档文件校验信息无效')
            key = business_key(name, row)
            if key in seen:
                raise BackupError('重复业务记录：%s' % name)
            seen.add(key)
            if name == 'factory_rest':
                if not start <= date.fromisoformat(row['rest_date']) < end:
                    raise BackupError('厂休日期超出账套月份')
                if row['rest_period'] not in ('full', 'am', 'pm'):
                    raise BackupError('厂休时段无效')
            if ds.scope == 'date' and not start <= date.fromisoformat(row['record_date']) < end:
                raise BackupError('日期超出账套月份')
            if ds.scope in ('month', 'report_month') and row[ds.scope] != document['month'] and name != 'meal_ledger_imports':
                raise BackupError('记录月份不匹配')
            if name == 'meal_batches' and row['month'] != document['month']:
                raise BackupError('菜票考勤月份不匹配')
            if ds.scope == 'year' and row['year'] != start.year:
                raise BackupError('年度记录年份不匹配')
            if ds.scope == 'interval':
                first, last = datetime.fromisoformat(row['start_time']), datetime.fromisoformat(row['end_time'])
                if not first < last or not (first < datetime.combine(end, datetime.min.time()) and last > datetime.combine(start, datetime.min.time())):
                    raise BackupError('单据时间区间无效')
    employee_numbers = {row['emp_no'] for row in datasets['employees']}
    departments = {row['dept_no'] for row in datasets['departments']}
    shifts = {row['shift_no'] for row in datasets['shifts']}
    for name, rows in datasets.items():
        for row in rows:
            if row.get('emp_no') and row['emp_no'] not in employee_numbers:
                raise BackupError('备份缺少关联员工')
            if row.get('dept_no') and row['dept_no'] not in departments:
                raise BackupError('备份缺少关联部门')
            if row.get('parent_no') and row['parent_no'] not in departments:
                raise BackupError('备份缺少父部门')
            if row.get('shift_no') and row['shift_no'] not in shifts:
                raise BackupError('备份缺少关联班次')
    meal_refs = {name: {row['key']: row for row in datasets[name]} for name in MEAL_DATASETS}
    for name, parent, field in (
        ('meal_items', 'meal_batches', 'batch_key'),
        ('meal_adjustments', 'meal_items', 'item_key'),
        ('meal_payments', 'meal_items', 'item_key'),
        ('meal_import_rows', 'meal_imports', 'import_key'),
    ):
        for row in datasets[name]:
            if row[field] not in meal_refs[parent]:
                raise BackupError('备份缺少菜票关联记录')
    for row in datasets['meal_payments']:
        original = meal_refs['meal_payments'].get(row['reversal_of']) if row['reversal_of'] else None
        if row['reversal_of'] and (not original or original['item_key'] != row['item_key'] or
                                  original['kind'] == 'reversal' or row['amount_cents'] != -original['amount_cents']):
            raise BackupError('菜票冲正记录无效')
    return document


def read_backup(payload, *, normalized=False):
    if len(payload) > MAX_UPLOAD:
        raise BackupError('上传文件超过 100 MiB')
    try:
        with zipfile.ZipFile(BytesIO(payload)) as archive:
            infos = archive.infolist()
            names = [entry.filename for entry in infos]
            if len(infos) > MAX_MEMBERS or len(set(names)) != len(names):
                raise BackupError('成员重复或过多')
            total, contents = 0, {}
            for entry in infos:
                path = PurePosixPath(entry.filename)
                if path.is_absolute() or '..' in path.parts or '\\' in entry.filename or ':' in entry.filename or entry.is_dir() or stat.S_ISLNK(entry.external_attr >> 16):
                    raise BackupError('备份文件路径无效')
                if entry.file_size > MAX_UPLOAD:
                    raise BackupError('单个文件超过限制')
                buffer = bytearray()
                with archive.open(entry) as stream:
                    while True:
                        chunk = stream.read(64 * 1024)
                        if not chunk:
                            break
                        total += len(chunk)
                        buffer.extend(chunk)
                        if total > MAX_TOTAL or len(buffer) > MAX_UPLOAD:
                            raise BackupError('解压内容超过限制')
                contents[entry.filename] = bytes(buffer)
            manifest = json.loads(contents['manifest.json'])
            if type(manifest['format_version']) is not int:
                raise BackupError('不支持的备份版本')
            if manifest['format_version'] == 2 and normalized:
                return _read_v2_contents(manifest, contents)
            if manifest['format_version'] != 1:
                raise BackupError('不支持的备份版本')
            if hashlib.sha256(contents['data.json']).hexdigest() != manifest['data_sha256']:
                raise BackupError('业务数据校验失败')
            raw_document = json.loads(contents['data.json'], parse_constant=lambda value: (_ for _ in ()).throw(BackupError('无效数值')))
            document = validate_document(raw_document) if not normalized else None
            if normalized:
                from services.backup_document import normalize_backup
                portable = normalize_backup(raw_document)
                # Keep the legacy archive-reference validator independent of the
                # normalized coverage, which must retain absent datasets.
                from copy import deepcopy
                validation = deepcopy(raw_document)
                for name in DATASETS:
                    validation['datasets'].setdefault(name, [])
                document = validate_document(validation)
            files = manifest['files']
            paths = [item['path'] for item in files]
            if len(paths) != len(set(paths)) or set(contents) != {'manifest.json', 'data.json', *paths}:
                raise BackupError('备份文件清单不匹配')
            if set(paths) != {row['file_key'] for name in FILE_DATASETS for row in document['datasets'][name]}:
                raise BackupError('原始文件清单不完整')
            for item in files:
                data = contents[item['path']]
                if len(data) != item['size'] or hashlib.sha256(data).hexdigest() != item['sha256']:
                    raise BackupError('原始文件校验失败')
            for row in [row for name in FILE_DATASETS for row in document['datasets'][name]]:
                if row['file_sha256'] != hashlib.sha256(contents[row['file_key']]).hexdigest() or row['file_size'] != len(contents[row['file_key']]):
                    raise BackupError('归档内容与业务清单不符')
            document['_files'] = {path: contents[path] for path in paths}
            if normalized:
                portable['_files'] = document['_files']
                return portable
            return document
    except BackupError:
        raise
    except (ValueError, TypeError, KeyError, AttributeError, zipfile.BadZipFile, RuntimeError, OSError) as exc:
        raise BackupError('备份文件损坏或格式无效') from exc


def _read_v2_contents(manifest, contents):
    """V2 split-document codec; callers opt in until multi-month restore exists."""
    from services.backup_document import normalize_backup, _contents
    entries = manifest['files']
    if not isinstance(entries, list) or any(not isinstance(item, dict) or set(item) != {'path', 'size', 'sha256'} for item in entries):
        raise BackupError('备份文件清单无效')
    paths = [item['path'] for item in entries]
    if len(paths) != len(set(paths)) or set(contents) != {'manifest.json', *paths}:
        raise BackupError('备份文件清单不匹配')
    for item in entries:
        data = contents[item['path']]
        if type(item['size']) is not int or len(data) != item['size'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise BackupError('备份文件校验失败')
    def parse(path):
        return json.loads(contents[path], parse_constant=lambda value: (_ for _ in ()).throw(BackupError('无效数值')))
    months = manifest['months']
    if not isinstance(months, list) or not months:
        raise BackupError('备份月份清单无效')
    for month in months:
        month_bounds(month)
    json_paths = {'shared.json', 'cross_month.json', 'annual.json', *['months/%s.json' % month for month in months]}
    if set(paths) != json_paths | {path for path in paths if path.startswith('files/')}:
        raise BackupError('备份文件清单不匹配')
    doc = normalize_backup(dict(format_version=2, months=months, coverage=manifest['coverage'],
        dataset_versions=manifest.get('dataset_versions', {}), shared=parse('shared.json'),
        cross_month=parse('cross_month.json'), annual=parse('annual.json'),
        monthly={month: parse('months/%s.json' % month) for month in months}))
    references = {}
    for scope, rows in _contents(doc).items():
        name = scope.split('/')[-1]
        if name not in FILE_DATASETS and name != 'users':
            continue
        key, checksum, size = ('avatar_file_key', 'avatar_sha256', 'avatar_size') if name == 'users' else ('file_key', 'file_sha256', 'file_size')
        for row in rows:
            path = row[key]
            if name == 'users' and path is None and row[checksum] is None and row[size] is None:
                continue
            if not isinstance(path, str) or not path.startswith('files/') or path not in contents:
                raise BackupError('原始文件引用无效')
            data = contents[path]
            if type(row[size]) is not int or row[size] != len(data) or row[checksum] != hashlib.sha256(data).hexdigest():
                raise BackupError('归档内容与业务清单不符')
            references[path] = data
    if set(references) != {path for path in paths if path.startswith('files/')}:
        raise BackupError('原始文件清单不完整')
    doc['_files'] = references
    return doc


def _multi_selection(account_set_ids, categories):
    allowed = set(DATASET_CATEGORIES.values()) - {'monthly_references'} | {'archives'}
    if (not isinstance(account_set_ids, list) or not account_set_ids
            or any(type(identifier) is not int or identifier <= 0 for identifier in account_set_ids)
            or len(set(account_set_ids)) != len(account_set_ids)):
        raise BackupError('请选择不重复的有效账套月份')
    if categories is None:
        categories = sorted(allowed)
    if (not isinstance(categories, list) or any(not isinstance(item, str) for item in categories)
            or len(set(categories)) != len(categories) or set(categories) - allowed):
        raise BackupError('备份类别无效')
    accounts = AccountSet.query.filter(AccountSet.id.in_(account_set_ids)).order_by(AccountSet.month).all()
    if len(accounts) != len(account_set_ids):
        raise BackupError('账套不存在')
    for account in accounts:
        month_bounds(account.month)
    if len({account.month for account in accounts}) != len(accounts):
        raise BackupError('账套月份重复')
    return accounts, categories


def collect_multi_backup(account_set_ids, categories=None, progress=None, *, phase='data'):
    """Read selected V2 scopes directly; never assemble independent V1 backups."""
    from services.backup_document import normalize_backup, _contents
    accounts, categories = _multi_selection(account_set_ids, categories)
    selected = set(categories)
    monthly_business = bool(selected & {'account_settings', 'attendance', 'meal_tickets', 'meal_ledgers'})
    names = [name for name in V2_DATASETS
             if (DATASET_CATEGORIES[name] in selected or (name == 'snapshots' and monthly_business))
             and ('archives' in selected or name not in FILE_DATASETS | {'meal_import_rows'})]
    years = sorted({account.month[:4] for account in accounts})
    total = sum(1 if V2_DATASETS[name].scope == 'shared' else
                len(years) if V2_DATASETS[name].scope == 'year' else len(accounts) for name in names)
    completed = 0
    def report(label):
        nonlocal completed
        completed += 1
        if progress:
            progress(phase=phase, completed=completed, total=total,
                     percent=completed * 100 // total if total else 100,
                     stage=('读取备份数据：' if phase == 'data' else '校验备份数据：') + label)
    if progress:
        progress(phase=phase, completed=0, total=total, percent=0, stage='准备读取全部所选范围')
    shared = collect_shared_backup(categories, progress=report)
    doc = dict(format_version=2, months=[account.month for account in accounts],
               categories=categories, dataset_versions=dict(DATASET_VERSIONS),
               shared=shared['shared'], monthly={}, cross_month={}, annual={}, coverage={}, _files=shared['_files'])
    file_bytes = sum(map(len, doc['_files'].values()))
    def encode(name, rows):
        nonlocal file_bytes
        try:
            items = serialize_rows(name, rows) if name in DATASETS else [
                {field: serial(getattr(row, field)) for field in V2_DATASETS[name].fields} for row in rows]
        except OSError as exc:
            raise BackupError('原始文件缺失或无法读取，请重新导出') from exc
        for source, item in zip(rows, items):
            item.update({field: serial(getattr(source, field)) for field in V2_DATASETS[name].fields})
            for field, (output, model, natural) in V2_REFS.get(name, {}).items():
                identifier = getattr(source, field)
                ref = db.session.get(model, identifier) if identifier is not None else None
                if identifier is not None and ref is None:
                    raise BackupError('关联资料缺失：%s' % output)
                item[output] = getattr(ref, natural) if ref else None
            if name in FILE_DATASETS:
                path = Path(source.stored_path)
                if not path.is_file():
                    raise BackupError('原始文件缺失：%s' % source.source_filename)
                try:
                    with path.open('rb') as stream:
                        data = stream.read(MAX_UPLOAD + 1)
                except OSError as exc:
                    raise BackupError('原始文件无法读取') from exc
                if len(data) > MAX_UPLOAD:
                    raise BackupError('原始文件超过大小限制')
                checksum = hashlib.sha256(data).hexdigest()
                if checksum != item['file_sha256'] or len(data) != item['file_size']:
                    raise BackupError('原始文件发生变化，请重新导出')
                key = 'files/' + checksum
                item.update(file_key=key, file_sha256=checksum, file_size=len(data))
                if key not in doc['_files']:
                    file_bytes += len(data)
                    if file_bytes > MAX_TOTAL:
                        raise BackupError('备份超过大小限制')
                    doc['_files'][key] = data
        return sorted(items, key=lambda item: canonical([item[field] for field in V2_DATASETS[name].key]))
    for account in accounts:
        block = {'datasets': {}}
        doc['monthly'][account.month] = block
        for name in names:
            ds = V2_DATASETS[name]
            if ds.scope in ('shared', 'year'):
                continue
            if name == 'account_set':
                block['account_set'] = encode(name, [account])[0]
                block['source_locked'] = account.is_locked
            elif name == 'snapshots':
                block['snapshots'] = encode(name, ds.model.query.filter_by(month=account.month).order_by(ds.model.id).all())
            else:
                items = encode(name, scoped_rows(name, account))
                if name == 'meal_ledger_records' and 'archives' not in selected and any(
                        item['data'].get('import_key') for item in items):
                    raise BackupError('台账来源依赖归档文件，请同时选择归档类别')
                if ds.scope == 'interval':
                    existing = {canonical([row[field] for field in ds.key]): row
                                for row in doc['cross_month'].setdefault(name, [])}
                    for item in items:
                        key = canonical([item[field] for field in ds.key])
                        if key in existing and existing[key] != item:
                            raise BackupError('跨月数据发生变化，请重新导出')
                        existing[key] = item
                    doc['cross_month'][name] = [existing[key] for key in sorted(existing)]
                else:
                    block['datasets'][name] = items
            report(account.month + '/' + name)
    for year in years:
        for name in names:
            ds = V2_DATASETS[name]
            if ds.scope == 'year':
                doc['annual'].setdefault(year, {})[name] = encode(name, ds.model.query.filter_by(year=int(year)).order_by(ds.model.id).all())
                report(year + '/' + name)
    for scope in _contents(doc):
        # Intervals cover a union of selected months, not the entire global dataset.
        doc['coverage'][scope] = {'included': True, 'complete': not scope.startswith('cross_month/')}
    normalized = normalize_backup(doc)
    if 'meal_tickets' in selected:
        from services.meal_ticket_followup_validation import validate_followup_records
        records = {name: {} for name in V2_DATASETS if name.startswith('meal_')}
        for scope, values in _contents(normalized).items():
            name = scope.split('/')[-1]
            if name in records:
                records[name].update({v['key']:(scope + '/' + v['key'], v) for v in values})
        errors = validate_followup_records(records)
        if errors:
            raise BackupError('；'.join(error[2] for error in errors))
    return normalized


def _multi_fingerprint(document):
    return digest({**document, '_files': {key: hashlib.sha256(data).hexdigest()
                                       for key, data in document['_files'].items()}})


def export_multi_backup(account_set_ids, categories=None, progress=None):
    document = collect_multi_backup(account_set_ids, categories, progress)
    fingerprint = _multi_fingerprint(document)
    contents = dict(document['_files'])
    contents.update({path: canonical(value).encode() for path, value in [
        ('shared.json', document['shared']), ('cross_month.json', document['cross_month']),
        ('annual.json', document['annual']), *[('months/%s.json' % month, document['monthly'][month]) for month in document['months']]]})
    manifest = {key: document[key] for key in ('format_version', 'months', 'categories', 'coverage', 'dataset_versions')}
    manifest.update(exported_at=datetime.utcnow().isoformat(), build_id=current_app.config.get('BUILD_ID'),
                    files=[{'path': path, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                           for path, data in sorted(contents.items())])
    contents['manifest.json'] = canonical(manifest).encode()
    total = sum(map(len, contents.values()))
    if len(contents) > MAX_MEMBERS:
        raise BackupError('备份成员过多')
    if total > MAX_TOTAL or any(len(data) > MAX_UPLOAD for data in contents.values()):
        raise BackupError('备份超过大小限制')
    output, completed = BytesIO(), 0
    def report():
        if progress:
            progress(phase='packing', completed=completed, total=total,
                     percent=completed * 100 // total if total else 100, stage='打包备份文件')
    report()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path, data in sorted(contents.items()):
            with archive.open(path, 'w') as target:
                for offset in range(0, len(data), 64 * 1024):
                    chunk = data[offset:offset + 64 * 1024]
                    target.write(chunk)
                    completed += len(chunk)
                    report()
    if output.tell() > MAX_UPLOAD:
        raise BackupError('压缩备份超过大小限制')
    # Re-query every selected scope, including all shared data and file bytes;
    # expire ORM caches so external commits cannot be hidden by the identity map.
    db.session.expire_all()
    verification_total = 1
    def verification_progress(**work):
        nonlocal verification_total
        verification_total = work['total'] + 1  # final unit verifies the downloadable ZIP
        if progress:
            progress(**{**work, 'total': verification_total,
                        'percent': work['completed'] * 100 // verification_total})
    if _multi_fingerprint(collect_multi_backup(account_set_ids, categories, verification_progress, phase='verification')) != fingerprint:
        raise BackupError('备份数据或文件发生变化，请重新导出')
    payload = output.getvalue()
    read_backup(payload, normalized=True)  # verify the exact downloadable ZIP and all references
    if progress:
        progress(phase='verification', completed=verification_total, total=verification_total,
                 percent=100, stage='全部范围与 ZIP 校验完成')
    return payload
