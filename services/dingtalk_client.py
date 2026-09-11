"""Small, transport-agnostic DingTalk attendance API client."""

from __future__ import annotations

import json
import os
import time
from datetime import date, datetime, timedelta, timezone
from urllib.request import Request, urlopen


class DingTalkClientError(RuntimeError):
    """An API, configuration, or transport failure without credential details."""


def _request_failed():
    raise DingTalkClientError("DingTalk request failed") from None


class _UrlTransport:
    def request(self, method, url, **kwargs):
        data = kwargs.get("json")
        body = json.dumps(data).encode() if data is not None else None
        request = Request(url, data=body, method=method, headers=kwargs.get("headers", {}))
        with urlopen(request, timeout=kwargs.get("timeout", 15)) as response:
            return json.loads(response.read().decode("utf-8"))


class DingTalkClient:
    TOKEN_URL = "https://api.dingtalk.com/v1.0/oauth2/accessToken"
    ATTENDANCE_URL = "https://oapi.dingtalk.com/attendance/list"
    DEPARTMENT_LIST_URL = "https://oapi.dingtalk.com/topapi/v2/department/listsub"
    USER_LIST_URL = "https://oapi.dingtalk.com/topapi/v2/user/list"
    _token_cache = {}

    def __init__(self, transport=None, *, client_id=None, client_secret=None, corp_id=None, timeout=15):
        self.transport = transport or _UrlTransport()
        self.client_id = client_id or os.getenv("DINGTALK_CLIENT_ID")
        self.client_secret = client_secret or os.getenv("DINGTALK_CLIENT_SECRET")
        self.corp_id = corp_id or os.getenv("DINGTALK_CORP_ID")
        self.timeout = timeout

    @classmethod
    def clear_token_cache(cls):
        cls._token_cache.clear()

    def _require_config(self):
        if not self.client_id or not self.client_secret or not self.corp_id:
            raise DingTalkClientError("DingTalk configuration is missing")

    def _request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", self.timeout)
        try:
            if callable(self.transport):
                response = self.transport(method, url, **kwargs)
            else:
                response = self.transport.request(method, url, **kwargs)
            if hasattr(response, "json"):
                response = response.json()
            if not isinstance(response, dict):
                raise ValueError("invalid response")
            return response
        except DingTalkClientError:
            raise
        except Exception:
            pass
        _request_failed()

    def access_token(self):
        self._require_config()
        key = (self.client_id, self.client_secret, self.corp_id)
        cached = self._token_cache.get(key)
        if cached and cached[1] > time.monotonic():
            return cached[0]
        payload = self._request("POST", self.TOKEN_URL, json={"appKey": self.client_id, "appSecret": self.client_secret}, headers={"Content-Type": "application/json"})
        if payload.get("errcode", 0) not in (0, None):
            raise DingTalkClientError("DingTalk token request returned an error")
        token = payload.get("accessToken") or payload.get("access_token")
        if not token:
            raise DingTalkClientError("DingTalk token response was invalid")
        expires = float(payload.get("expireIn") or payload.get("expires_in") or 7200)
        self._token_cache[key] = (token, time.monotonic() + max(1, expires - 60))
        return token

    def attendance_records(self, user_ids, start_date, end_date):
        """Fetch all records in the date range and return normalized dictionaries."""
        self._require_config()
        records = []
        first = _as_day(start_date)
        last = _as_day(end_date)
        for day_start in _date_ranges(first, last, 7):
            for user_batch in _chunks(list(user_ids), 50):
                offset = 0
                while True:
                    body = {"workDateFrom": f"{day_start[0]} 00:00:00", "workDateTo": f"{day_start[1]} 23:59:59", "userIdList": user_batch, "offset": offset, "limit": 50}
                    payload = self._request(
                        "POST", self.ATTENDANCE_URL + "?access_token=" + self.access_token(),
                        json=body,
                        headers={"Content-Type": "application/json"},
                    )
                    if payload.get("errcode", 0) not in (0, None):
                        raise DingTalkClientError("DingTalk attendance request returned an error")
                    items = payload.get("recordresult") or payload.get("records") or payload.get("data") or []
                    records.extend(self._normalize(item) for item in items if isinstance(item, dict))
                    if not payload.get("hasMore"):
                        break
                    offset += 50
        return records

    def directory_users(self):
        """Return a read-only, normalized snapshot of users in the organization."""
        self._require_config()
        token = self.access_token()
        department_ids = []
        pending_department_ids = [1]
        seen_department_ids = set()
        while pending_department_ids:
            department_id = pending_department_ids.pop(0)
            if department_id in seen_department_ids:
                continue
            seen_department_ids.add(department_id)
            department_ids.append(department_id)
            payload = self._request(
                "POST",
                self.DEPARTMENT_LIST_URL + "?access_token=" + token,
                json={"dept_id": department_id},
                headers={"Content-Type": "application/json"},
            )
            if payload.get("errcode", 0) not in (0, None):
                raise DingTalkClientError("DingTalk directory request returned an error")
            children = payload.get("result") or []
            if isinstance(children, dict):
                children = children.get("list") or []
            for child in children:
                if not isinstance(child, dict):
                    continue
                child_id = child.get("dept_id") or child.get("deptId")
                if child_id is not None and child_id not in seen_department_ids:
                    pending_department_ids.append(child_id)

        users = []
        seen_user_ids = set()
        for department_id in department_ids:
            cursor = 0
            while True:
                payload = self._request(
                    "POST",
                    self.USER_LIST_URL + "?access_token=" + token,
                    json={
                        "dept_id": department_id,
                        "cursor": cursor,
                        "size": 100,
                        "contain_access_limit": False,
                    },
                    headers={"Content-Type": "application/json"},
                )
                if payload.get("errcode", 0) not in (0, None):
                    raise DingTalkClientError("DingTalk directory request returned an error")
                result = payload.get("result") or {}
                items = result.get("list") or [] if isinstance(result, dict) else []
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    user_id = item.get("userid") or item.get("userId") or item.get("user_id")
                    if not user_id or user_id in seen_user_ids:
                        continue
                    seen_user_ids.add(user_id)
                    users.append(
                        {
                            "employee_no": item.get("job_number") or item.get("jobNumber") or item.get("job_no"),
                            "employee_user_id": user_id,
                            "employee_name": item.get("name") or item.get("userName") or "",
                        }
                    )
                if not isinstance(result, dict) or not result.get("has_more"):
                    break
                next_cursor = result.get("next_cursor")
                cursor = next_cursor if next_cursor is not None else cursor + (len(items) or 100)
        return users

    def _department_user(self, department_id, token):
        """Return the first user id of a department, or None when it has no users."""
        payload = self._request(
            "POST",
            self.USER_LIST_URL + "?access_token=" + token,
            json={"dept_id": department_id, "cursor": 0, "size": 1, "contain_access_limit": False},
            headers={"Content-Type": "application/json"},
        )
        if payload.get("errcode", 0) not in (0, None):
            raise DingTalkClientError("DingTalk directory request returned an error")
        result = payload.get("result") or {}
        items = result.get("list") or [] if isinstance(result, dict) else []
        for item in items:
            if isinstance(item, dict):
                user_id = item.get("userid") or item.get("userId") or item.get("user_id")
                if user_id:
                    return str(user_id)
        return None

    def _sample_user_id(self, token):
        """Resolve one real user id so the attendance probe can send a valid userIdList."""
        user_id = self._department_user(1, token)
        if user_id:
            return user_id
        payload = self._request(
            "POST",
            self.DEPARTMENT_LIST_URL + "?access_token=" + token,
            json={"dept_id": 1},
            headers={"Content-Type": "application/json"},
        )
        if payload.get("errcode", 0) not in (0, None):
            raise DingTalkClientError("DingTalk directory request returned an error")
        children = payload.get("result") or []
        if isinstance(children, dict):
            children = children.get("list") or []
        for child in children:
            if not isinstance(child, dict):
                continue
            child_id = child.get("dept_id") or child.get("deptId")
            if child_id is None:
                continue
            user_id = self._department_user(child_id, token)
            if user_id:
                return user_id
        return None

    def test_connection(self):
        """Validate token and attendance API access without returning records."""
        self._require_config()
        token = self.access_token()
        user_id = self._sample_user_id(token)
        today = datetime.now(timezone.utc).date().isoformat()
        payload = self._request(
            "POST", self.ATTENDANCE_URL + "?access_token=" + token,
            json={"workDateFrom": f"{today} 00:00:00", "workDateTo": f"{today} 23:59:59", "userIdList": [user_id] if user_id else [], "offset": 0, "limit": 1},
            headers={"Content-Type": "application/json"},
        )
        if payload.get("errcode", 0) not in (0, None):
            raise DingTalkClientError("钉钉考勤接口无访问权限，请检查应用权限")
        return True

    get_attendance_records = attendance_records
    get_access_token = access_token

    @staticmethod
    def _normalize(item):
        def first(*keys):
            return next((item[k] for k in keys if item.get(k) is not None), None)

        def as_date(value):
            if isinstance(value, (int, float)):
                return (datetime.fromtimestamp(value / 1000, timezone.utc) + timedelta(hours=8)).date().isoformat()
            return value

        check_time = first("userCheckTime")
        result = first("timeResult", "locationResult", "result", "checkResult", "attendanceResult")
        if result == "NotSigned" or check_time in (None, "", 0, "0"):
            check_time = None

        return {
            "employee_no": first("empNo", "employeeNo", "employee_no"),
            "employee_user_id": first("userId", "userid", "user_id"),
            "date": as_date(first("workDate", "date", "recordDate")),
            "punch_in": check_time if first("checkType") == "OnDuty" else None,
            "punch_out": check_time if first("checkType") == "OffDuty" else None,
            "result": result,
            "time_result": first("timeResult"),
            "location_result": first("locationResult"),
            "is_late": first("timeResult") in {"Late", "SeriousLate", "Absence", "Absenteeism", "Absent"},
            "is_early_leave": first("timeResult") in {"Early", "EarlyLeave"},
            "raw_payload": _redact(item),
        }


def _redact(value):
    if isinstance(value, dict):
        return {k: ("[REDACTED]" if any(part in str(k).lower() for part in ("secret", "token", "accesskey")) else _redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


def _as_day(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def _date_ranges(first, last, size):
    current = first
    while current <= last:
        end = min(current + timedelta(days=size - 1), last)
        yield current.isoformat(), end.isoformat()
        current = end + timedelta(days=1)


def _chunks(values, size):
    for index in range(0, len(values), size):
        yield values[index:index + size]
