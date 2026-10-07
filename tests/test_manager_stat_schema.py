import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from flask import Flask
from sqlalchemy import inspect, text

from models import db
from services.bootstrap_service import ensure_schema_compatibility


def test_source_schema_upgrades_preserve_legacy_values(tmp_path):
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI=f'sqlite:///{tmp_path / "legacy.db"}',
                      SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    with app.app_context():
        # Model registration also establishes dependencies for the compatibility upgrade.
        from routes import register_routes
        register_routes(app)
        db.create_all()
        db.session.execute(text('ALTER TABLE manager_month_stats DROP COLUMN automatic_values'))
        db.session.execute(text('ALTER TABLE manager_month_stats DROP COLUMN manual_values'))
        db.session.execute(text("INSERT INTO manager_month_stats (emp_id, year, stat_type, m5, remaining) VALUES (1, 2026, 'annual_leave', 1.5, 10.5)"))
        db.session.commit()

        migration_path = Path(__file__).resolve().parents[1] / 'migrations/versions/20261007_manager_stat_sources.py'
        spec = importlib.util.spec_from_file_location('manager_stat_sources', migration_path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with db.engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
        ensure_schema_compatibility()
        values = db.session.execute(text('SELECT m5, remaining, automatic_values, manual_values FROM manager_month_stats')).one()
        assert tuple(values) == (1.5, 10.5, None, None)

        db.session.execute(text('ALTER TABLE manager_month_stats DROP COLUMN automatic_values'))
        db.session.execute(text('ALTER TABLE manager_month_stats DROP COLUMN manual_values'))
        db.session.commit()
        ensure_schema_compatibility()
        ensure_schema_compatibility()
        assert {'automatic_values', 'manual_values'} <= {column['name'] for column in inspect(db.engine).get_columns('manager_month_stats')}
        values = db.session.execute(text('SELECT m5, remaining FROM manager_month_stats')).one()
        assert tuple(values) == (1.5, 10.5)
        db.session.remove()
