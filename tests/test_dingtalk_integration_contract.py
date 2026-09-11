import tempfile
import unittest
from pathlib import Path

from sqlalchemy import inspect, text
from flask import Flask
from flask_migrate import Migrate

# Import the application module so every model is registered on the shared
# metadata before create_all (the production app does this during startup).
import app as _app_module  # noqa: F401
from models import db
from services.bootstrap_service import ensure_schema_compatibility, initialize_database


class DingTalkIntegrationContractTests(unittest.TestCase):
    def _app(self, database_path: str) -> Flask:
        app = Flask(__name__)
        app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            SQLALCHEMY_DATABASE_URI=f"sqlite:///{database_path}",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
        )
        db.init_app(app)
        Migrate(app, db)
        return app

    def test_clean_init_creates_dingtalk_schema_and_upgrade_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            app = self._app(str(Path(tmpdir) / "clean.db"))
            with app.app_context():
                initialize_database()
                ensure_schema_compatibility()
                inspector = inspect(db.engine)
                self.assertIn("system_settings", inspector.get_table_names())
                self.assertIn("dingtalk_sync_runs", inspector.get_table_names())
                self.assertIn("dingtalk_user_id", {column["name"] for column in inspector.get_columns("employees")})

    def test_legacy_sqlite_upgrade_adds_dingtalk_schema_without_manual_sql_in_deployment(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            app = self._app(str(Path(tmpdir) / "legacy.db"))
            with app.app_context():
                db.create_all()
                db.session.execute(text("DROP TABLE dingtalk_sync_runs"))
                db.session.execute(text("DROP TABLE system_settings"))
                db.session.execute(text("DROP INDEX ix_employees_dingtalk_user_id"))
                db.session.execute(text("ALTER TABLE employees DROP COLUMN dingtalk_user_id"))
                db.session.commit()

                ensure_schema_compatibility()
                ensure_schema_compatibility()
                inspector = inspect(db.engine)
                self.assertIn("system_settings", inspector.get_table_names())
                self.assertIn("dingtalk_sync_runs", inspector.get_table_names())
                self.assertIn("dingtalk_user_id", {column["name"] for column in inspector.get_columns("employees")})


if __name__ == "__main__":
    unittest.main()
