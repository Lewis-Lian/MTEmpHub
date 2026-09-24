"""Shared helpers for attendance synchronization services."""

from __future__ import annotations

import calendar
import unicodedata
from datetime import date, datetime


def month_bounds(month: str) -> tuple[date, date]:
    start = datetime.strptime(month, "%Y-%m").date().replace(day=1)
    return start, start.replace(day=calendar.monthrange(start.year, start.month)[1])


def month_date_range(month: str) -> tuple[date, date] | None:
    """Return the first day of the month and the exclusive next-month boundary."""
    try:
        start = datetime.strptime(month, "%Y-%m").date().replace(day=1)
    except ValueError:
        return None
    if start.month == 12:
        return start, date(start.year + 1, 1, 1)
    return start, date(start.year, start.month + 1, 1)


def normalize_employee_no(value) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).strip().casefold()
