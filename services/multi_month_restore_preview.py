"""Read-only multi-scope diff and final-state dependency validation."""
from copy import deepcopy
from datetime import date, datetime
import hashlib
from pathlib import Path

from flask import current_app
from models import db
from models.account_set import AccountSet
from models.user import User
from services.account_set_backup_schema import (
    DATASETS, V2_DATASETS, V2_REFS, DATASET_CATEGORIES, FILE_DATASETS,
    BackupError, canonical, digest, serial, business_key,
)
from services.backup_document import normalize_backup, _contents, _scope, can_delete_scope, shared_preview_row
from services.account_set_backup_service import serialize_row, file_digest, month_bounds

CATEGORIES = set(DATASET_CATEGORIES.values()) - {'monthly_references'} | {'archives'}
MONTH_CATEGORIES = {'account_settings', 'attendance', 'meal_tickets', 'meal_ledgers'}
EXIT_CURRENT = {'employees', 'departments', 'shifts', 'users'}


def _key(name, value):
    return business_key(name, value) if name == 'imports' else canonical([value[f] for f in V2_DATASETS[name].key])


def _row_key(scope, name, value):
    return scope + '/' + _key(name, value)


def _serialize(name, obj):
    ds = V2_DATASETS[name]
    value = serialize_row(name, obj) if name in DATASETS else {}
    value.update({f: serial(getattr(obj, f)) for f in ds.fields})
    for field, (output, model, natural) in V2_REFS.get(name, {}).items():
        identifier = getattr(obj, field)
        ref = db.session.get(model, identifier) if identifier is not None else None
        if identifier is not None and ref is None:
            raise BackupError('目标关联资料缺失：%s' % output)
        value[output] = getattr(ref, natural) if ref else None
    if name == 'users':
        avatar = obj.avatar
        value.update(avatar_file_key=None, avatar_sha256=None, avatar_size=None, avatar_preset=None)
        if avatar and avatar.startswith('default:'):
            value['avatar_preset'] = avatar
        elif avatar:
            path = Path(current_app.config['UPLOAD_FOLDER']) / 'avatars' / Path(avatar).name
            value.update(avatar_file_key=avatar, avatar_sha256=file_digest(path) if path.is_file() else None,
                         avatar_size=path.stat().st_size if path.is_file() else None)
    return value


def _target_state():
    state, local = {}, {}
    for name, ds in V2_DATASETS.items():
        for obj in ds.model.query.order_by(ds.model.id).all():
            value = _serialize(name, obj)
            month = value.get('account_month') or value.get('month') or value.get('report_month')
            if ds.scope == 'date':
                month = value['record_date'][:7]
            scope = _scope(name, month, value.get('year'))
            state.setdefault(scope, {})[_key(name, value)] = value
            # Local identities/versions and paths affect binding, even when the
            # portable content is identical. They never enter the public rows.
            local[_row_key(scope, name, value)] = {
                'id': obj.id, 'auth_version': getattr(obj, 'auth_version', None),
                'login_locked_until': serial(getattr(obj, 'login_locked_until', None)),
                'stored_path': getattr(obj, 'stored_path', None), 'avatar': getattr(obj, 'avatar', None)}
    return state, local


def _impact(name, left, right, scope, accounts):
    ds = V2_DATASETS[name]
    if ds.scope == 'shared':
        return []  # historical consumers use frozen month references
    if ds.scope == 'year':
        year = scope.split('/')[1]
        return sorted(month for month in accounts if month[:4] == year)
    if ds.scope == 'interval':
        months = set()
        for value in (left, right):
            if not value:
                continue
            cursor = date.fromisoformat(value['start_time'][:10]).replace(day=1)
            last = datetime.fromisoformat(value['end_time'])
            # Intervals are half-open, like the existing scope collector.
            while datetime.combine(cursor, datetime.min.time()) < last:
                months.add(cursor.strftime('%Y-%m'))
                _, cursor = month_bounds(cursor.strftime('%Y-%m'))
        return sorted(months)
    months = {scope.split('/')[1]}
    if name in ('meal_batches', 'meal_imports'):
        months.update(value['recharge_month'] for value in (left, right) if value)
    return sorted(months)


