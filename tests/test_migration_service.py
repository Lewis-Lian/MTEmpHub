import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import create_engine, event, text
from sqlalchemy.dialects import mysql

import app as _app_module  # noqa: F401
from services.migration_service import migrate_sqlite_to_mysql


class MigrationServiceTests(unittest.TestCase):
    def test_sqlite_to_mysql_migrates_setting_with_reserved_key_column(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source_url = f"sqlite:///{Path(tmpdir) / 'source.db'}"
            target_url = f"sqlite:///{Path(tmpdir) / 'target.db'}"
            source = create_engine(source_url)
            with source.begin() as connection:
                connection.execute(text('CREATE TABLE system_settings (id INTEGER PRIMARY KEY, "key" TEXT, value TEXT)'))
                connection.execute(text("INSERT INTO system_settings VALUES (1, 'manager_attendance_source', 'dingtalk')"))
            source.dispose()

            read_db, write_db = SQLAlchemy(), SQLAlchemy()
            init_target = write_db.init_app

            def init_mysql_target(app):
                init_target(app)
                with app.app_context():
                    # Execute the transfer locally, using MySQL identifier rules
                    # and rejecting the unquoted reserved word as MySQL does.
                    write_db.engine.dialect.identifier_preparer = mysql.dialect().identifier_preparer

                    @event.listens_for(write_db.engine, "before_cursor_execute", retval=True)
                    def mysql_sql_boundary(connection, cursor, statement, parameters, context, executemany):
                        if statement.startswith("INSERT INTO") and "system_settings" in statement:
                            if "`key`" not in statement:
                                raise RuntimeError("MySQL rejects the unquoted reserved column key")
                        if statement.startswith("ALTER TABLE") and "AUTO_INCREMENT" in statement:
                            return "SELECT 1", ()
                        return statement, parameters

            with patch("flask_sqlalchemy.SQLAlchemy", side_effect=[read_db, write_db]), patch.object(
                write_db, "init_app", side_effect=init_mysql_target
            ), patch("flask_migrate.stamp"):
                results = migrate_sqlite_to_mysql(source_url, target_url)

            self.assertIn({"table": "system_settings", "rows": 1, "status": "ok"}, results)
            target = create_engine(target_url)
            with target.connect() as connection:
                self.assertEqual(
                    connection.execute(text('SELECT "key", value FROM system_settings')).one(),
                    ("manager_attendance_source", "dingtalk"),
                )
            target.dispose()
