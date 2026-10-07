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
        values = db.session.execute(text('SELECT m5, remaining, automatic_values, manual_values FROM manager_month_stats')).one()
        assert tuple(values) == (1.5, 10.5, None, None)
        cutoff_path = migration_path.with_name('20261007_legacy_stat_cutoff.py')
        cutoff_spec = importlib.util.spec_from_file_location('manager_stat_cutoff', cutoff_path)
        cutoff = importlib.util.module_from_spec(cutoff_spec)
        cutoff_spec.loader.exec_module(cutoff)
        with db.engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                cutoff.upgrade()
                cutoff.upgrade()
        ensure_schema_compatibility()
        from models.manager_month_stat import ManagerMonthStat
        legacy = db.session.get(ManagerMonthStat, 1)
        assert legacy.m5 == 1.5
        assert legacy.remaining == 10.5
        assert legacy.manual_values['m5'] == 1.5
        assert 'm9' not in legacy.manual_values
        assert legacy.automatic_values == {'m9': 0, 'm10': 0, 'm11': 0, 'm12': 0}
        db.session.expunge_all()

        db.session.execute(text('ALTER TABLE manager_month_stats DROP COLUMN automatic_values'))
        db.session.execute(text('ALTER TABLE manager_month_stats DROP COLUMN manual_values'))
        db.session.commit()
        ensure_schema_compatibility()
        ensure_schema_compatibility()
        assert {'automatic_values', 'manual_values'} <= {column['name'] for column in inspect(db.engine).get_columns('manager_month_stats')}
        values = db.session.execute(text('SELECT m5, remaining FROM manager_month_stats')).one()
        assert tuple(values) == (1.5, 10.5)
        db.session.remove()
