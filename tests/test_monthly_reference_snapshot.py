from copy import deepcopy
from datetime import date
from pathlib import Path

import pytest
from flask import Flask
from flask_migrate import Migrate, stamp, upgrade, downgrade
from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError

from models import db
from models.daily_record import DailyRecord
from models.department import Department
from models.employee import Employee
from models.employee_shift import EmployeeShiftAssignment
from models.shift import Shift
from tests.test_account_set_backup import backup_app


def test_snapshot_is_not_refreshed_by_current_change(backup_app):
    from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
    from services.monthly_reference_service import ensure_month_reference, get_month_reference

    parent = Department(dept_no='D0', dept_name='总厂')
    shift = Shift(shift_no='S1', shift_name='白班', time_slots=[{'start': '08:00', 'end': '17:00'}])
    db.session.add_all([parent, shift])
    db.session.flush()
    department = Department.query.filter_by(dept_no='D1').one()
    department.parent_id = parent.id
    employee = Employee.query.filter_by(emp_no='E1').one()
    db.session.add(EmployeeShiftAssignment(emp_id=employee.id, shift_id=shift.id))
    db.session.commit()

    ensure_month_reference('2026-06')
    db.session.commit()
    before = deepcopy(get_month_reference('2026-06', 'employee', 'E1'))
    assert before['name'] == '甲'
    assert before['dept_no'] == 'D1'
    assert before['default_shift_no'] == 'S1'
    assert before['employee_stats_attendance_source'] == 'employee'
    assert get_month_reference('2026-06', 'department', 'D1')['parent_no'] == 'D0'
    assert get_month_reference('2026-06', 'shift', 'S1')['time_slots'] == [{'start': '08:00', 'end': '17:00'}]

    department.dept_name = '新部门名称'
    department.parent_id = None
    employee.name = '新姓名'
    employee.is_manager = True
    employee.employee_stats_attendance_source = 'manager'
    employee.resigned_at = date(2026, 7, 1)
    shift.time_slots = []
    db.session.commit()
    ensure_month_reference('2026-06')
    db.session.commit()
    assert get_month_reference('2026-06', 'employee', 'E1') == before
    assert get_month_reference('2026-06', 'department', 'D1')['dept_name'] == '生产'
    assert get_month_reference('2026-06', 'department', 'D1')['parent_no'] == 'D0'
    assert get_month_reference('2026-06', 'shift', 'S1')['time_slots'] == [{'start': '08:00', 'end': '17:00'}]
    snapshot = MonthlyReferenceSnapshot.query.filter_by(month='2026-06', kind='employee', business_key='E1').one()
    assert snapshot.quality == 'baseline'
    assert snapshot.provenance['source'] == 'current_baseline'
    assert snapshot.schema_version == 1
    assert snapshot.created_at is not None and snapshot.updated_at is not None


def test_capture_adds_only_missing_keys_and_is_month_scoped(backup_app):
    from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
    from services.monthly_reference_service import ensure_month_reference, get_month_reference

    ensure_month_reference('2026-06')
    db.session.commit()
    first = get_month_reference('2026-06', 'employee', 'E1')
    # Mutating a returned payload must not mutate the persistent snapshot.
    first['name'] = 'caller changed copy'
    assert get_month_reference('2026-06', 'employee', 'E1')['name'] == '甲'
    Employee.query.one().name = '乙'
    db.session.add(Employee(emp_no='E2', name='无业务记录'))
    db.session.commit()
    ensure_month_reference('2026-06')
    ensure_month_reference('2026-07')
    db.session.commit()
    assert get_month_reference('2026-06', 'employee', 'E1')['name'] == '甲'
    assert get_month_reference('2026-07', 'employee', 'E1')['name'] == '乙'
    assert get_month_reference('2026-06', 'employee', 'E2')['name'] == '无业务记录'
    assert get_month_reference('2026-08', 'employee', 'E1') is None
    assert MonthlyReferenceSnapshot.query.filter_by(month='2026-06').count() == 3


def test_capture_does_not_commit_callers_transaction(backup_app):
    from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
    from services.monthly_reference_service import ensure_month_reference

    Employee.query.one().name = 'not committed'
    ensure_month_reference('2026-06')
    db.session.rollback()
    assert Employee.query.one().name == '甲'
    assert MonthlyReferenceSnapshot.query.count() == 0


