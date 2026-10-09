from sqlalchemy import Column, Integer, Table
from models import db


def test_every_model_and_field_has_a_backup_decision():
    from services.backup_document import missing_backup_coverage
    assert missing_backup_coverage() == []


def test_new_field_is_reported_even_on_excluded_table():
    from services.backup_document import missing_backup_coverage
    from models.message import Message
    column = Column('future_business_field', Integer)
    table = Message.__table__
    table.append_column(column)
    try:
        assert 'messages.future_business_field' in missing_backup_coverage()
    finally:
        table._columns.remove(column)


def test_new_orm_table_is_reported():
    from services.backup_document import missing_backup_coverage
    table = Table('future_business_table', db.metadata, Column('id', Integer, primary_key=True), Column('amount', Integer))
    try:
        assert 'future_business_table' in missing_backup_coverage()
        assert 'future_business_table.amount' in missing_backup_coverage()
    finally:
        db.metadata.remove(table)


def test_accounts_use_business_references_and_never_import_auth_version():
    from services.account_set_backup_schema import V2_DATASETS, V2_REFS
    assert 'password_hash' in V2_DATASETS['users'].fields
    assert 'is_active' in V2_DATASETS['users'].fields
    assert 'auth_version' not in V2_DATASETS['users'].fields
    assert V2_REFS['users']['profile_dept_id'][0] == 'profile_dept_no'
    assert V2_REFS['user_employee_assignments']['user_id'][0] == 'username'
    assert V2_REFS['user_employee_assignments']['emp_id'][0] == 'emp_no'


def test_new_business_field_on_mapped_model_is_reported():
    from services.backup_document import missing_backup_coverage
    from models.employee import Employee
    column = Column('future_business_field', Integer)
    Employee.__table__.append_column(column)
    try:
        assert 'employees.future_business_field' in missing_backup_coverage()
    finally:
        Employee.__table__._columns.remove(column)
