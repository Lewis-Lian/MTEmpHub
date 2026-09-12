"""考勤同步真实进度服务：在员工和管理人员考勤同步过程中写入实时进度，供前端轮询。

与账套计算进度类似，使用文件持久化避开数据库锁，实现进程间即时共享。
"""

from __future__ import annotations

import json
import logging
import os
import tempfile

from flask import current_app

logger = logging.getLogger(__name__)


def _get_progress_dir() -> str:
    if current_app:
        progress_dir = current_app.config.get("SYNC_PROGRESS_DIR") or current_app.config.get("CALC_PROGRESS_DIR")
        if progress_dir:
            return progress_dir
    return os.path.join(tempfile.gettempdir(), "mtemphub_sync_progress")


def _progress_path(account_set_id: int, sync_type: str) -> str:
    progress_dir = _get_progress_dir()
    return os.path.join(progress_dir, f"{account_set_id}_sync_{sync_type}.json")


def update_sync_progress(
    account_set_id: int,
    sync_type: str,
    percent: int,
    stage: str,
    status: str = "running",
) -> None:
    """覆盖式写入 (账套, 同步类型) 的最新进度。"""
    payload = {
        "account_set_id": account_set_id,
        "sync_type": sync_type,
        "status": status,
        "percent": max(0, min(100, int(percent))),
        "stage": stage,
    }
    try:
        progress_dir = _get_progress_dir()
        os.makedirs(progress_dir, exist_ok=True)
        path = _progress_path(account_set_id, sync_type)
        fd, tmp_path = tempfile.mkstemp(dir=progress_dir, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
            os.replace(tmp_path, path)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    except Exception:
        logger.warning(
            "考勤同步进度写入失败 account_set_id=%s sync_type=%s",
            account_set_id,
            sync_type,
            exc_info=True,
        )


def get_sync_progress(account_set_id: int, sync_type: str) -> dict | None:
    """读取 (账套, 同步类型) 的最新进度；无进度时返回 None。"""
    try:
        with open(_progress_path(account_set_id, sync_type), encoding="utf-8") as f:
            payload = json.load(f)
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        logger.warning(
            "考勤同步进度文件读取失败 account_set_id=%s sync_type=%s",
            account_set_id,
            sync_type,
            exc_info=True,
        )
        return None
    if not isinstance(payload, dict):
        return None
    return payload
