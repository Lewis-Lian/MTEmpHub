import io
import json
import zipfile
from datetime import date, datetime

import pytest
from flask import Flask
from models import db
from models.account_set import AccountSet, AccountSetImport
from models.employee import Employee
from models.department import Department
from models.daily_record import DailyRecord
from models.leave import LeaveRecord
from models.user import User
from services.account_set_backup_service import collect_backup, export_backup, read_backup, BackupError


@pytest.fixture
def backup_app(tmp_path):
    app = Flask(__name__)
    app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite://',
                      SQLALCHEMY_TRACK_MODIFICATIONS=False, UPLOAD_FOLDER=str(tmp_path), BACKUP_PRIVATE_DIR=str(tmp_path / 'private'))
    db.init_app(app)
    with app.app_context():
        db.create_all()
        db.session.add(User(username='admin', role='admin', password_hash='unused'))
        department = Department(dept_no='D1', dept_name='生产')
        db.session.add(department)
        db.session.flush()
        employee = Employee(emp_no='E1', name='甲', dept_id=department.id)
        account = AccountSet(month='2026-06', name='六月', is_active=True)
        db.session.add_all([employee, account])
        db.session.flush()
        db.session.add(DailyRecord(emp_id=employee.id, record_date=date(2026, 6, 3), actual_hours=8))
        db.session.add(LeaveRecord(emp_id=employee.id, leave_no='L1', leave_type='事假',
                                  start_time=datetime(2026, 5, 31), end_time=datetime(2026, 6, 2)))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def test_collect_business_keys_and_cross_month(backup_app):
    document = collect_backup(1)
    assert document['datasets']['daily_records'][0]['emp_no'] == 'E1'
    assert 'emp_id' not in document['datasets']['daily_records'][0]
    assert len(document['datasets']['leave_records']) == 1
    assert document['datasets']['departments'][0]['dept_no'] == 'D1'
    assert 'users' not in document['datasets']


def test_zip_round_trip_and_missing_file(backup_app, tmp_path):
    path = tmp_path / '员工日报.xlsx'
    path.write_bytes(b'workbook')
    db.session.add(AccountSetImport(account_set_id=1, source_filename=path.name,
                                   stored_path=str(path), status='ok'))
    db.session.commit()
    document = read_backup(export_backup(1))
    assert document['month'] == '2026-06'
    assert list(document['_files'].values()) == [b'workbook']
    path.unlink()
    with pytest.raises(BackupError, match='缺失'):
        export_backup(1)


@pytest.mark.parametrize('name', ['../evil', '/evil', 'files\\evil'])
def test_reject_unsafe_members(name):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as archive:
        archive.writestr(name, b'x')
    with pytest.raises(BackupError):
        read_backup(stream.getvalue())


def test_reject_bad_version_and_checksum(backup_app):
    payload = export_backup(1)
    original = zipfile.ZipFile(io.BytesIO(payload))
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for name in original.namelist():
            data = original.read(name)
            if name == 'manifest.json':
                value = json.loads(data)
                value['format_version'] = 999
                data = json.dumps(value)
            archive.writestr(name, data)
    with pytest.raises(BackupError, match='版本'):
        read_backup(output.getvalue())


def test_factory_rest_date_must_belong_to_month(backup_app):
    from services.account_set_backup_service import validate_document
    document = collect_backup(1)
    document['datasets']['factory_rest'] = [{'rest_date': '2026-07-01', 'rest_period': 'full'}]
    with pytest.raises(BackupError, match='日期'):
        validate_document(document)


def test_reject_non_finite_numeric_data(backup_app):
    from services.account_set_backup_service import validate_document
    document = collect_backup(1)
    document['datasets']['daily_records'][0]['actual_hours'] = float('inf')
    with pytest.raises(BackupError):
        validate_document(document)


def test_export_contains_only_selected_month(backup_app):
    from models.monthly_report import MonthlyReport
    other = AccountSet(month='2026-07', name='七月')
    db.session.add(other)
    db.session.add(DailyRecord(emp_id=1, record_date=date(2026, 7, 3), actual_hours=5))
    db.session.add(MonthlyReport(emp_id=1, report_month='2026-07', agg_01=123))
    db.session.commit()
    june = read_backup(export_backup(1))
    july = read_backup(export_backup(other.id))
    assert june['month'] == '2026-06'
    assert [row['record_date'] for row in june['datasets']['daily_records']] == ['2026-06-03']
    assert not june['datasets']['monthly_reports']
    assert july['month'] == '2026-07'
    assert [row['record_date'] for row in july['datasets']['daily_records']] == ['2026-07-03']
    assert july['datasets']['monthly_reports'][0]['agg_01'] == 123


def test_collect_batches_related_employee_and_shift_queries(backup_app):
    from sqlalchemy import event
    from models.shift import Shift

    shift = Shift(shift_no='S1', shift_name='白班', time_slots=[])
    db.session.add(shift)
    db.session.flush()
    for day in range(4, 24):
        db.session.add(DailyRecord(emp_id=1, shift_id=shift.id, record_date=date(2026, 6, day)))
    db.session.commit()
    db.session.expunge_all()
    queries = []
    def record_query(_conn, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith('SELECT') and ('FROM employees' in statement or 'FROM shifts' in statement):
            queries.append(statement)
    event.listen(db.engine, 'before_cursor_execute', record_query)
    try:
        document = collect_backup(1)
    finally:
        event.remove(db.engine, 'before_cursor_execute', record_query)
    assert len(document['datasets']['daily_records']) == 21
    assert len(queries) < 10


def test_manager_stat_sources_survive_backup_and_restore(backup_app):
    from models.manager_month_stat import ManagerMonthStat
    from services.account_set_restore_service import convert_fields

    db.session.add(ManagerMonthStat(emp_id=1, year=2026, stat_type='annual_leave', m6=0,
                                   automatic_values={'m6': 2}, manual_values={'m6': 0}))
    db.session.commit()
    document = read_backup(export_backup(1))
    row = document['datasets']['manager_stats'][0]
    assert row['automatic_values'] == {'m6': 2}
    assert row['manual_values'] == {'m6': 0}
    restored = ManagerMonthStat(**convert_fields('manager_stats', row))
    assert restored.automatic_values == {'m6': 2}
    assert restored.corrections() == {'m6': 0}


def test_legacy_manager_stat_backup_without_source_metadata_is_supported(backup_app):
    from models.manager_month_stat import ManagerMonthStat
    from services.account_set_backup_service import validate_document

    db.session.add(ManagerMonthStat(emp_id=1, year=2026, stat_type='annual_leave', m6=1))
    db.session.commit()
    document = collect_backup(1)
    row = document['datasets']['manager_stats'][0]
    row.pop('automatic_values', None)
    row.pop('manual_values', None)
    validated = validate_document(document)['datasets']['manager_stats'][0]
    assert validated['manual_values'] is None
    assert validated['automatic_values'] is None
    assert validated['m6'] == 1


def test_legacy_overtime_backup_defaults_manual_flags(backup_app):
    from models.overtime import OvertimeRecord
    from services.account_set_backup_service import validate_document
    db.session.add(OvertimeRecord(emp_id=1, overtime_no='OT1',
        start_time=datetime(2026, 6, 3, 8), end_time=datetime(2026, 6, 3, 17)))
    db.session.commit()
    document = collect_backup(1)
    row = document['datasets']['overtime_records'][0]
    del row['is_revoked']
    del row['is_manual_edited']
    validate_document(document)
    assert row['is_revoked'] is False
    assert row['is_manual_edited'] is False