def _selection(document, selection):
    if not isinstance(selection, dict) or set(selection) - {'months', 'categories', 'cross_month_keys', 'annual_keys'}:
        raise BackupError('恢复范围无效')
    result = {}
    for field in ('months', 'categories', 'cross_month_keys', 'annual_keys'):
        items = selection.get(field, [])
        if not isinstance(items, list) or any(not isinstance(v, str) for v in items) or len(items) != len(set(items)):
            raise BackupError('恢复范围清单无效')
        result[field] = set(items)
    if result['months'] - set(document['months']) or result['categories'] - CATEGORIES:
        raise BackupError('恢复月份或类别无效')
    return result


def build_multi_preview(document, selection, choices=None):
    # Prevent relationship loads, history identity lookups and queries from
    # flushing unrelated pending changes. No snapshot capture or file staging.
    with db.session.no_autoflush:
        return _build(document, selection, choices)


def _build(document, selection, choices, *, private=False):
    if document.get('format_version') == 2 and document.get('source_format_version') == 1:
        # Normalized V1 is not a native V2 document: reconstruct the frozen
        # codec input and derive coverage again, never trust elevated coverage.
        months = document.get('months', [])
        if len(months) != 1:
            raise BackupError('旧备份月份范围无效')
        month = months[0]
        block = document['monthly'][month]
        datasets = {**document['shared'], **block.get('datasets', {}),
                    **document['cross_month'], **document['annual'].get(month[:4], {})}
        document = normalize_backup(dict(format_version=1, month=month, account_set=block['account_set'],
                                         datasets=datasets, _files=document.get('_files', {})))
    else:
        document = normalize_backup(document)
    selection = _selection(document, selection)
    for month, block in document['monthly'].items():
        if 'account_set' in block:
            block['account_set'].setdefault('month', month)
    source = {scope: {_key(scope.split('/')[-1], v): v for v in values}
              for scope, values in _contents(document).items()}
    target, local = _target_state()
    accounts = {a.month: a for a in AccountSet.query.all()}
    rows, internal = [], {}
    def quality(state, month):
        values = list(state.get(_scope('snapshots', month), {}).values())
        return 'missing' if not values else ('partial' if any(v['quality'] == 'partial' for v in values)
               else 'baseline' if any(v['quality'] == 'baseline' for v in values) else 'verified')
    for scope, coverage in sorted(document['coverage'].items()):
        name = scope.split('/')[-1]
        ds = V2_DATASETS[name]
        category = DATASET_CATEGORIES[name]
        month = scope.split('/')[1] if scope.startswith('month/') else None
        year = scope.split('/')[1] if scope.startswith('year/') else None
        selected = category in selection['categories'] and (month is None or month in selection['months'])
        if name == 'snapshots':
            selected = month in selection['months'] and bool(selection['categories'] & MONTH_CATEGORIES)
        if name in FILE_DATASETS or name == 'meal_import_rows':
            selected = selected and 'archives' in selection['categories']
        lefts, rights = dict(target.get(scope, {})), source.get(scope, {})
        if name == 'meal_ledger_imports':
            all_imports = {k: v for s, records in target.items() if s.endswith('/meal_ledger_imports')
                           for k, v in records.items()}
            lefts.update({k: all_imports[k] for k in rights if k in all_imports})
        for identity in sorted(lefts.keys() | rights.keys()):
            left, right = lefts.get(identity), rights.get(identity)
            key = scope + '/' + identity
            enabled = selected and coverage['included']
            if ds.scope in ('interval', 'year'):
                field = 'cross_month_keys' if ds.scope == 'interval' else 'annual_keys'
                enabled = enabled and key in selection[field]
            # Old portable subsets lack new fields. Missing fields never mean
            # reset a target's newly introduced state.
            comparison = {f: left.get(f) for f in right} if left and right else left
            if ds.scope == 'shared':
                public = shared_preview_row(name, comparison, right, coverage=coverage, selected=enabled)
            else:
                from services.account_set_restore_service import fields_diff
                fields = fields_diff(comparison, right)
                status = 'new' if left is None else 'system_only' if right is None else 'changed' if fields else 'same'
                default = 'backup' if status in ('new', 'changed') or (status == 'system_only' and can_delete_scope(coverage, enabled)) else 'system'
                public = dict(status=status, system=deepcopy(left), backup=deepcopy(right), fields=fields, default_choice=default)
            public.update(row_key=key, scope=scope, month=month, year=year, dataset=name, category=category,
                          enabled=enabled, affected_months=_impact(name, left, right, scope, accounts))
            if name == 'meal_payments':
                public['affected_months'] = sorted(set(public['affected_months']) | {
                    v['payment_date'][:7] for v in (left, right) if v})
            if name.startswith('meal_') and name not in ('meal_ledger_records', 'meal_ledger_imports'):
                for state, value in ((target, left), (source, right)):
                    if value:
                        batches = state.get(_scope('meal_batches', month), {}).values()
                        public['affected_months'] = sorted(set(public['affected_months']) | {
                            b['recharge_month'] for b in batches if b['month'] == month})
            if name == 'meal_ledger_imports':
                import_key = (right or left)['key']
                public['affected_months'] = sorted(set(public['affected_months']) | {
                    v['month'] for state in (source, target) for s, records in state.items()
                    if s.endswith('/meal_ledger_records') for v in records.values()
                    if v['data'].get('import_key') == import_key})
            if month and name != 'snapshots':
                public['reference_quality'] = dict(system=quality(target, month), backup=quality(source, month))
            if name == 'snapshots':
                public['reference_quality'] = {side: value['quality'] if value else 'missing'
                                               for side, value in (('system', left), ('backup', right))}
            rows.append(public)
            destination = _scope(name, (right or left)['month']) if name == 'meal_ledger_imports' else scope
            internal[key] = (destination, identity, left, right)
    valid = {r['row_key']: r for r in rows}
    for field, prefix in (('cross_month_keys', 'cross_month/'), ('annual_keys', 'year/')):
        if any(key not in valid or not valid[key]['scope'].startswith(prefix) for key in selection[field]):
            raise BackupError('跨月或年度条目选择无效')
    choices = {} if choices is None else choices
    if not isinstance(choices, dict) or set(choices) - set(valid):
        raise BackupError('差异选择无效')
    final = deepcopy(target)
    changes = []
    for r in rows:
        key = r['row_key']
        choice = choices.get(key, r['default_choice'])
        if choice not in ('backup', 'system', 'skip'):
            raise BackupError('差异选择无效')
        if key in choices and not r['enabled']:
            raise BackupError('未选择或未包含的范围不能修改')
        r['choice'] = choice
        if not r['enabled'] or choice != 'backup' or r['status'] == 'same':
            continue
        scope, identity, left, right = internal[key]
        if right is None and not can_delete_scope(document['coverage'][r['scope']], True):
            raise BackupError('不完整或未包含范围不能按缺失删除')
        if right is None:
            final.setdefault(scope, {}).pop(identity, None)
        else:
            final.setdefault(scope, {})[identity] = {**(left or {}), **deepcopy(right)}
        changes.append(r)
    blockers = _validate(final, target, source, rows, changes, selection, document, accounts)
    # All inspected dependency state is included. Keep password hashes private;
    # the only exported fingerprint is a SHA-256 digest of this private state.
    fingerprint = digest({'target': target, 'local': local,
                          'locks': {m: a.is_locked for m, a in accounts.items()}})
    preview = dict(months=sorted(selection['months']), coverage=deepcopy(document['coverage']), rows=rows,
                summary={status: sum(r['enabled'] and r['status'] == status for r in rows)
                         for status in ('new', 'changed', 'system_only', 'same')},
                blockers=blockers, fingerprint=fingerprint)
    return (preview, document, internal, local) if private else preview


