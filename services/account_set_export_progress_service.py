"""Per-request export progress shared by workers, stored outside static files."""
from __future__ import annotations

import json
import logging
import re
import tempfile
import time
from pathlib import Path

from services.account_set_backup_schema import BackupError
from services.account_set_restore_service import private_backup_root

logger = logging.getLogger(__name__)


def progress_path(token):
    if not isinstance(token, str) or not re.fullmatch('[0-9a-f]{32}', token):
        raise BackupError('导出任务标识无效')
    return private_backup_root() / 'exports' / (token + '.json')


def get_export_progress(token, account_set_id, owner_id):
    path = progress_path(token)
    if not path.exists():
        return {'status': 'idle', 'percent': 0, 'stage': '等待导出开始'}
    payload = json.loads(path.read_text())
    if payload['owner_id'] != owner_id or payload['account_set_id'] != account_set_id:
        raise BackupError('无权读取该导出进度')
    if time.time() - payload['updated_at'] > 3600:
        return {'status': 'idle', 'percent': 0, 'stage': '导出进度已过期'}
    return {key: value for key, value in payload.items() if key not in ('owner_id', 'updated_at')}


def start_export_progress(token, account_set_id, owner_id):
    path = progress_path(token)
    if path.exists():
        # Check ownership before allowing a request to reuse any existing token.
        get_export_progress(token, account_set_id, owner_id)
        raise BackupError('导出任务标识已使用，请重新导出')
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    for old in path.parent.glob('*.json'):
        if time.time() - old.stat().st_mtime > 3600:
            old.unlink(missing_ok=True)
    base = {'owner_id': owner_id, 'account_set_id': account_set_id}
    def update(status='running', **work):
        payload = {**base, 'status': status, 'updated_at': time.time(), **work}
        pending = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False, encoding='utf-8') as stream:
                pending = Path(stream.name)
                json.dump(payload, stream, ensure_ascii=False)
            pending.replace(path)
        except OSError:
            if pending:
                pending.unlink(missing_ok=True)
            logger.warning('导出进度写入失败', exc_info=True)
    update(phase='data', percent=0, completed=0, total=0, stage='准备读取账套')
    return update
