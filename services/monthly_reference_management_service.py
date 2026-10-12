"""Administrator previews for existing month-owned reference operations."""
from copy import deepcopy
from datetime import date
import hashlib
import hmac
import json
import re

from flask import current_app

from models import db
from models.account_set import AccountSet
from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
from services.monthly_reference_service import (
    REFERENCE_FIELDS, _current_references, _validate_month, correct_month_reference,
    reconcile_month_evidence, reference_change_blockers, scan_legacy_month_references,
)

KINDS = tuple(REFERENCE_FIELDS)
CATEGORIES = ('attendance', 'meal_tickets')
EXTRA_FIELDS = {'employee': ('dept_no', 'default_shift_no'),
                'department': ('parent_no',), 'shift': ()}
BOOL_FIELDS = {'is_active', 'is_manager', 'meal_ticket_as_manager', 'is_nursing',
               'include_in_manager_stats', 'is_locked', 'is_cross_day'}
ENUM_FIELDS = {'employee_stats_attendance_source': ('employee', 'manager', 'auto_fallback'),
               'manager_stats_attendance_source': ('employee', 'manager', 'auto_fallback')}


class ReferencePreviewChanged(ValueError):
    pass


def serialize_snapshot(row):
    return {field: deepcopy(getattr(row, field)) for field in
            ('month', 'kind', 'business_key', 'payload', 'provenance', 'quality', 'schema_version')}


def list_reference_months():
    report = scan_legacy_month_references()
    accounts = {row.month: row for row in AccountSet.query.all()}
    snapshots = {}
    for row in MonthlyReferenceSnapshot.query.all():
        snapshots.setdefault(row.month, []).append(row)
    scans = {row['month']: row for row in report['months']}
    current_keys = {(kind, key) for kind, key, _ in _current_references()}
    rows = []
    for month in sorted(set(scans) | set(snapshots), reverse=True):
        existing = snapshots.get(month, [])
        account = accounts.get(month)
        rows.append(dict(month=month, name=account.name if account else '',
                         is_locked=bool(account and account.is_locked), snapshot_count=len(existing),
                         missing_count=len(current_keys - {(row.kind, row.business_key) for row in existing}),
                         quality_counts={quality: sum(row.quality == quality for row in existing)
                                         for quality in ('baseline', 'partial', 'verified')}))
    return {'months': rows}


def reference_detail(month, inspect_archives=False):
    _validate_month(month)
    report = next((row for row in scan_legacy_month_references(inspect_archives)['months']
                   if row['month'] == month), None)
    account = AccountSet.query.filter_by(month=month).first()
    snapshots = MonthlyReferenceSnapshot.query.filter_by(month=month).order_by(
        MonthlyReferenceSnapshot.kind, MonthlyReferenceSnapshot.business_key).all()
    if report is None and not snapshots:
        raise LookupError('月份不存在，请选择已有业务月份')
    existing = {(row.kind, row.business_key) for row in snapshots}
    current = [{'kind': kind, 'business_key': key, 'payload': payload}
               for kind, key, payload in _current_references()]
    return dict(month=month, is_locked=bool(account and account.is_locked),
                snapshots=[serialize_snapshot(row) for row in snapshots],
                missing=[row for row in current if (row['kind'], row['business_key']) not in existing],
                current=current, evidence=(report or {}).get('evidence', []),
                archives=(report or {}).get('archives', []),
                editable_fields={kind: list(REFERENCE_FIELDS[kind][1:] + EXTRA_FIELDS[kind]) for kind in KINDS})