def _validate(final, target, source, rows, changes, selection, document, accounts):
    blockers = []
    def block(code, key, message, required=(), **extra):
        item = dict(code=code, row_key=key, message=message, required_rows=sorted(set(required)), **extra)
        if item not in blockers:
            blockers.append(item)
    def entries(state, name):
        return [(scope + '/' + identity, value) for scope, values in state.items()
                if scope.split('/')[-1] == name for identity, value in values.items()]
    maps = {name: {v[ds.key[0]]: (key, v) for key, v in entries(final, name)}
            for name, ds in V2_DATASETS.items() if name in EXIT_CURRENT | {'account_set'}}
    local_users = {u.username: u for u in User.query.all()}
    if changes and not any(value.get('role') == 'admin' and value.get('is_active', True)
               and not value.get('login_disabled_until_admin_unlock') and value.get('password_hash')
               and (value['username'] not in local_users or not local_users[value['username']].is_temporarily_login_locked())
               for _, value in entries(final, 'users')):
        block('last_admin', next((r['row_key'] for r in changes if r['dataset'] == 'users'), ''),
              '恢复后必须保留至少一个可登录管理员')
    def require(key, value, field, parent, code, historical=False, allow_inactive=False):
        identifier = value.get(field)
        if not identifier:
            return
        found = maps[parent].get(identifier)
        if found and (historical or allow_inactive or found[1].get('is_active', True)):
            return
        # Archived current rows remain local FK anchors for frozen history.
        old = next((v for _, v in entries(target, parent) if v[V2_DATASETS[parent].key[0]] == identifier), None)
        if historical and old:
            return
        required = 'shared/' + parent + '/' + canonical([identifier])
        if parent == 'account_set':
            required = 'month/%s/account_set/%s' % (identifier, canonical([identifier]))
        block(code, key, '缺少关联资料 %s：%s；请保留或一并选择对应记录' % (field, identifier), [required])
    _validate_historical_isolation(final, target, entries, changes, block)
    for r in changes:
        if r['dataset'] == 'meal_ledger_imports':
            value = r['backup'] or r['system']
            for key, consumer in entries(final, 'meal_ledger_records'):
                if (consumer['data'].get('import_key') == value['key']
                        and (consumer['month'] not in selection['months']
                             or 'meal_ledgers' not in selection['categories'])):
                    block('unselected_archive_consumer', r['row_key'], '该归档仍被未选台账范围引用，请明确选择消费月份及台账类别',
                          [key], month=consumer['month'], required_categories=['meal_ledgers', 'archives'])
        if r['month'] and r['dataset'] != 'account_set' and r['backup']:
            require(r['row_key'], {'account_month': r['month']}, 'account_month', 'account_set', 'missing_account')
        if r['backup'] and (r['dataset'] in FILE_DATASETS or r['dataset'] == 'users'):
            prefix = 'avatar_' if r['dataset'] == 'users' else 'file_'
            value = r['backup']
            file_key = value.get(prefix + 'file_key' if prefix == 'avatar_' else 'file_key')
            if file_key:
                content = document['_files'].get(file_key)
                if not isinstance(content, bytes):
                    block('missing_file', r['row_key'], '备份缺少所选记录的文件内容，请重新导入完整备份')
                elif (hashlib.sha256(content).hexdigest() != value.get(prefix + 'sha256')
                      or len(content) != value.get(prefix + 'size')):
                    block('invalid_file', r['row_key'], '备份文件内容与校验信息不一致')
        for month in r['affected_months']:
            if month in accounts and accounts[month].is_locked:
                block('locked', r['row_key'], '修改影响已锁定月份 %s，请先解锁' % month, month=month)
        if r['dataset'] == 'departments' and r['system'] and r['system'].get('is_locked'):
            block('department_locked', r['row_key'], '部门已锁定，请先解锁')
    for name in V2_DATASETS:
        for key, value in entries(final, name):
            shared = V2_DATASETS[name].scope == 'shared'
            # Every retained shared child and historical anchor is checked
            # against the final parent state, including unselected consumers.
            if shared and not value.get('is_active', True):
                continue
            if name == 'departments':
                require(key, value, 'parent_no', 'departments', 'missing_department')
            if name != 'departments':
                require(key, value, 'dept_no', 'departments', 'missing_department', allow_inactive=name == 'user_department_assignments')
            require(key, value, 'profile_dept_no', 'departments', 'missing_department')
            grants = name in ('user_employee_assignments', 'user_department_assignments')
            require(key, value, 'emp_no', 'employees', 'missing_employee', historical=not shared, allow_inactive=grants)
            require(key, value, 'shift_no', 'shifts', 'missing_shift', historical=not shared)
            require(key, value, 'username' if name != 'users' else '_none', 'users', 'missing_user', allow_inactive=grants)
            require(key, value, 'account_month', 'account_set', 'missing_account')
    cards = {}
    for key, value in entries(final, 'employees'):
        card = value.get('card_no')
        if card:
            if card in cards:
                block('card_conflict', key, '卡号 %s 被多个人员使用' % card, [cards[card]])
            cards[card] = key
    # Archived employees still hold the DB's unique card number.
    for key, value in entries(target, 'employees'):
        if value['emp_no'] not in maps['employees'] and value.get('card_no') in cards:
            block('card_conflict', key, '退出当前资料的人员仍占用卡号', [cards[value['card_no']]])
    for number, (key, value) in maps['departments'].items():
        seen, cursor = set(), number
        while cursor in maps['departments']:
            if cursor in seen:
                block('department_cycle', key, '部门父链存在循环：%s' % number)
                break
            seen.add(cursor)
            cursor = maps['departments'][cursor][1].get('parent_no')
    _validate_snapshots(final, target, entries, changes, selection, document, block)
    _validate_meals(final, target, source, entries, rows, changes, block)
    return blockers