def test_inactive_references_keep_business_foreign_keys_and_can_be_reactivated(backup_app):
    from services.monthly_reference_service import ensure_month_reference, get_month_reference

    employee, department = Employee.query.one(), Department.query.one()
    shift = Shift(shift_no='S1', shift_name='旧班次', time_slots=[])
    db.session.add(shift)
    db.session.commit()
    assert employee.is_active and department.is_active and shift.is_active
    record = DailyRecord.query.one()
    record.shift_id = shift.id
    identifiers = employee.id, department.id, shift.id
    employee.is_active = department.is_active = shift.is_active = False
    db.session.commit()
    assert Employee.query.filter_by(is_active=True).count() == 0
    assert Department.query.filter_by(is_active=True).count() == 0
    assert Shift.query.filter_by(is_active=True).count() == 0
    assert DailyRecord.query.one().employee.id == identifiers[0]
    assert DailyRecord.query.one().shift.id == identifiers[2]
    assert employee.resigned_at is None and department.is_locked is False
    ensure_month_reference('2026-06')
    assert get_month_reference('2026-06', 'employee', 'E1')['is_active'] is False
    Employee.query.filter_by(emp_no='E1').one().is_active = True
    db.session.commit()
    assert Employee.query.one().id == identifiers[0]


def test_snapshot_business_key_is_unique_per_month_and_kind(backup_app):
    from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
    from services.monthly_reference_service import ensure_month_reference

    ensure_month_reference('2026-06')
    db.session.commit()
    db.session.add(MonthlyReferenceSnapshot(month='2026-06', kind='employee', business_key='E1',
                                          payload={}, provenance={}, quality='baseline', schema_version=1))
    with pytest.raises(IntegrityError):
        db.session.flush()
    db.session.rollback()


@pytest.mark.parametrize('month', ['2026-00', '2026-13', '2026-6', '0000-06', None])
def test_invalid_month_cannot_write_snapshots(backup_app, month):
    from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
    from services.monthly_reference_service import ensure_month_reference

    with pytest.raises(ValueError):
        ensure_month_reference(month)
    assert MonthlyReferenceSnapshot.query.count() == 0


def test_legacy_scan_is_read_only_and_reports_evidence_conflicts(backup_app):
    from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
    from models.monthly_report import MonthlyReport
    from services.monthly_reference_service import scan_legacy_month_references

    daily = DailyRecord.query.one()
    daily.raw_data = {'姓名': '历史甲', '部门': '旧生产'}
    db.session.add(MonthlyReport(emp_id=daily.emp_id, report_month='2026-06',
                                raw_data={'姓名': '另一姓名', '部门': '旧生产'}))
    # A business month without an account-set row must still be reported.
    db.session.add(DailyRecord(emp_id=daily.emp_id, record_date=date(2026, 7, 1)))
    db.session.commit()
    statements = []
    def record_sql(_connection, _cursor, statement, _params, _context, _many):
        statements.append(statement.lstrip().split()[0].upper())
    event.listen(db.engine, 'before_cursor_execute', record_sql)
    try:
        report = scan_legacy_month_references()
    finally:
        event.remove(db.engine, 'before_cursor_execute', record_sql)
    assert not {'INSERT', 'UPDATE', 'DELETE'} & set(statements)
    assert MonthlyReferenceSnapshot.query.count() == 0
    months = {row['month']: row for row in report['months']}
    assert set(months) == {'2026-06', '2026-07'}
    assert months['2026-06']['missing']['employee'] == ['E1']
    name = next(row for row in months['2026-06']['evidence'] if row['field'] == 'name')
    assert name['conflict'] is True
    assert {candidate['value'] for candidate in name['candidates']} == {'历史甲', '另一姓名'}
    assert all(candidate['sources'] for candidate in name['candidates'])
    department = next(row for row in months['2026-06']['evidence'] if row['field'] == 'dept_name')
    assert department['conflict'] is False
    assert department['candidates'][0]['value'] == '旧生产'
    # Current values must not be presented as verified historical candidates.
    assert all(candidate['value'] != '甲' for candidate in name['candidates'])
    assert months['2026-07']['evidence'] == []


@pytest.mark.parametrize('legacy_first', [False, True])
def test_snapshot_upgrade_preserves_rows_and_is_compatible_with_create_all(tmp_path, legacy_first):
    from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
    from services.bootstrap_service import ensure_schema_compatibility

    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI=f'sqlite:///{tmp_path / "snapshot.db"}',
                      SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    Migrate(app, db, directory=str(Path(__file__).resolve().parents[1] / 'migrations'))
    with app.app_context():
        db.create_all()
        department = Department(dept_no='D1', dept_name='原部门')
        employee = Employee(emp_no='E1', name='原员工')
        shift = Shift(shift_no='S1', shift_name='原班次', time_slots=[])
        db.session.add_all([department, employee, shift])
        db.session.commit()
        db.session.expunge_all()
        MonthlyReferenceSnapshot.__table__.drop(db.engine)
        for table in ('employees', 'departments', 'shifts'):
            db.session.execute(text(f'ALTER TABLE {table} DROP COLUMN is_active'))
        db.session.commit()
        stamp(revision='20261009_meal_rules')
        if legacy_first:
            ensure_schema_compatibility()
            ensure_schema_compatibility()
            assert Employee.query.one().is_active is True
            assert MonthlyReferenceSnapshot.query.count() == 0
        upgrade()
        upgrade()
        assert Employee.query.one().is_active is True
        assert Employee.query.one().name == '原员工'
        assert Department.query.one().is_active is True
        assert Shift.query.one().is_active is True
        assert MonthlyReferenceSnapshot.query.count() == 0
        db.session.remove()
        downgrade(revision='20261009_meal_rules')
        assert db.session.execute(text('SELECT emp_no, name FROM employees')).one() == ('E1', '原员工')
        db.session.remove()
        # Bootstrap/create_all may already have introduced the new schema.
        db.drop_all()
        db.create_all()
        stamp(revision='20261009_meal_rules')
        upgrade()
        assert MonthlyReferenceSnapshot.query.count() == 0
        db.session.remove()


