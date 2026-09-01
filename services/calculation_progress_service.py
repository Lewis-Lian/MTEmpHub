"""账套计算进度：计算过程把进度写入 JSON 文件，供前端轮询。

为什么是文件而不是数据库：计算的业务事务会长时间持有 sqlite 写锁
（如管理人员汇总的逐人 flush），期间用独立连接写库会一直等到锁超时
（实测阻塞约 5 秒后 "database is locked"）。进度只是临时显示状态，
写文件即可绕开锁，也在 waitress/gunicorn 的单机多进程部署间共享。
"""

from __future__ import annotations

import json
import logging
import os
import tempfile

from flask import current_app

logger = logging.getLogger(__name__)


def _progress_path(account_set_id: int, mode: str) -> str:
    progress_dir = current_app.config["CALC_PROGRESS_DIR"]
    return os.path.join(progress_dir, f"{account_set_id}_{mode}.json")


def update_calc_progress(account_set_id: int, mode: str, percent: int, stage: str, status: str = "running") -> None:
    """覆盖式写入 (账套, 模式) 的最新进度。"""
    payload = {
        "account_set_id": account_set_id,
        "mode": mode,
        "status": status,
        "percent": int(percent),
        "stage": stage,
    }
    try:
        progress_dir = current_app.config["CALC_PROGRESS_DIR"]
        os.makedirs(progress_dir, exist_ok=True)
        path = _progress_path(account_set_id, mode)
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
        # 进度只是显示辅助，写失败不能中断计算本身
        logger.warning(
            "账套计算进度写入失败 account_set_id=%s mode=%s", account_set_id, mode, exc_info=True
        )


def get_calc_progress(account_set_id: int, mode: str) -> dict | None:
    """读取 (账套, 模式) 的最新进度；尚未开始计算时返回 None。"""
    try:
        with open(_progress_path(account_set_id, mode), encoding="utf-8") as f:
            payload = json.load(f)
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        logger.warning("账套计算进度文件读取失败 account_set_id=%s mode=%s", account_set_id, mode, exc_info=True)
        return None
    if not isinstance(payload, dict):
        return None
    return payload
