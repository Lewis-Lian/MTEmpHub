"""Portable scope/coverage contract shared by V1 compatibility and V2 readers."""
from copy import deepcopy
import importlib
from pathlib import Path

from models import db
from services.account_set_backup_schema import (
    BackupError, DATASETS, V2_DATASETS, V2_REFS, FILE_REFS, FIELD_EXCLUSIONS,
    V2_OPTIONAL_FIELDS,
)


def can_delete_scope(coverage, selected):
    return (selected is True and isinstance(coverage, dict)
            and coverage.get('included') is True and coverage.get('complete') is True)


def resolve_shared_references(name, row):
    """Resolve portable references against target rows, without writing anything.

    Restore must call this after applying the selected parent data and checking
    final dependencies; a missing target never becomes an implicit new record.
    """
    if name not in V2_DATASETS or V2_DATASETS[name].scope != 'shared':
        raise BackupError('共享类别无效')
    result = {}
    for field, (output, model, natural) in V2_REFS.get(name, {}).items():
        value = row[output]
        if value is None:
            if not V2_DATASETS[name].model.__table__.columns[field].nullable:
                raise BackupError('关联业务编号不能为空：%s' % output)
            result[field] = None
        else:
            target = model.query.filter(getattr(model, natural) == value).one_or_none()
            if target is None:
                raise BackupError('目标缺少关联资料：%s' % output)
            result[field] = target.id
    return result


def shared_preview_row(name, system, backup, *, coverage=None, selected=False):
    """Public shared diff: passwords are compared privately, never returned.

    Inputs are validated portable rows. Scope selection/coverage is supplied by
    the future V2 preview builder, not inferred from an empty backup list.
    """
    from services.account_set_backup_schema import canonical
    if name not in V2_DATASETS or V2_DATASETS[name].scope != 'shared' or (system is None and backup is None):
        raise BackupError('共享差异记录无效')
    fields = []
    left, right = system or {}, backup or {}
    password_changed = name == 'users' and left.get('password_hash') != right.get('password_hash')
    for field in sorted(set(left) | set(right)):
        if field in ('password_hash', 'created_at', 'avatar_file_key'):
            continue
        if left.get(field) != right.get(field):
            fields.append({'name': field, 'system': deepcopy(left.get(field)), 'backup': deepcopy(right.get(field))})
    if password_changed:
        fields.append({'name': 'password_changed', 'system': None, 'backup': None, 'changed': True})
    status = 'new' if system is None else 'system_only' if backup is None else 'changed' if fields else 'same'
    default = 'backup' if status in ('new', 'changed') or (status == 'system_only' and can_delete_scope(coverage, selected)) else 'system'
    def public(row):
        return None if row is None else {key: deepcopy(value) for key, value in row.items() if key != 'password_hash'}
    identity = canonical([(backup or system)[field] for field in V2_DATASETS[name].key])
    return dict(row_key='shared/' + name + '/' + identity, dataset=name, status=status,
                system=public(system), backup=public(backup), fields=fields,
                password_changed=password_changed, default_choice=default)


def missing_backup_coverage():
    # Import every model module, not just the ones already reached by app routes.
    for path in sorted((Path(__file__).parent.parent / 'models').glob('*.py')):
        importlib.import_module('models.' + path.stem)
    decisions = {table: set(fields) for table, fields in FIELD_EXCLUSIONS.items()}
    for name, ds in V2_DATASETS.items():
        decisions.setdefault(ds.model.__tablename__, set()).update(
            set(ds.fields) | set(V2_REFS.get(name, {})) | set(FILE_REFS.get(name, {})))
    missing = []
    for table in db.metadata.sorted_tables:
        if table.name not in decisions:
            missing.append(table.name)
        missing.extend('%s.%s' % (table.name, col.name) for col in table.columns
                       if col.name not in decisions.get(table.name, set()))
    return sorted(missing)


def _scope(name, month=None, year=None):
    ds = V2_DATASETS[name]
    if ds.scope == 'shared':
        return 'shared/' + name
    if ds.scope == 'interval':
        return 'cross_month/' + name
    if ds.scope == 'year':
        return 'year/%s/%s' % (year, name)
    return 'month/%s/%s' % (month, name)