def _validate_snapshots(final, target, entries, changes, selection, document, block):
    from services.monthly_reference_service import reference_change_blockers
    for r in changes:
        if r['dataset'] != 'snapshots':
            continue
        value = r['backup'] or r['system']
        proposed = dict(kind=value['kind'], business_key=value['business_key'],
                        payload=r['backup']['payload'] if r['backup'] else None)
        available = {DATASET_CATEGORIES[scope.split('/')[-1]] for scope, coverage in document['coverage'].items()
                     if scope.startswith('month/' + r['month'] + '/') and coverage['included']}
        for name in ('daily_records', 'monthly_reports', 'daily_overrides', 'employee_overrides', 'manager_overrides', 'meal_batches'):
            scope = _scope(name, r['month'])
            if target.get(scope) and not document['coverage'][scope]['included']:
                available.discard(DATASET_CATEGORIES[name])
        for conflict in reference_change_blockers(r['month'], [proposed], list(selection['categories'] & available)):
            block('snapshot_unselected_category', r['row_key'], conflict['reason'],
                  required_categories=conflict['required_categories'], month=r['month'])
    for month in document['months']:
        scope = _scope('snapshots', month)
        if (not document['coverage'][scope]['included'] or not (final.get(scope) or target.get(scope)
                or any(r['month'] == month and r['backup'] and r['backup'].get('emp_no') for r in changes))):
            continue  # V1 has no credible snapshot; never invent one.
        snapshots = {(v['kind'], v['business_key']): (scope + '/' + k, v)
                     for k, v in final.get(scope, {}).items()}
        def snapshot_ref(key, kind, identifier):
            if identifier and (kind, identifier) not in snapshots:
                required = scope + '/' + canonical([month, kind, identifier])
                block('missing_snapshot', key, '%s 缺少月度 %s 快照：%s' % (month, kind, identifier), [required])
        for key, value in snapshots.values():
            payload = value['payload']
            natural = {'employee': 'emp_no', 'department': 'dept_no', 'shift': 'shift_no'}[value['kind']]
            if payload.get(natural) != value['business_key']:
                block('snapshot_identity_mismatch', key, '月度快照业务编号与 payload 不一致')
            if value['kind'] == 'department':
                seen, cursor = set(), value['business_key']
                while ('department', cursor) in snapshots:
                    if cursor in seen:
                        block('snapshot_cycle', key, '月度部门父链存在循环')
                        break
                    seen.add(cursor)
                    cursor = snapshots[('department', cursor)][1]['payload'].get('parent_no')
            snapshot_ref(key, 'department', payload.get('dept_no') if value['kind'] == 'employee' else payload.get('parent_no'))
            snapshot_ref(key, 'shift', payload.get('default_shift_no'))
        # Only credible V2 scopes impose snapshot integrity, including children
        # kept by choices and consumers outside the selected category.
        for name, ds in V2_DATASETS.items():
            if ds.scope in ('shared', 'interval', 'year') or name == 'snapshots':
                continue
            for key, value in entries(final, name):
                if key.startswith('month/' + month + '/'):
                    snapshot_ref(key, 'employee', value.get('emp_no'))
                    snapshot_ref(key, 'shift', value.get('shift_no'))


