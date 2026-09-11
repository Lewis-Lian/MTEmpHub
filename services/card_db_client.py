"""SQL Server client for the STCard 考勤机 (attendance card) database."""

from __future__ import annotations

import logging
import re
from datetime import datetime

from utils.helpers import split_time_cells

logger = logging.getLogger(__name__)


CARD_DB_TDS_VERSION = "7.0"
CARD_DB_DEFAULT_PORT = 1433

CARD_DB_SETTING_KEYS = {
    "host": "card_db_host",
    "port": "card_db_port",
    "database": "card_db_database",
    "user": "card_db_user",
    "password": "card_db_password",
}
CARD_DB_REQUIRED_KEYS = ("host", "database", "user", "password")


def card_db_config_from_settings() -> dict:
    """Read the saved card database connection settings."""
    from models.system_setting import SystemSetting

    config = {}
    for key, setting_key in CARD_DB_SETTING_KEYS.items():
        value = SystemSetting.get_value(setting_key, "")
        if key == "port" and str(value or "").strip():
            try:
                value = int(value)
            except (TypeError, ValueError):
                value = ""
        config[key] = str(value).strip() if isinstance(value, str) else (value or "")
    return config


def card_db_configured(config: dict | None) -> bool:
    return bool(config) and all(
        str(config.get(key) or "").strip() for key in CARD_DB_REQUIRED_KEYS
    )

ATTENDANCE_SQL = """
SELECT CAST(p.Person_No AS VARCHAR(20)),
       CAST(p.Person_Name AS VARCHAR(100)),
       CAST(d.Dept_Name AS VARCHAR(100)),
       CAST(b.Card_No AS VARCHAR(20)),
       b.Brush_Date,
       b.Brush_Data
FROM KQ_BrushCard b
JOIN ST_Person p ON b.Person_ID = p.Person_ID AND p.Is_Del = 0
LEFT JOIN ST_Department d ON p.Dept_ID = d.Dept_ID AND d.Is_Del = 0
WHERE b.Brush_Date >= %s AND b.Brush_Date <= %s
ORDER BY b.Brush_Date, p.Person_No
"""

_CARD_SENSITIVE_FIELDS = r"password|pwd|secret|token"


class CardDBClientError(RuntimeError):
    """A connection or query failure without credential details."""


def _connect_failed():
    raise CardDBClientError("card database connection failed") from None


def sanitize_card_error(error: Exception | str | None) -> str:
    """Return an actionable sync error without exposing the password."""
    message = str(error or "").strip()
    if "configuration is missing" in message.casefold():
        return "考勤机数据库未配置，请先在更多设置中填写连接参数"
    if "pymssql driver is not installed" in message.casefold():
        return "服务器未安装 pymssql 数据库驱动，请执行 pip install -r requirements.txt 后重试"
    if not message:
        return "考勤机数据库连接失败，请检查网络和数据库配置后重试"
    sanitized = re.sub(
        rf"(?i)((?:{_CARD_SENSITIVE_FIELDS})\s*[=:]\s*)('(?:[^']*)'|\"(?:[^\"]*)\"|[^\s,;]+)",
        r"\1[REDACTED]",
        message,
    )
    return sanitized or "考勤机数据库连接失败，请检查网络和数据库配置后重试"


class _PyMssqlConnect:
    def __call__(self, **kwargs):
        try:
            import pymssql  # 延迟导入：测试与未安装驱动的环境不依赖 pymssql
        except ImportError:
            raise CardDBClientError("pymssql driver is not installed") from None
        return pymssql.connect(**kwargs)


class CardDBClient:
    def __init__(self, config: dict | None, connect=None, *, timeout: int = 15):
        self.config = config or {}
        self._connect = connect or _PyMssqlConnect()
        self.timeout = timeout

    def _require_config(self):
        for key in ("host", "database", "user", "password"):
            if not str(self.config.get(key) or "").strip():
                raise CardDBClientError("card database configuration is missing")

    def _open(self):
        self._require_config()
        try:
            return self._connect(
                server=str(self.config["host"]).strip(),
                port=int(self.config.get("port") or CARD_DB_DEFAULT_PORT),
                database=str(self.config["database"]).strip(),
                user=str(self.config["user"]).strip(),
                password=str(self.config["password"]),
                tds_version=CARD_DB_TDS_VERSION,
                charset="utf8",
                timeout=self.timeout,
                login_timeout=self.timeout,
            )
        except CardDBClientError:
            raise
        except Exception:
            logger.warning("card db connect failed", exc_info=True)
        _connect_failed()

    def _query(self, sql, params=None, *, single=False):
        conn = self._open()
        try:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            rows = [cursor.fetchone()] if single else cursor.fetchall()
        except Exception:
            # 对外统一报错不泄露细节，但服务端留痕便于排查（错密码/不可达/SQL错误）
            logger.warning("card db query failed", exc_info=True)
            rows = None
        finally:
            conn.close()
        if rows is None:
            _query_failed()
        return rows

    def test_connection(self) -> str:
        row = self._query("SELECT @@VERSION", single=True)[0]
        return str(row[0]).split("\n")[0] if row and row[0] else ""

    def attendance_records(self, start_date, end_date) -> list[dict]:
        """Return card punches between the dates (inclusive), joined with person/department."""
        rows = self._query(ATTENDANCE_SQL, (str(start_date)[:10], str(end_date)[:10]))

        records = []
        for person_no, person_name, dept_name, card_no, brush_date, brush_data in rows:
            try:
                record_date = datetime.strptime(str(brush_date)[:10], "%Y-%m-%d").date()
            except ValueError:
                continue
            records.append(
                {
                    "person_no": str(person_no or "").strip(),
                    "person_name": str(person_name or "").strip(),
                    "dept_name": str(dept_name or "").strip(),
                    "card_no": str(card_no or "").strip(),
                    "record_date": record_date,
                    "times": split_time_cells(str(brush_data or "")),
                }
            )
        return records