def _contents(doc):
    """Only present scopes, including explicitly empty lists."""
    found = {}
    def add(scope, rows):
        if scope in found or not isinstance(rows, list):
            raise BackupError('备份数据列表或范围无效')
        found[scope] = rows
    for name, rows in doc['shared'].items():
        if name not in V2_DATASETS or V2_DATASETS[name].scope != 'shared':
            raise BackupError('共享类别无效')
        add(_scope(name), rows)
    for month, block in doc['monthly'].items():
        if month not in doc['months'] or not isinstance(block, dict) or set(block) - {'account_set', 'datasets', 'snapshots', 'source_locked'}:
            raise BackupError('月份范围无效')
        if 'account_set' in block:
            if not isinstance(block['account_set'], dict):
                raise BackupError('账套参数无效')
            add(_scope('account_set', month), [block['account_set']])
        if 'snapshots' in block:
            add(_scope('snapshots', month), block['snapshots'])
        datasets = block.get('datasets', {})
        if not isinstance(datasets, dict):
            raise BackupError('月份数据类别无效')
        for name, rows in datasets.items():
            if name not in V2_DATASETS or V2_DATASETS[name].scope in ('shared', 'interval', 'year') or name in ('account_set', 'snapshots'):
                raise BackupError('月份数据类别无效')
            add(_scope(name, month), rows)
    for name, rows in doc['cross_month'].items():
        if name not in V2_DATASETS or V2_DATASETS[name].scope != 'interval':
            raise BackupError('跨月类别无效')
        add(_scope(name), rows)
    for year, datasets in doc['annual'].items():
        if not isinstance(year, str) or len(year) != 4 or not year.isdigit() or not 1 <= int(year) <= 9999 or not isinstance(datasets, dict):
            raise BackupError('年度范围无效')
        for name, rows in datasets.items():
            if name not in V2_DATASETS or V2_DATASETS[name].scope != 'year':
                raise BackupError('年度类别无效')
            add(_scope(name, year=year), rows)
    return found


def normalize_backup(document):
    from services.account_set_backup_service import month_bounds, validate_document
    if not isinstance(document, dict) or type(document.get('format_version')) is not int or document['format_version'] not in (1, 2):
        raise BackupError('不支持的备份版本（支持 1、2）')
    source = deepcopy(document)
    version = source['format_version']
    if version == 1:
        month = source.get('month')
        month_bounds(month)
        original = source.get('datasets')
        if not isinstance(original, dict) or set(original) - set(DATASETS):
            raise BackupError('备份数据类别无效')
        # Validate through the frozen V1 codec; absence is recorded BEFORE its
        # legacy empty-list defaults, and those defaults never reach coverage.
        validation = deepcopy(source)
        for name in DATASETS:
            validation['datasets'].setdefault(name, [])
        validate_document(validation)
        doc = dict(format_version=2, source_format_version=1, months=[month],
                   shared={}, monthly={month: {'account_set': source['account_set'],
                   'source_locked': source.get('source_locked', False), 'datasets': {}}},
                   cross_month={}, annual={}, coverage={}, _files=source.get('_files', {}))
        doc['coverage'][_scope('account_set', month)] = {'included': True, 'complete': True}
        for name in original:
            ds = DATASETS[name]
            rows = validation['datasets'][name]
            if ds.scope == 'shared':
                doc['shared'][name] = rows
            elif ds.scope == 'interval':
                doc['cross_month'][name] = rows
            elif ds.scope == 'year':
                doc['annual'].setdefault(month[:4], {})[name] = rows
            else:
                doc['monthly'][month]['datasets'][name] = rows
            # V1 carries related subsets for shared, interval and annual data.
            doc['coverage'][_scope(name, month, month[:4])] = {
                'included': True, 'complete': ds.scope not in ('shared', 'interval', 'year')}
    else:
        doc = source
        doc.setdefault('source_format_version', 2)
        doc.setdefault('_files', {})
        for name in ('shared', 'monthly', 'cross_month', 'annual', 'coverage'):
            if not isinstance(doc.get(name), dict):
                raise BackupError('备份范围或覆盖声明无效')
    months = doc.get('months')
    if not isinstance(months, list) or not months or any(not isinstance(month, str) for month in months) or len(set(months)) != len(months):
        raise BackupError('备份月份清单无效')
    for month in months:
        month_bounds(month)
    if set(doc['monthly']) != set(months):
        raise BackupError('月份范围与清单不符')
    present = _contents(doc)
    if version == 2:
        try:
            _validate_v2_rows(present, doc.get('dataset_versions', {}))
        except (ValueError, TypeError, KeyError, OverflowError) as exc:
            if isinstance(exc, BackupError):
                raise
            raise BackupError('备份字段或范围无效') from exc
    possible = set(present)
    years = set(doc['annual']) | {month[:4] for month in months}
    for name, ds in V2_DATASETS.items():
        if ds.scope in ('shared', 'interval'):
            possible.add(_scope(name))
        elif ds.scope == 'year':
            possible.update(_scope(name, year=year) for year in years)
        else:
            possible.update(_scope(name, month) for month in months)
    if set(doc['coverage']) - possible:
        raise BackupError('备份覆盖范围无效')
    for scope in possible:
        coverage = doc['coverage'].get(scope, {'included': scope in present, 'complete': False})
        if (not isinstance(coverage, dict) or set(coverage) != {'included', 'complete'}
                or any(type(value) is not bool for value in coverage.values())
                or coverage['included'] != (scope in present)
                or (coverage['complete'] and not coverage['included'])):
            raise BackupError('备份覆盖声明与内容不符')
        doc['coverage'][scope] = coverage
    return doc