def validate_operation(operation):
    if not isinstance(operation, dict):
        raise ValueError('请选择有效的快照操作')
    action = operation.get('action')
    allowed = {'capture': {'action'},
               'correct': {'action', 'kind', 'business_key', 'changes', 'categories'},
               'reconcile': {'action', 'decisions', 'categories', 'inspect_archives'}}
    if not isinstance(action, str) or action not in allowed or set(operation) - allowed[action]:
        raise ValueError('快照操作无效')
    if action == 'capture':
        return
    categories = operation.get('categories')
    if (not isinstance(categories, list) or any(not isinstance(v, str) or v not in CATEGORIES for v in categories)
            or len(set(categories)) != len(categories)):
        raise ValueError('请选择有效的受影响业务类别')
    if action == 'reconcile':
        decisions = operation.get('decisions')
        if type(operation.get('inspect_archives', False)) is not bool or not isinstance(decisions, list) or not decisions:
            raise ValueError('请明确选择历史证据')
        keys = set()
        for decision in decisions:
            if (not isinstance(decision, dict) or set(decision) != {'business_key', 'field', 'value'}
                    or not isinstance(decision['business_key'], str) or not decision['business_key']
                    or decision['field'] not in ('name', 'dept_name', 'is_manager')):
                raise ValueError('历史证据选择无效')
            key = (decision['business_key'], decision['field'])
            if key in keys:
                raise ValueError('同一资料字段只能选择一个历史证据')
            keys.add(key)
        return
    kind, key, changes = operation.get('kind'), operation.get('business_key'), operation.get('changes')
    if (not isinstance(kind, str) or kind not in KINDS or not isinstance(key, str) or not key
            or not isinstance(changes, dict) or not changes
            or set(changes) - set(REFERENCE_FIELDS[kind][1:] + EXTRA_FIELDS[kind])):
        raise ValueError('请选择具体快照及有效修正字段')
    for field, value in changes.items():
        valid = False
        if field in BOOL_FIELDS:
            valid = type(value) is bool
        elif field in ENUM_FIELDS:
            valid = isinstance(value, str) and value in ENUM_FIELDS[field]
        elif field == 'resigned_at':
            if value is None:
                valid = True
            elif isinstance(value, str):
                try:
                    valid = date.fromisoformat(value).isoformat() == value
                except ValueError:
                    pass
        elif field == 'time_slots':
            valid = isinstance(value, list) and all(
                isinstance(slot, list) and len(slot) == 2 and all(isinstance(clock, str) and
                    re.fullmatch(r'([01]?[0-9]|2[0-3]):[0-5][0-9]', clock) for clock in slot)
                for slot in value)
        else:
            nullable = field in {'card_no', 'dingtalk_user_id', 'dept_no', 'default_shift_no', 'parent_no'}
            limit = 120 if field == 'dept_name' else 50 if field in {'card_no', 'dept_no', 'default_shift_no', 'parent_no'} else 100
            valid = (value is None and nullable) or (isinstance(value, str) and bool(value.strip()) and len(value) <= limit)
        if not valid:
            raise ValueError('修正字段的值无效：' + field)


def execute_operation(month, operation, missing):
    if operation['action'] == 'capture':
        # Write precisely the reviewed payloads, never collect additional live rows here.
        for row in missing:
            db.session.add(MonthlyReferenceSnapshot(
                month=month, kind=row['kind'], business_key=row['business_key'], payload=deepcopy(row['payload']),
                provenance={'source': 'current_baseline', 'fields': {field: 'baseline' for field in row['payload']}},
                quality='baseline', schema_version=1))
        db.session.flush()
    elif operation['action'] == 'correct':
        correct_month_reference(month, operation['kind'], operation['business_key'],
                                operation['changes'], operation['categories'])
    else:
        reconcile_month_evidence(month, operation['decisions'], operation['categories'],
                                 operation.get('inspect_archives', False))


def preview_reference_operation(month, operation):
    validate_operation(operation)
    before = reference_detail(month, operation.get('inspect_archives', False))
    if before['is_locked']:
        raise ValueError('月份已锁定，请先在账套中心解锁')
    savepoint = db.session.begin_nested()
    try:
        execute_operation(month, operation, before['missing'])
        after = [serialize_snapshot(row) for row in MonthlyReferenceSnapshot.query.filter_by(month=month).order_by(
            MonthlyReferenceSnapshot.kind, MonthlyReferenceSnapshot.business_key).all()]
    finally:
        savepoint.rollback()
    old = {(row['kind'], row['business_key']): row for row in before['snapshots']}
    changes = [{'kind': row['kind'], 'business_key': row['business_key'],
                'before': old.get((row['kind'], row['business_key'])), 'after': row}
               for row in after if row != old.get((row['kind'], row['business_key']))]
    blockers = reference_change_blockers(month, [row['after'] for row in changes], [])
    required = sorted({category for row in blockers for category in row['required_categories']})
    encoded = json.dumps([month, operation, before, changes, required], sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    fingerprint = hmac.new(current_app.config['SECRET_KEY'].encode(), encoded.encode(), hashlib.sha256).hexdigest()
    return dict(month=month, action=operation['action'], changes=changes, required_categories=required,
                fingerprint=fingerprint), before['missing']


def apply_reference_operation(month, operation, fingerprint):
    _validate_month(month)
    if not isinstance(fingerprint, str) or not re.fullmatch('[0-9a-f]{64}', fingerprint):
        raise ValueError('请先预览快照变更并确认')
    AccountSet.query.filter_by(month=month).with_for_update().all()
    MonthlyReferenceSnapshot.query.filter_by(month=month).with_for_update().all()
    compared, missing = preview_reference_operation(month, operation)
    if not hmac.compare_digest(compared['fingerprint'], fingerprint):
        raise ReferencePreviewChanged('资料已发生变化，请重新核对并预览')
    execute_operation(month, operation, missing)
    return {'month': month, 'changed_count': len(compared['changes'])}