def test_explicit_scan_and_capture_commands_are_separate_and_atomic(backup_app):
    import json
    from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
    from services.monthly_reference_service import register_monthly_reference_commands

    register_monthly_reference_commands(backup_app)
    runner = backup_app.test_cli_runner()
    result = runner.invoke(args=['scan-month-references'])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)['months'][0]['month'] == '2026-06'
    assert MonthlyReferenceSnapshot.query.count() == 0
    result = runner.invoke(args=['capture-month-references', '--month', '2026-06', '--month', '2026-13'])
    assert result.exit_code != 0
    assert MonthlyReferenceSnapshot.query.count() == 0
    for _ in range(2):
        result = runner.invoke(args=['capture-month-references', '--month', '2026-06'])
        assert result.exit_code == 0, result.output
    assert MonthlyReferenceSnapshot.query.count() == 2
    assert {row.quality for row in MonthlyReferenceSnapshot.query.all()} == {'baseline'}


def test_legacy_scan_does_not_flush_pending_current_changes(backup_app):
    from services.monthly_reference_service import scan_legacy_month_references

    Employee.query.one().name = 'uncommitted'
    statements = []
    def record_sql(_connection, _cursor, statement, _params, _context, _many):
        statements.append(statement.lstrip().split()[0].upper())
    event.listen(db.engine, 'before_cursor_execute', record_sql)
    try:
        scan_legacy_month_references()
    finally:
        event.remove(db.engine, 'before_cursor_execute', record_sql)
    assert 'UPDATE' not in statements
    db.session.rollback()
    assert Employee.query.one().name == '甲'


def test_capture_preserves_verified_and_partial_legacy_snapshots(backup_app):
    from models.monthly_reference_snapshot import MonthlyReferenceSnapshot
    from services.monthly_reference_service import ensure_month_reference, get_month_reference

    for month, quality in [('2026-05', 'verified'), ('2026-06', 'partial')]:
        db.session.add(MonthlyReferenceSnapshot(month=month, kind='employee', business_key='E1',
            payload={'name': '档案姓名'}, quality=quality, schema_version=1,
            provenance={'source': 'archive', 'fields': {'name': 'verified'}}))
    db.session.commit()
    ensure_month_reference('2026-05')
    ensure_month_reference('2026-06')
    db.session.commit()
    assert get_month_reference('2026-05', 'employee', 'E1')['name'] == '档案姓名'
    assert get_month_reference('2026-06', 'employee', 'E1')['name'] == '档案姓名'
    assert MonthlyReferenceSnapshot.query.filter_by(month='2026-05', kind='employee').one().quality == 'verified'
    assert MonthlyReferenceSnapshot.query.filter_by(month='2026-06', kind='employee').one().quality == 'partial'


def test_mysql_snapshot_upgrade_ddl_uses_true_default_and_portable_json(tmp_path):
    import importlib
    from io import StringIO
    from unittest.mock import patch
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect

    migration = importlib.import_module('migrations.versions.20261009_monthly_references')
    engine = create_engine(f'sqlite:///{tmp_path / "ddl.db"}')
    with engine.begin() as connection:
        for table in ('employees', 'departments', 'shifts'):
            connection.execute(text(f'CREATE TABLE {table} (id INTEGER PRIMARY KEY)'))
        inspector = inspect(connection)
        output = StringIO()
        context = MigrationContext.configure(dialect_name='mysql',
            opts={'as_sql': True, 'output_buffer': output})
        with patch.object(migration.sa, 'inspect', return_value=inspector):
            with Operations.context(context):
                migration.upgrade()
    ddl = output.getvalue()
    assert ddl.count('ADD COLUMN is_active BOOL NOT NULL DEFAULT true') == 3
    assert 'CREATE TABLE monthly_reference_snapshots' in ddl
    assert 'payload JSON NOT NULL' in ddl
    assert 'provenance JSON NOT NULL' in ddl
    assert 'UNIQUE (month, kind, business_key)' in ddl
    engine.dispose()
