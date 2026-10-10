"""Per-request import progress shared by workers, stored outside static files."""
from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import time
from pathlib import Path

from services.account_set_backup_schema import BackupError
from services.account_set_restore_service import private_backup_root

logger = logging.getLogger(__name__)


def progress_path(token):
    if not isinstance(token, str) or not re.fullmatch('[0-9a-f]{32}', token):
        raise BackupError('导入任务标识无效')
    return private_backup_root() / 'imports' / (token + '.json')


def get_import_progress(token, owner_id):
    path = progress_path(token)
    if not path.exists():
        return {'status': 'idle', 'percent': 0, 'stage': '等待导入开始'}
    payload = json.loads(path.read_text())
    if payload['owner_id'] != owner_id:
        raise BackupError('无权读取该导入进度')
    if time.time() - payload['updated_at'] > 3600:
        return {'status': 'idle', 'percent': 0, 'stage': '导入进度已过期'}
    return {key: value for key, value in payload.items() if key not in ('owner_id', 'updated_at')}


def start_import_progress(token, owner_id):
    path = progress_path(token)
    if path.exists():
        # Check ownership before allowing a request to reuse any existing token.
        get_import_progress(token, owner_id)
        raise BackupError('导入任务标识已使用，请重新导入')
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    for old in path.parent.glob('*.json'):
        if time.time() - old.stat().st_mtime > 3600:
            old.unlink(missing_ok=True)
    base = {'owner_id': owner_id}
    last_write, last_phase = 0, None
    def update(status='running', _create=False, **work):
        nonlocal last_write, last_phase
        now = time.time()
        phase = work.get('phase')
        completed, total = work.get('completed', 0), work.get('total', 0)
        if not _create and status == 'running' and phase == last_phase and now - last_write < 0.25 and completed != total:
            return
        work['percent'] = min(100, completed * 100 / total) if total else None
        if status == 'completed':
            work['percent'] = 100
        payload = {**base, 'status': status, 'updated_at': now, **work}
        pending = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False, encoding='utf-8') as stream:
                pending = Path(stream.name)
                json.dump(payload, stream, ensure_ascii=False)
            if _create:
                # Atomic creation: concurrent workers cannot claim the same token.
                os.link(pending, path)
                pending.unlink()
            else:
                pending.replace(path)
            last_write, last_phase = now, phase
        except FileExistsError as exc:
            if pending:
                pending.unlink(missing_ok=True)
            raise BackupError('导入任务标识已使用，请重新导入') from exc
        except OSError:
            if pending:
                pending.unlink(missing_ok=True)
            if _create:
                raise BackupError('无法创建导入进度')
            logger.warning('导入进度写入失败', exc_info=True)
    update(_create=True, phase='upload', completed=0, total=0, stage='接收备份文件')
    return update
