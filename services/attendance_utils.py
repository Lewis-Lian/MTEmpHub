"""Shared helpers for attendance synchronization services."""

from __future__ import annotations

import calendar
import unicodedata
from datetime import date, datetime


def month_bounds(month: str) -> tuple[date, date]:
    start = datetime.strptime(month, "%Y-%m").date().replace(day=1)
    return start, start.replace(day=calendar.monthrange(start.year, start.month)[1])


def normalize_employee_no(value) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).strip().casefold()