def _validate_meals(final, target, source, entries, rows, changes, block):
    names = [name for name in V2_DATASETS if name.startswith('meal_')]
    def maps(state):
        return {name: {v['key']: (key, v) for key, v in entries(state, name)} for name in names}
    current, before, backup = maps(final), maps(target), maps(source)
    selected = {r['row_key']: r for r in rows}
    def reference(key, value, field, parent):
        identifier = value.get(field)
        if not identifier:
            return None
        found = current[parent].get(identifier)
        if found is None:
            candidate = backup[parent].get(identifier) or before[parent].get(identifier)
            required = candidate[0] if candidate else parent + '/' + identifier
            block('missing_meal_reference', key, '缺少菜票关联 %s：%s；请保留或一并选择对应记录' % (field, identifier), [required])
        elif parent != 'meal_ledger_imports' and value.get('month') != found[1].get('month'):
            block('meal_month_mismatch', key, '菜票关联记录业务月份不一致', [found[0]])
        return found
    def equal(left, right, ignored=()):
        return left is not None and right is not None and {k: v for k, v in left.items() if k not in ignored} == {k: v for k, v in right.items() if k not in ignored}
    for name, records in current.items():
        for key, value in records.values():
            for field, parent in (('batch_key', 'meal_batches'), ('item_key', 'meal_items'),
                                  ('import_key', 'meal_imports'), ('reversal_of', 'meal_payments')):
                reference(key, value, field, parent)
            if name == 'meal_ledger_records':
                reference(key, {**value, 'import_key': value['data'].get('import_key')}, 'import_key', 'meal_ledger_imports')
            if name == 'meal_payments':
                original = current['meal_payments'].get(value.get('reversal_of'))
                if (value['kind'] == 'reversal') != bool(value.get('reversal_of')) or (original and (
                        original[1]['kind'] == 'reversal' or original[1]['item_key'] != value['item_key']
                        or original[1]['amount_cents'] != -value['amount_cents'])):
                    block('meal_reversal_mismatch', key, '冲正必须对应同一明细的原交易，金额互为相反数', [original[0]] if original else [])
            if name not in ('meal_payments', 'meal_adjustments'):
                continue
            item = current['meal_items'].get(value['item_key'])
            batch = current['meal_batches'].get(item[1]['batch_key']) if item else None
            if not item or not batch:
                continue
            if name == 'meal_payments' and batch[1]['status'] != 'confirmed':
                block('meal_unconfirmed', key, '实际交易必须关联已确认核算批次', [batch[0]])
            r = selected.get(key)
            origin = backup if r and r['enabled'] and r['choice'] == 'backup' else before
            # Identical movements are supported by either origin, but a changed
            # movement retained by choice must match its own original snapshot.
            origins = [origin]
            if value['key'] in backup[name] and value['key'] in before[name] and equal(backup[name][value['key']][1], before[name][value['key']][1]):
                origins = [backup, before]
            coherent = False
            for candidate in origins:
                old_item = candidate['meal_items'].get(value['item_key'])
                old_batch = candidate['meal_batches'].get(old_item[1]['batch_key']) if old_item else None
                if old_item and old_batch and equal(item[1], old_item[1]) and equal(batch[1], old_batch[1], ('version',)):
                    coherent = True
            if not coherent:
                block('meal_snapshot_mismatch', key, '资金记录与最终核算明细/批次来自不同历史；请统一选择关联记录', [item[0], batch[0]])
    # A replacement of funds cannot silently retain movements absent from
    # that origin, even if the unchanged item payload happens to match.
    for r in changes:
        name, value = r['dataset'], r['backup']
        if name not in ('meal_payments', 'meal_adjustments') or not value:
            continue
        extra = [key for dataset in ('meal_payments', 'meal_adjustments')
                 for identity, (key, v) in current[dataset].items()
                 if v['item_key'] == value['item_key'] and identity not in backup[dataset]]
        if extra:
            block('meal_history_mismatch', r['row_key'], '采用备份资金记录时仍保留了备份之外的历史，请统一选择该明细的资金记录', extra)
    # Validate actual unique constraints and cross-ledger source deduplication.
    for name, fields in {
        'meal_items': [('batch_key', 'emp_no')],
        'meal_payments': [('request_key',), ('reversal_of',)],
        'meal_batches': [('key',), ('month',)],
        'meal_imports': [('file_digest', 'month')],
        'meal_ledger_records': [('active_slot',), ('request_key',), ('source_key',)],
    }.items():
        for fields_group in fields:
            seen = {}
            for key, value in current[name].values():
                identity = tuple(value.get(f) for f in fields_group)
                if any(v is None for v in identity):
                    continue
                if identity in seen:
                    block('meal_unique_conflict', key, '菜票标识重复：%s' % ', '.join(fields_group), [seen[identity]])
                seen[identity] = key
    payments = {v['request_key']: key for key, v in current['meal_payments'].values()}
    for key, value in current['meal_ledger_records'].values():
        if value.get('source_key') in payments:
            block('meal_ledger_unique_conflict', key, '同一来源不能同时计入台账清零与发放扣回', [payments[value['source_key']]])


