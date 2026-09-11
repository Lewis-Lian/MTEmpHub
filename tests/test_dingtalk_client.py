import os
import unittest
from unittest.mock import patch

from services.dingtalk_client import DingTalkClient, DingTalkClientError


class Transport:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return response


class DingTalkClientTests(unittest.TestCase):
    def setUp(self):
        DingTalkClient.clear_token_cache()

    def env(self):
        return patch.dict(os.environ, {"DINGTALK_CLIENT_ID": "app", "DINGTALK_CLIENT_SECRET": "secret", "DINGTALK_CORP_ID": "corp"})

    def test_token_contract_and_cache(self):
        transport = Transport([{"accessToken": "access", "expireIn": 3600}])
        with self.env():
            client = DingTalkClient(transport=transport)
            self.assertEqual(client.access_token(), "access")
            self.assertEqual(DingTalkClient(transport=transport).access_token(), "access")
        self.assertEqual(len(transport.calls), 1)
        _, url, kwargs = transport.calls[0]
        self.assertEqual(url, DingTalkClient.TOKEN_URL)
        self.assertEqual(kwargs["json"], {"appKey": "app", "appSecret": "secret"})
        self.assertEqual(kwargs["headers"]["Content-Type"], "application/json")

    def test_documented_attendance_contract_paginates_and_normalizes(self):
        transport = Transport([
            {"accessToken": "access", "expireIn": 3600},
            {"errcode": 0, "recordresult": [{"userId": "u1", "workDate": 1599321600000, "checkType": "OnDuty", "userCheckTime": 1599352200000, "timeResult": "Normal", "locationResult": "Normal"}], "hasMore": True},
            {"errcode": 0, "recordresult": [{"userId": "u1", "workDate": 1599321600000, "checkType": "OffDuty", "userCheckTime": 1599384600000, "timeResult": "Late", "locationResult": "Outside"}], "hasMore": False},
        ])
        with self.env():
            records = DingTalkClient(transport=transport).attendance_records(["u1"], "2020-09-06", "2020-09-06")
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["date"], "2020-09-06")
        self.assertEqual(records[0]["punch_in"], 1599352200000)
        self.assertEqual(records[1]["punch_out"], 1599384600000)
        self.assertEqual(records[1]["time_result"], "Late")
        self.assertEqual(records[1]["location_result"], "Outside")
        self.assertEqual(transport.calls[1][1], "https://oapi.dingtalk.com/attendance/list?access_token=access")
        self.assertEqual(transport.calls[1][2]["json"]["offset"], 0)
        self.assertEqual(transport.calls[2][2]["json"]["offset"], 50)

    def test_connection_probes_token_and_attendance_permission_with_a_sample_user(self):
        transport = Transport([
            {"accessToken": "access", "expireIn": 3600},
            {"errcode": 0, "result": {"list": [{"userid": "u1", "name": "经理甲", "job_number": "M001"}], "has_more": False}},
            {"errcode": 0, "recordresult": [], "hasMore": False},
        ])
        with self.env():
            self.assertTrue(DingTalkClient(transport=transport).test_connection())
        self.assertEqual(len(transport.calls), 3)
        self.assertEqual(transport.calls[1][1], DingTalkClient.USER_LIST_URL + "?access_token=access")
        self.assertEqual(transport.calls[1][2]["json"]["dept_id"], 1)
        self.assertEqual(transport.calls[1][2]["json"]["size"], 1)
        self.assertEqual(transport.calls[2][2]["json"]["userIdList"], ["u1"])

    def test_connection_samples_a_sub_department_when_root_has_no_users(self):
        transport = Transport([
            {"accessToken": "access", "expireIn": 3600},
            {"errcode": 0, "result": {"list": [], "has_more": False}},
            {"errcode": 0, "result": [{"dept_id": 2, "name": "制造部"}]},
            {"errcode": 0, "result": {"list": [{"userid": "u2", "name": "经理乙", "job_number": "M002"}], "has_more": False}},
            {"errcode": 0, "recordresult": [], "hasMore": False},
        ])
        with self.env():
            self.assertTrue(DingTalkClient(transport=transport).test_connection())
        self.assertEqual(transport.calls[2][2]["json"], {"dept_id": 1})
        self.assertEqual(transport.calls[3][2]["json"]["dept_id"], 2)
        self.assertEqual(transport.calls[4][2]["json"]["userIdList"], ["u2"])

    def test_connection_reports_attendance_permission_failure(self):
        transport = Transport([
            {"accessToken": "access", "expireIn": 3600},
            {"errcode": 0, "result": {"list": [{"userid": "u1"}], "has_more": False}},
            {"errcode": 60011, "errmsg": "no permission"},
        ])
        with self.env():
            with self.assertRaises(DingTalkClientError) as ctx:
                DingTalkClient(transport=transport).test_connection()
        self.assertIn("访问权限", str(ctx.exception))

    def test_attendance_batches_at_fifty_users_and_seven_days(self):
        users = [f"u{i}" for i in range(51)]
        transport = Transport([{"accessToken": "access", "expireIn": 3600}] + [{"recordresult": [], "hasMore": False}] * 4)
        with self.env():
            DingTalkClient(transport=transport).attendance_records(users, "2024-01-01", "2024-01-09")
        calls = transport.calls[1:]
        self.assertEqual(len(calls), 4)
        self.assertEqual(len(calls[0][2]["json"]["userIdList"]), 50)
        self.assertEqual(calls[0][2]["json"]["workDateFrom"], "2024-01-01 00:00:00")
        self.assertEqual(calls[0][2]["json"]["workDateTo"], "2024-01-07 23:59:59")
        self.assertEqual(calls[2][2]["json"]["workDateFrom"], "2024-01-08 00:00:00")

    def test_directory_users_traverses_departments_paginates_and_normalizes_job_numbers(self):
        transport = Transport([
            {"accessToken": "access", "expireIn": 3600},
            {"errcode": 0, "result": [{"dept_id": 2, "name": "制造部"}]},
            {"errcode": 0, "result": []},
            {
                "errcode": 0,
                "result": {
                    "list": [{"userid": "u1", "name": "经理甲", "job_number": "M001"}],
                    "has_more": True,
                    "next_cursor": 10,
                },
            },
            {
                "errcode": 0,
                "result": {
                    "list": [{"userid": "u2", "name": "经理乙", "job_number": "M002"}],
                    "has_more": False,
                },
            },
            {
                "errcode": 0,
                "result": {
                    "list": [
                        {"userid": "u2", "name": "经理乙", "job_number": "M002"},
                        {"userid": "u3", "name": "经理丙", "job_number": "M003"},
                    ],
                    "has_more": False,
                },
            },
        ])

        with self.env():
            users = DingTalkClient(transport=transport).directory_users()

        self.assertEqual(
            users,
            [
                {"employee_no": "M001", "employee_user_id": "u1", "employee_name": "经理甲"},
                {"employee_no": "M002", "employee_user_id": "u2", "employee_name": "经理乙"},
                {"employee_no": "M003", "employee_user_id": "u3", "employee_name": "经理丙"},
            ],
        )
        self.assertEqual(transport.calls[1][2]["json"], {"dept_id": 1})
        self.assertEqual(transport.calls[2][2]["json"], {"dept_id": 2})
        self.assertEqual(transport.calls[3][2]["json"]["cursor"], 0)
        self.assertEqual(transport.calls[4][2]["json"]["cursor"], 10)
        self.assertEqual(transport.calls[5][2]["json"]["dept_id"], 2)

    def test_not_signed_empty_and_zero_check_times_are_normalized_as_missing_punches(self):
        cases = [
            {"timeResult": "NotSigned", "userCheckTime": 1599352200000},
            {"timeResult": "Normal", "userCheckTime": ""},
            {"timeResult": "Normal", "userCheckTime": 0},
            {"timeResult": "Normal", "userCheckTime": "0"},
        ]

        for values in cases:
            with self.subTest(values=values):
                record = DingTalkClient._normalize({"checkType": "OnDuty", **values})
                self.assertIsNone(record["punch_in"])

    def test_directory_pagination_advances_when_next_cursor_is_omitted(self):
        transport = Transport([
            {"accessToken": "access", "expireIn": 3600},
            {"errcode": 0, "result": []},
            {
                "errcode": 0,
                "result": {
                    "list": [{"userid": "u1", "name": "经理甲", "job_number": "M001"}],
                    "has_more": True,
                },
            },
            {"errcode": 0, "result": {"list": [], "has_more": False}},
        ])

        with self.env():
            DingTalkClient(transport=transport).directory_users()

        self.assertEqual(transport.calls[3][2]["json"]["cursor"], 1)

    def test_missing_configuration_is_rejected(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(DingTalkClientError, "configuration"):
                DingTalkClient(transport=Transport([])).access_token()

    def test_absenteeism_is_late_and_nested_secrets_are_redacted(self):
        record = DingTalkClient._normalize({"userId": "u", "checkType": "OnDuty", "timeResult": "Absenteeism", "nested": {"accessToken": "secret"}})
        self.assertTrue(record["is_late"])
        self.assertEqual(record["raw_payload"]["nested"]["accessToken"], "[REDACTED]")

    def test_api_error_is_domain_error_without_sensitive_cause(self):
        transport = Transport([{"accessToken": "access", "expireIn": 3600}, {"errcode": 40014, "errmsg": "bad"}])
        with self.env():
            with self.assertRaises(DingTalkClientError) as ctx:
                DingTalkClient(transport=transport).attendance_records(["u1"], "2024-01-01", "2024-01-02")
        self.assertIsNone(ctx.exception.__cause__)
        self.assertIsNone(ctx.exception.__context__)

    def test_timeout_is_domain_error_without_sensitive_cause(self):
        DingTalkClient.clear_token_cache()
        with self.env():
            with self.assertRaises(DingTalkClientError) as timeout:
                DingTalkClient(transport=Transport([TimeoutError("client secret access token")])).access_token()
        self.assertIsNone(timeout.exception.__cause__)
        self.assertIsNone(timeout.exception.__context__)


if __name__ == "__main__":
    unittest.main()
