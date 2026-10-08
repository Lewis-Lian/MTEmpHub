from pathlib import Path

import pytest
from flask import Flask
from flask_migrate import Migrate, stamp, upgrade
from sqlalchemy import inspect, text

from app import create_app  # Registers the application's model metadata.
from models import db
from services.bootstrap_service import ensure_schema_compatibility


@pytest.mark.parametrize('existing_flags', [(), ('is_revoked',), ('is_revoked', 'is_manual_edited')])
@pytest.mark.parametrize('legacy_upgrade_first', [False, True])
def test_overtime_upgrade_after_legacy_schema_patch(tmp_path, existing_flags, legacy_upgrade_first):
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI=f'sqlite:///{tmp_path / "migration.db"}',
                      SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    directory = str(Path(__file__).resolve().parents[1] / 'migrations')
    Migrate(app, db, directory=directory)
    with app.app_context():
        db.create_all()
        for flag in ('is_revoked', 'is_manual_edited'):
            if flag not in existing_flags:
                db.session.execute(text(f'ALTER TABLE overtime_records DROP COLUMN {flag}'))
        db.session.commit()
        stamp(revision='20261007_stat_cutoff')
        if legacy_upgrade_first:
            ensure_schema_compatibility()
        upgrade()
        upgrade()
        columns = {column['name'] for column in inspect(db.engine).get_columns('overtime_records')}
        assert {'is_revoked', 'is_manual_edited'} <= columns
        version = db.session.execute(text('SELECT version_num FROM alembic_version')).scalar()
        assert version == '20261008_meals'
        db.session.remove()
        db.drop_all()
