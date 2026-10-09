"""Explicit, missing-only baseline capture and read-only legacy evidence scan.

Current values can establish stability from capture onward, not historical truth.
Historical views never refresh snapshots. Evidence is selected explicitly per field.
The caller owns the transaction; neither capture nor scan commits it.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date
from types import SimpleNamespace
import re
import shutil

from models import db
from models.account_set import AccountSet, AccountSetImport
from models.daily_record import DailyRecord
from models.department import Department
from models.employee import Employee
from models.employee_shift import EmployeeShiftAssignment
from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
from models.monthly_report import MonthlyReport
from models.shift import Shift
from models.system_setting import SystemSetting


REFERENCE_FIELDS = {
    'employee': ('emp_no', 'name', 'card_no', 'dingtalk_user_id', 'is_active',
                 'is_manager', 'meal_ticket_as_manager', 'is_nursing', 'include_in_manager_stats',
                 'employee_stats_attendance_source', 'manager_stats_attendance_source', 'resigned_at'),
    'department': ('dept_no', 'dept_name', 'is_active', 'is_locked'),
    'shift': ('shift_no', 'shift_name', 'is_active', 'time_slots', 'is_cross_day'),
}


def _validate_month(month):
    if not isinstance(month, str) or not re.fullmatch(r'[0-9]{4}-(0[1-9]|1[0-2])', month):
        raise ValueError('Invalid reference month')
    date(int(month[:4]), int(month[5:]), 1)


def _current_references():
    departments = {row.id: row for row in Department.query.order_by(Department.dept_no).all()}
    shifts = {row.id: row for row in Shift.query.order_by(Shift.shift_no).all()}
    assignments = {row.emp_id: shifts.get(row.shift_id) for row in EmployeeShiftAssignment.query.all()}
    rows = {'employee': Employee.query.order_by(Employee.emp_no).all(),
            'department': list(departments.values()), 'shift': list(shifts.values())}
    references = []
    manager_source = SystemSetting.get_value('manager_attendance_source', 'local')
    employee_source = SystemSetting.get_value('employee_attendance_source', 'local')
    for kind, items in rows.items():
        key_field = REFERENCE_FIELDS[kind][0]
        for row in items:
            payload = {field: deepcopy(getattr(row, field)) for field in REFERENCE_FIELDS[kind]}
            if kind == 'employee':
                department = departments.get(row.dept_id)
                shift = assignments.get(row.id)
                payload.update(dept_no=department.dept_no if department else None,
                               default_shift_no=shift.shift_no if shift else None,
                               manager_attendance_source=manager_source,
                               employee_attendance_source=employee_source)
                if payload['resigned_at'] is not None:
                    payload['resigned_at'] = payload['resigned_at'].isoformat()
            elif kind == 'department':
                parent = departments.get(row.parent_id)
                payload['parent_no'] = parent.dept_no if parent else None
            references.append((kind, getattr(row, key_field), payload))
    return references


def ensure_month_reference(month: str) -> None:
    """Create missing baselines, including inactive rows needed by historical FKs.

    Call explicitly after inspecting the scan report for legacy months. Evidence
    candidates never silently replace baselines; verified/partial reconciliation
    must retain field sources and resolve conflicting candidates explicitly.
    """
    _validate_month(month)
    existing = {(row.kind, row.business_key) for row in MonthlyReferenceSnapshot.query.filter_by(month=month)}
    for kind, key, payload in _current_references():
        if (kind, key) not in existing:
            db.session.add(MonthlyReferenceSnapshot(
                month=month, kind=kind, business_key=key, payload=payload,
                provenance={'source': 'current_baseline', 'fields': {field: 'baseline' for field in payload}},
                quality='baseline', schema_version=1,
            ))
    db.session.flush()


def get_month_reference(month: str, kind: str, business_key: str) -> dict | None:
    _validate_month(month)
    if kind not in REFERENCE_FIELDS:
        raise ValueError('Invalid reference kind')
    row = MonthlyReferenceSnapshot.query.filter_by(month=month, kind=kind, business_key=business_key).first()
    return deepcopy(row.payload) if row else None


def month_reference_views(month: str) -> dict:
    """Read detached historical objects; never change ORM identities or capture on read.

    Local IDs are resolved by business key only to address business records and
    current permission grants. Reference attributes/relationships come from the
    month's payload. Uncaptured legacy months retain the old read path with an
    explicit missing-quality warning, until an operator reconciles them.
    """
    _validate_month(month)
    snapshots = MonthlyReferenceSnapshot.query.filter_by(month=month).all()
    if not snapshots:
        return {'employees': Employee.query.order_by(Employee.emp_no).all(),
                'departments': Department.query.all(), 'shifts': Shift.query.all()}
    by_kind = {kind: {} for kind in REFERENCE_FIELDS}
    models = {'employee': Employee, 'department': Department, 'shift': Shift}
    defaults = {'employee': dict(name='', card_no=None, dingtalk_user_id=None, is_active=True,
                                is_manager=False, is_nursing=False, meal_ticket_as_manager=False,
                                include_in_manager_stats=True, resigned_at=None,
                                manager_attendance_source='local',
                                employee_stats_attendance_source='employee', manager_stats_attendance_source='manager'),
                'department': dict(dept_name='', is_active=True, is_locked=False),
                'shift': dict(shift_name='', is_active=True, time_slots=[], is_cross_day=False)}
    local_ids = {kind: {getattr(row, REFERENCE_FIELDS[kind][0]): row.id for row in model.query.all()}
                 for kind, model in models.items()}
    for row in snapshots:
        if row.kind not in by_kind:
            continue
        payload = {**deepcopy(defaults[row.kind]), **deepcopy(row.payload)}
        payload[REFERENCE_FIELDS[row.kind][0]] = row.business_key
        payload['id'] = local_ids[row.kind].get(row.business_key)
        payload['reference'] = {'quality': row.quality, 'provenance': deepcopy(row.provenance),
                                'schema_version': row.schema_version,
                                'warnings': [] if row.quality == 'verified' else ['月度资料为基线或部分资料，不能证明完整历史。']}
        if row.kind == 'employee' and isinstance(payload.get('resigned_at'), str):
            payload['resigned_at'] = date.fromisoformat(payload['resigned_at'])
        by_kind[row.kind][row.business_key] = SimpleNamespace(**payload)
    for department in by_kind['department'].values():
        department.parent = by_kind['department'].get(getattr(department, 'parent_no', None))
        department.parent_id = department.parent.id if department.parent else None
    for employee in by_kind['employee'].values():
        employee._reference_month = month
        employee._reference_shifts = by_kind['shift']
        employee.department = by_kind['department'].get(getattr(employee, 'dept_no', None))
        employee.dept_id = employee.department.id if employee.department else None
        shift = by_kind['shift'].get(getattr(employee, 'default_shift_no', None))
        employee.shift_assignment = SimpleNamespace(shift=shift, shift_id=shift.id) if shift else None
    return {'employees': sorted((e for e in by_kind['employee'].values() if e.id is not None), key=lambda e: e.emp_no),
            'departments': list(by_kind['department'].values()), 'shifts': list(by_kind['shift'].values())}


def month_employees(month: str, emp_ids=None, is_manager=None, include_resigned=True) -> list:
    employees = month_reference_views(month)['employees']
    if emp_ids is not None:
        ids = set(emp_ids)
        employees = [e for e in employees if e.id in ids]
    if is_manager is not None:
        employees = [e for e in employees if bool(e.is_manager) == is_manager]
    if not include_resigned:
        first = date.fromisoformat(month + '-01')
        employees = [e for e in employees if e.is_active and (not e.resigned_at or
                     (getattr(e, '_reference_month', None) == month and e.resigned_at >= first))]
    return employees


def month_employee(employee, month: str):
    if employee is None:
        return None
    if employee.id is None:
        return employee  # Transient records used by the pure calculation helpers.
    # Already resolved objects avoid extra reads in batch attendance loops.
    if getattr(employee, '_reference_month', None) == month:
        return employee
    rows = month_employees(month, [employee.id])
    if not rows:
        return None
    result = rows[0]
    if isinstance(result, SimpleNamespace):
        result._reference_month = month
    return result


def reference_status(employee) -> dict:
    return deepcopy(getattr(employee, 'reference', {
        'quality': 'missing', 'provenance': None, 'schema_version': None,
        'warnings': ['尚无月度资料快照，当前显示兼容资料，历史身份和计算口径未经核对。'],
    }))


def reference_key_in_use(kind: str, business_key: str) -> bool:
    """Keep current business-key bindings stable once history addresses them."""
    return MonthlyReferenceSnapshot.query.filter_by(kind=kind, business_key=business_key).first() is not None


def month_business_sources(month: str) -> dict:
    """Month-wide ingestion switches frozen with the first reference capture.

    A legacy captured payload lacking switches uses local archives, rather than
    letting a current external-source setting change a past recalculation.
    """
    _validate_month(month)
    snapshot = MonthlyReferenceSnapshot.query.filter_by(month=month, kind='employee').order_by(MonthlyReferenceSnapshot.id).first()
    fields = ('employee_attendance_source', 'manager_attendance_source')
    if snapshot:
        return {field: snapshot.payload.get(field, 'local') for field in fields}
    if MonthlyReferenceSnapshot.query.filter_by(month=month).first():
        return {field: 'local' for field in fields}
    return {field: SystemSetting.get_value(field, 'local') for field in fields}


def capture_business_month(month: str) -> None:
    """Missing-only capture at an explicit business write, in its transaction.

    Capture stays baseline: imported identity evidence may disagree with current
    references. Only explicit reconciliation can attest historical fields.
    """
    if MonthlyReferenceSnapshot.query.filter_by(month=month).first() is None:
        ensure_month_reference(month)


def reference_change_blockers(month: str, proposed: list, selected_categories: list) -> list:
    """Stage 7 contract: proposed month snapshots require all existing consumers.

    This is deliberately conservative: a shared reference change may affect any
    consumer in the month, so the caller must explicitly select them together.
    No category is silently added. An absent snapshot also counts as a change.
    """
    from models.meal_ticket import MealTicketBatch
    from models.daily_attendance_override import DailyAttendanceOverride
    from models.employee_attendance_override import EmployeeAttendanceOverride
    from models.manager_attendance_override import ManagerAttendanceOverride

    _validate_month(month)
    changed = [row for row in proposed if get_month_reference(month, row['kind'], row['business_key']) != row['payload']]
    if not changed:
        return []
    required = set()
    start = date.fromisoformat(month + '-01')
    end = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
    if (DailyRecord.query.filter(DailyRecord.record_date >= start, DailyRecord.record_date < end).first()
            or MonthlyReport.query.filter_by(report_month=month).first()
            or DailyAttendanceOverride.query.filter(DailyAttendanceOverride.record_date >= start,
                                                    DailyAttendanceOverride.record_date < end).first()
            or EmployeeAttendanceOverride.query.filter_by(month=month).first()
            or ManagerAttendanceOverride.query.filter_by(month=month).first()):
        required.add('attendance')
    if MealTicketBatch.query.filter_by(month=month).first():
        required.add('meal_tickets')
    if required <= set(selected_categories):
        return []
    return [{'month': month, 'kind': row['kind'], 'business_key': row['business_key'],
             'required_categories': sorted(required), 'affected_months': [month],
             'reason': '月度资料由多个类别共享，请明确选择所有受影响类别。'} for row in changed]


def correct_month_reference(month: str, kind: str, business_key: str, changes: dict,
                            selected_categories: list) -> None:
    """Explicit month-only correction; no commit, no current-reference mutation."""
    _validate_month(month)
    account = AccountSet.query.filter_by(month=month).first()
    if account and account.is_locked:
        raise ValueError('月份已锁定，请先解锁')
    row = MonthlyReferenceSnapshot.query.filter_by(month=month, kind=kind, business_key=business_key).first()
    if row is None:
        raise ValueError('请先核对并显式采集该月基线资料')
    extra = {'employee': {'dept_no', 'default_shift_no', 'manager_attendance_source'},
             'department': {'parent_no'}, 'shift': set()}
    allowed = (set(REFERENCE_FIELDS.get(kind, ())) | extra.get(kind, set())) - {REFERENCE_FIELDS[kind][0]}
    if not changes or not set(changes) <= allowed:
        raise ValueError('无效的月度资料字段')
    payload = {**deepcopy(row.payload), **deepcopy(changes)}
    if kind == 'employee':
        for field, target, label in (('dept_no', 'department', '部门'), ('default_shift_no', 'shift', '班次')):
            if payload.get(field) and get_month_reference(month, target, payload[field]) is None:
                raise ValueError(label + '不在该月资料中')
    if kind == 'department':
        parent = payload.get('parent_no')
        seen = {business_key}
        while parent:
            if parent in seen:
                raise ValueError('部门父链形成循环')
            seen.add(parent)
            reference = get_month_reference(month, 'department', parent)
            if reference is None:
                raise ValueError('父部门不在该月资料中')
            parent = reference.get('parent_no')
    blockers = reference_change_blockers(month, [{'kind': kind, 'business_key': business_key, 'payload': payload}], selected_categories)
    if blockers:
        raise ValueError(blockers[0]['reason'] + ' ' + ', '.join(blockers[0]['required_categories']))
    row.payload = payload
    provenance = deepcopy(row.provenance)
    provenance.setdefault('fields', {}).update({field: 'explicit_month_correction' for field in changes})
    row.provenance = provenance
    # A correction proves only those fields; it cannot upgrade the whole baseline.
    row.quality = 'partial'
    db.session.flush()


def reconcile_month_evidence(month: str, decisions: list, selected_categories: list, inspect_archives: bool = False) -> None:
    """Choose exact scanned candidates explicitly, retaining their field sources.

    All choices are checked before writing. Ambiguous department names are
    rejected rather than mapped to an arbitrary current department.
    """
    report = next((row for row in scan_legacy_month_references(inspect_archives)['months'] if row['month'] == month), None)
    if report is None:
        raise ValueError('月份没有可核对证据')
    prepared = []
    for decision in decisions:
        evidence = next((row for row in report['evidence'] if row['business_key'] == decision['business_key']
                         and row['field'] == decision['field']), None)
        candidate = next((row for row in evidence['candidates'] if row['value'] == decision['value']), None) if evidence else None
        if candidate is None:
            raise ValueError('所选值不在扫描证据中')
        field, value = decision['field'], decision['value']
        if field == 'dept_name':
            departments = [row for row in month_reference_views(month)['departments'] if row.dept_name == value]
            if len(departments) != 1:
                raise ValueError('部门证据无法唯一对应，请先修正月度部门资料')
            field, value = 'dept_no', departments[0].dept_no
        row = MonthlyReferenceSnapshot.query.filter_by(month=month, kind='employee', business_key=decision['business_key']).first()
        if row is None:
            raise ValueError('请先显式采集该月基线资料')
        payload = {**deepcopy(row.payload), field: value}
        if reference_change_blockers(month, [{'kind': 'employee', 'business_key': row.business_key,
                                              'payload': payload}], selected_categories):
            raise ValueError('月度资料由多个类别共享，请明确选择所有受影响类别')
        prepared.append((row, field, value, candidate))
    account = AccountSet.query.filter_by(month=month).first()
    if account and account.is_locked:
        raise ValueError('月份已锁定，请先解锁')
    for row, field, value, candidate in prepared:
        row.payload = {**deepcopy(row.payload), field: value}
        provenance = deepcopy(row.provenance)
        provenance.setdefault('fields', {})[field] = {'source': 'explicit_evidence_selection',
                                                     'sources': deepcopy(candidate['sources'])}
        row.provenance = provenance
        row.quality = 'partial'
    db.session.flush()


def scan_legacy_month_references(inspect_archives: bool = False) -> dict:
    """Report missing snapshots and sourced candidates without flushing or writing.

    A source proves what was stored, not every field of an employee's past state.
    Archive inspection is optional and read-only; candidates require explicit decisions.
    """
    from models.daily_attendance_override import DailyAttendanceOverride
    from models.employee_attendance_override import EmployeeAttendanceOverride
    from models.manager_attendance_override import ManagerAttendanceOverride
    from models.meal_ticket import MealTicketBatch, MealTicketItem, MealTicketImport
    from models.meal_ledger import MealLedgerRecord, MealLedgerImport

    with db.session.no_autoflush:
        months = {row.month for row in AccountSet.query.all()}
        employees = {row.id: row.emp_no for row in Employee.query.all()}
        evidence = {}

        def add(month, emp_no, field, value, source):
            if not emp_no or value is None or value == '':
                return
            key = (month, emp_no, field)
            candidates = evidence.setdefault(key, [])
            candidate = next((item for item in candidates if item['value'] == value), None)
            if candidate is None:
                candidate = {'value': deepcopy(value), 'sources': []}
                candidates.append(candidate)
            if source not in candidate['sources']:
                candidate['sources'].append(source)

        def raw_evidence(month, row, column):
            raw = getattr(row, column)
            if not isinstance(raw, dict):
                return
            if isinstance(raw.get('raw_data'), dict):
                raw = raw['raw_data']
            for field, labels in (('name', ('姓名',)), ('dept_name', ('部门', '部门名称'))):
                for label in labels:
                    add(month, employees.get(row.emp_id), field, raw.get(label),
                        {'table': row.__tablename__, 'id': row.id, 'field': column + '.' + label})

        for row in DailyRecord.query.all():
            month = row.record_date.strftime('%Y-%m')
            months.add(month)
            for column in ('raw_data', 'employee_payload', 'manager_payload'):
                raw_evidence(month, row, column)
        for row in MonthlyReport.query.all():
            months.add(row.report_month)
            for column in ('raw_data', 'employee_raw_data', 'manager_raw_data'):
                raw_evidence(row.report_month, row, column)
        for row in MealTicketItem.query.all():
            months.add(row.month)
            for field in ('name', 'dept_name', 'is_manager'):
                add(row.month, row.emp_no_snapshot, field, getattr(row, field),
                    {'table': row.__tablename__, 'key': row.key, 'field': field})
        for model, column in ((DailyAttendanceOverride, 'record_date'),
                              (EmployeeAttendanceOverride, 'month'), (ManagerAttendanceOverride, 'month'),
                              (MealTicketBatch, 'month'), (MealTicketImport, 'month'),
                              (MealLedgerRecord, 'month'), (MealLedgerImport, 'month')):
            for row in model.query.all():
                value = getattr(row, column)
                months.add(value.strftime('%Y-%m') if isinstance(value, date) else value)
        references = _current_references()
        snapshots = {(row.month, row.kind, row.business_key) for row in MonthlyReferenceSnapshot.query.all()}
        archives = {}
        for row in AccountSetImport.query.all():
            account = db.session.get(AccountSet, row.account_set_id)
            if account:
                entry = {'id': row.id, 'source_filename': row.source_filename,
                         'file_type': row.file_type, 'status': 'not_inspected'}
                archives.setdefault(account.month, []).append(entry)
                if not inspect_archives or row.file_type not in {'daily', 'monthly', 'manager_daily', 'manager_monthly'}:
                    continue
                normalized = None
                try:
                    from services.import_pipeline import normalize_import_rows
                    from utils.helpers import clean_text
                    normalized = normalize_import_rows(row.stored_path, file_type=row.file_type)
                    headers = next((items for items in normalized.rows[:8]
                                    if any(clean_text(value) in {'人员编号', '工号'} for value in items)), None)
                    if headers is None:
                        entry['status'] = 'unreadable'
                        continue
                    columns = {clean_text(value): index for index, value in enumerate(headers)}
                    emp_column = columns.get('人员编号', columns.get('工号'))
                    for items in normalized.rows[normalized.rows.index(headers) + 1:]:
                        key = clean_text(items[emp_column]) if emp_column < len(items) else ''
                        if key not in set(employees.values()):
                            continue
                        for field, labels in (('name', ('人员名称', '姓名')), ('dept_name', ('部门名称', '部门'))):
                            for label in labels:
                                column = columns.get(label)
                                if column is not None and column < len(items):
                                    add(account.month, key, field, clean_text(items[column]),
                                        {'table': 'account_set_imports', 'id': row.id, 'field': label,
                                         'source_filename': row.source_filename})
                    entry['status'] = 'inspected'
                except (OSError, ValueError, TypeError):
                    entry['status'] = 'unreadable'
                finally:
                    if normalized and normalized.cleanup_dir:
                        shutil.rmtree(normalized.cleanup_dir, ignore_errors=True)
        report = []
        for month in sorted(months):
            _validate_month(month)
            missing = {kind: [key for item_kind, key, _ in references
                              if item_kind == kind and (month, kind, key) not in snapshots]
                       for kind in REFERENCE_FIELDS}
            fields = [{'kind': 'employee', 'business_key': key, 'field': field,
                       'candidates': candidates, 'conflict': len(candidates) > 1}
                      for (item_month, key, field), candidates in sorted(evidence.items()) if item_month == month]
            report.append({'month': month, 'missing': missing, 'evidence': fields,
                           'archives': archives.get(month, []), 'baseline_quality': 'baseline'})
        return {'months': report, 'warnings': ['Current references are baselines, not verified history.',
                                               'Archive evidence requires explicit candidate selection.']}


def register_monthly_reference_commands(app):
    """Expose scanning separately from explicit, transactional baseline capture."""
    import json
    import click

    @app.cli.command('scan-month-references')
    @click.option('--inspect-archives', is_flag=True, help='Read archived workbooks as evidence without modifying business data.')
    def scan_command(inspect_archives):
        click.echo(json.dumps(scan_legacy_month_references(inspect_archives), ensure_ascii=False))

    @app.cli.command('capture-month-references')
    @click.option('--month', 'months', multiple=True, required=True, help='Month to capture as a baseline (YYYY-MM).')
    def capture_command(months):
        try:
            for month in months:
                _validate_month(month)
            for month in dict.fromkeys(months):
                ensure_month_reference(month)
            db.session.commit()
        except ValueError as exc:
            db.session.rollback()
            raise click.ClickException(str(exc)) from exc
        except Exception:
            db.session.rollback()
            raise
        click.echo('Captured missing baselines for ' + ', '.join(dict.fromkeys(months)) +
                   '; existing snapshots were preserved. Baselines do not prove historical truth.')

    @app.cli.command('correct-month-reference')
    @click.option('--month', required=True)
    @click.option('--kind', type=click.Choice(list(REFERENCE_FIELDS)), required=True)
    @click.option('--key', required=True)
    @click.option('--payload-file', type=click.File('r'), required=True)
    @click.option('--category', 'categories', multiple=True, required=True)
    def correct_command(month, kind, key, payload_file, categories):
        try:
            correct_month_reference(month, kind, key, json.load(payload_file), list(categories))
            db.session.commit()
        except (ValueError, KeyError, TypeError) as exc:
            db.session.rollback()
            raise click.ClickException(str(exc)) from exc
        click.echo('Corrected only ' + month + '/' + kind + '/' + key + '; quality remains partial.')

    @app.cli.command('reconcile-month-evidence')
    @click.option('--month', required=True)
    @click.option('--decisions-file', type=click.File('r'), required=True)
    @click.option('--category', 'categories', multiple=True, required=True)
    @click.option('--inspect-archives', is_flag=True)
    def reconcile_command(month, decisions_file, categories, inspect_archives):
        try:
            reconcile_month_evidence(month, json.load(decisions_file), list(categories), inspect_archives)
            db.session.commit()
        except (ValueError, KeyError, TypeError) as exc:
            db.session.rollback()
            raise click.ClickException(str(exc)) from exc
        click.echo('Reconciled chosen evidence for ' + month + '; uncured baseline fields remain partial.')