def _validate_v2_rows(present, versions):
    import math
    import re
    from datetime import date, datetime
    from sqlalchemy import Boolean, Integer, Float, DateTime, Date, String, JSON
    from services.account_set_backup_schema import DATASET_VERSIONS, HISTORY, FILE_DATASETS, canonical
    from services.account_set_backup_service import month_bounds
    if not isinstance(versions, dict) or any(name not in DATASET_VERSIONS or type(value) is not int or value not in ((1, 2) if name == 'meal_batches' else (DATASET_VERSIONS[name],)) for name, value in versions.items()):
        raise BackupError('不支持的数据集版本')
    for scope, rows in present.items():
        name = scope.split('/')[-1]
        ds = V2_DATASETS[name]
        expected = set(ds.fields) | {ref[0] for ref in V2_REFS.get(name, {}).values()}
        if name in HISTORY:
            expected.update(('origin_key', 'provenance'))
        if name in FILE_DATASETS:
            expected.update(('file_key', 'file_sha256', 'file_size'))
        if name == 'users':
            expected.update(('avatar_file_key', 'avatar_sha256', 'avatar_size'))
        seen = set()
        for row in rows:
            legacy_batch = name == 'meal_batches' and versions.get(name, 1) == 1 and isinstance(row, dict) and 'followup_state' not in row
            row_fields = (expected - {'followup_state'} if legacy_batch else expected) | (set(row) & set(V2_OPTIONAL_FIELDS.get(name, ()))) if isinstance(row, dict) else expected
            if not isinstance(row, dict) or set(row) != row_fields:
                raise BackupError('备份字段无效：%s' % name)
            for field in ds.fields:
                if field == 'followup_state' and legacy_batch:
                    continue
                column = ds.model.__table__.columns[field]
                value, kind = row[field], column.type
                valid = True
                if value is None:
                    valid = column.nullable
                elif isinstance(kind, Boolean):
                    valid = type(value) is bool
                elif isinstance(kind, Integer):
                    valid = type(value) is int
                elif isinstance(kind, Float):
                    valid = type(value) in (int, float) and math.isfinite(value)
                elif isinstance(kind, DateTime):
                    valid = isinstance(value, str) and datetime.fromisoformat(value).tzinfo is None
                elif isinstance(kind, Date):
                    valid = isinstance(value, str) and bool(date.fromisoformat(value))
                elif isinstance(kind, String):
                    valid = isinstance(value, str) and (not kind.length or len(value) <= kind.length)
                elif isinstance(kind, JSON):
                    canonical(value)  # rejects NaN/Infinity and non-JSON values
                if not valid:
                    raise BackupError('字段类型无效：%s' % field)
            for field, (output, model, natural) in V2_REFS.get(name, {}).items():
                value = row[output]
                length = model.__table__.columns[natural].type.length
                if value is None:
                    valid = ds.model.__table__.columns[field].nullable
                else:
                    valid = isinstance(value, str) and bool(value) and (not length or len(value) <= length)
                if not valid:
                    raise BackupError('关联业务编号无效：%s' % output)
            identity = canonical([row[field] for field in ds.key])
            if identity in seen:
                raise BackupError('重复业务记录：%s' % name)
            seen.add(identity)
            if scope.startswith('month/'):
                month = scope.split('/')[1]
                start, end = month_bounds(month)
                if row.get('account_month', month) != month:
                    raise BackupError('账套关联月份不匹配')
                if ds.scope in ('month', 'report_month') and row[ds.scope] != month and name != 'meal_ledger_imports':
                    raise BackupError('记录月份不匹配')
                if (ds.scope == 'date' or name == 'factory_rest') and not start <= date.fromisoformat(row.get('record_date', row.get('rest_date'))) < end:
                    raise BackupError('日期超出账套月份')
                if name == 'meal_batches' and row['month'] != month:
                    raise BackupError('菜票月份不匹配')
                if name == 'factory_rest' and row['rest_period'] not in ('full', 'am', 'pm'):
                    raise BackupError('厂休时段无效')
                if name == 'account_set' and (not row['name'] or any(row[field] < 0 for field in ('factory_rest_days', 'monthly_benefit_days'))):
                    raise BackupError('账套参数无效')
            if scope.startswith('year/') and row['year'] != int(scope.split('/')[1]):
                raise BackupError('年度记录年份不匹配')
            if ds.scope == 'interval' and datetime.fromisoformat(row['start_time']) >= datetime.fromisoformat(row['end_time']):
                raise BackupError('单据时间区间无效')
            if name in HISTORY and (not re.fullmatch('[0-9a-f]{64}', row['origin_key']) or not isinstance(row['provenance'], dict)):
                raise BackupError('历史来源无效')
            if name == 'snapshots' and (row['kind'] not in ('employee', 'department', 'shift') or row['quality'] not in ('verified', 'baseline', 'partial') or row['schema_version'] != 1 or not isinstance(row['payload'], dict) or not isinstance(row['provenance'], dict)):
                raise BackupError('月度快照无效')
            if name == 'users' and row.get('avatar_preset') is not None:
                preset = row['avatar_preset']
                if (not isinstance(preset, str) or not preset.startswith('default:')
                        or not len('default:') < len(preset) <= 255
                        or any(row[field] is not None for field in ('avatar_file_key', 'avatar_sha256', 'avatar_size'))):
                    raise BackupError('内置头像引用无效')
