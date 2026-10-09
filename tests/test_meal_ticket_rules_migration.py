from pathlib import Path

import pytest
from flask import Flask
from flask_migrate import Migrate, stamp, upgrade
from sqlalchemy import text

from app import create_app  # Registers model metadata.
from models import db
from models.employee import Employee
from services.bootstrap_service import ensure_schema_compatibility


@pytest.mark.parametrize('legacy_first', [False, True])
def test_meal_rule_upgrade_preserves_employees_and_defaults_to_ordinary(tmp_path, legacy_first):
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI=f'sqlite:///{tmp_path / "rules.db"}',
                      SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    Migrate(app, db, directory=str(Path(__file__).resolve().parents[1] / 'migrations'))
    with app.app_context():
        db.create_all()
        db.session.add(Employee(emp_no='001', name='原员工'))
        db.session.commit()
        db.session.expunge_all()
        db.session.execute(text('ALTER TABLE employees DROP COLUMN meal_ticket_as_manager'))
        db.session.commit()
        stamp(revision='20261008_ledgers')
        if legacy_first:
            ensure_schema_compatibility()
            ensure_schema_compatibility()
        upgrade()
        upgrade()
        employee = Employee.query.one()
        assert (employee.emp_no, employee.name, employee.meal_ticket_as_manager) == ('001', '原员工', False)
        employee.meal_ticket_as_manager = True
        db.session.commit()
        ensure_schema_compatibility()
        db.session.expire_all()
        assert Employee.query.one().meal_ticket_as_manager is True
        db.session.remove()