def _validate_historical_isolation(final, target, entries, changes, block):
    """Current restore cannot change a legacy consumer still using live data."""
    changed = {}
    for r in changes:
        kind = {'employees': 'employee', 'departments': 'department', 'shifts': 'shift'}.get(r['dataset'])
        if kind:
            value = r['backup'] or r['system']
            changed[(kind, value[V2_DATASETS[r['dataset']].key[0]])] = r
    if not changed:
        return
    # Without any month snapshot the historical member list falls back to
    # current data, including newly added people and annual-only consumers.
    for account in AccountSet.query.all():
        scope = _scope('snapshots', account.month)
        if not final.get(scope):
            for r in changed.values():
                block('unisolated_history', r['row_key'], '当前资料修改会改变 %s 未采集快照的历史成员或年度展示，请先核对并补齐该月快照' % account.month,
                      [scope], month=account.month)
                if account.month not in r['affected_months']:
                    r['affected_months'].append(account.month)
                    r['affected_months'].sort()
    old_employees = {v['emp_no']: v for _, v in entries(target, 'employees')}
    old_departments = {v['dept_no']: v for _, v in entries(target, 'departments')}
    assignments = {v['emp_no']: v.get('shift_no') for _, v in entries(target, 'employee_shift_assignments')}
    for scope, records in final.items():
        if not scope.startswith('month/') or scope.endswith('/snapshots'):
            continue
        month = scope.split('/')[1]
        snapshots = {(v['kind'], v['business_key']) for v in final.get(_scope('snapshots', month), {}).values()}
        for identity, value in records.items():
            emp_no = value.get('emp_no')
            if not emp_no:
                continue
            refs = {('employee', emp_no)}
            old = old_employees.get(emp_no, {})
            dept = old.get('dept_no')
            seen = set()
            while dept and dept not in seen:
                seen.add(dept)
                refs.add(('department', dept))
                dept = old_departments.get(dept, {}).get('parent_no')
            refs.add(('shift', value.get('shift_no') or assignments.get(emp_no)))
            for reference in refs & changed.keys():
                if reference not in snapshots:
                    r = changed[reference]
                    block('unisolated_history', r['row_key'], '当前资料修改会影响 %s 尚未隔离的历史，请先核对并补齐该月快照' % month,
                          [scope + '/' + identity], month=month)
                    if month not in r['affected_months']:
                        r['affected_months'].append(month)
                        r['affected_months'].sort()
