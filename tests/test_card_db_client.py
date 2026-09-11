import unittest
from datetime import date
from unittest.mock import patch

from services.card_db_client import CardDBClient, CardDBClientError, sanitize_card_error


CONFIG = {
    "host": "192.0.2.10",
    "port": 1433,
    "database": "STCard_Test",
    "user": "card_user",
    "password": "card-pass-123",
}


class FakeCursor:
    def __init__(self, rows, recorder):
        self.rows = rows
        self.recorder = recorder

    def execute(self, sql, params=None):
        self.recorder.append(("execute", sql, params))

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class FakeConnection:
    def __init__(self, rows, recorder):
        self.rows = rows
        self.recorder = recorder

    def cursor(self):
        return FakeCursor(self.rows, self.recorder)

    def close(self):
        self.recorder.append(("close",))


def fake_connect_factory(rows, recorder):
    def connect(**kwargs):
        recorder.append(("connect", kwargs))
        return FakeConnection(rows, recorder)

    return connect


class CardDBClientTests(unittest.TestCase):
    def test_missing_configuration_is_rejected(self):
        for call in (
            lambda client: client.test_connection(),
            lambda client: client.attendance_records("2026-09-01", "2026-09-30"),
        ):
            with self.subTest(call=call):
                with self.assertRaisesRegex(CardDBClientError, "configuration"):
                    call(CardDBClient({}))

    def test_connection_returns_server_version_with_tds_7_contract(self):
        recorder = []
        client = CardDBClient(CONFIG, connect=fake_connect_factory(
            [("Microsoft SQL Server 2012 - 11.0.2100.60 (X64)",)], recorder))
        version = client.test_connection()
        self.assertIn("SQL Server", version)
        connect_kwargs = recorder[0][1]
        self.assertEqual(connect_kwargs["server"], "192.0.2.10")
        self.assertEqual(connect_kwargs["port"], 1433)
        self.assertEqual(connect_kwargs["database"], "STCard_Test")
        self.assertEqual(connect_kwargs["user"], "card_user")
        self.assertEqual(connect_kwargs["password"], "card-pass-123")
        self.assertEqual(connect_kwargs["tds_version"], "7.0")
        self.assertEqual(connect_kwargs["charset"], "utf8")
        self.assertIn("close", [event[0] for event in recorder])

    def test_attendance_records_joins_person_department_and_parses_times(self):
        rows = [
            ("100201045", "余应长", "安全管理部", "7133697", "2026-09-10", "07:25 17:09 "),
            ("10020406", "王金", "安全管理部", "", "2026-09-10", "07:02 "),
            ("999", "坏日期", "部门", "1", "garbage", "08:00 "),
        ]
        recorder = []
        client = CardDBClient(CONFIG, connect=fake_connect_factory(rows, recorder))
        records = client.attendance_records("2026-09-01", "2026-09-30")

        self.assertEqual(len(records), 2)
        self.assertEqual(records[0], {
            "person_no": "100201045",
            "person_name": "余应长",
            "dept_name": "安全管理部",
            "card_no": "7133697",
            "record_date": date(2026, 9, 10),
            "times": ["07:25", "17:09"],
        })
        self.assertEqual(records[1]["times"], ["07:02"])
        self.assertEqual(records[1]["card_no"], "")

        sql_events = [event for event in recorder if event[0] == "execute"]
        sql = sql_events[0][1]
        self.assertIn("KQ_BrushCard", sql)
        self.assertIn("ST_Person", sql)
        self.assertIn("ST_Department", sql)
        self.assertIn("CAST(p.Person_No AS VARCHAR", sql)
        self.assertEqual(sql_events[0][2], ("2026-09-01", "2026-09-30"))

    def test_transport_errors_are_domain_errors_without_sensitive_cause(self):
        def broken_connect(**kwargs):
            raise OSError("login failed for user 'card_user' password 'card-pass-123'")

        client = CardDBClient(CONFIG, connect=broken_connect)
        with self.assertRaises(CardDBClientError) as ctx:
            client.test_connection()
        self.assertIsNone(ctx.exception.__cause__)
        self.assertIsNone(ctx.exception.__context__)

    def test_sanitize_card_error_hides_password_and_maps_known_failures(self):
        self.assertIn("未配置", sanitize_card_error(CardDBClientError("card database configuration is missing")))
        sanitized = sanitize_card_error(CardDBClientError("connect failed with password='card-pass-123' at 192.0.2.10"))
        self.assertNotIn("card-pass-123", sanitized)
        self.assertTrue(sanitized)

    def test_missing_pymssql_driver_reports_actionable_error(self):
        import sys
        with patch.dict(sys.modules, {"pymssql": None}):
            client = CardDBClient(CONFIG)
            with self.assertRaises(CardDBClientError) as ctx:
                client.test_connection()
        self.assertIn("pymssql", str(ctx.exception))
        hint = sanitize_card_error(ctx.exception)
        self.assertIn("pymssql", hint)
        self.assertIn("pip install", hint)


if __name__ == "__main__":
    unittest.main()
