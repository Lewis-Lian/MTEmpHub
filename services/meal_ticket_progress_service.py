"""Request-scoped read progress, shared across workers without holding DB locks."""
import json
import logging
import re
import tempfile
import time
from pathlib import Path

from services.account_set_restore_service import private_backup_root
from services.meal_ticket_service import MealError


def progress_path(token, owner_id):
    if not isinstance(token, str) or not re.fullmatch('[0-9a-f]{32}', token):
        raise MealError('读取任务标识无效')
    return private_backup_root() / 'meal-reads' / f'{owner_id}_{token}.json'


def read_progress(token, owner_id):
    path = progress_path(token, owner_id)
    if not path.exists() or time.time() - path.stat().st_mtime > 3600:
        return {'status': 'idle'}
    return json.loads(path.read_text(encoding='utf-8'))


def start_progress(token, owner_id):
    path = progress_path(token, owner_id)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    for old in path.parent.glob('*.json'):
        if time.time() - old.stat().st_mtime > 3600:
            old.unlink(missing_ok=True)
    last_stage, last_write = None, 0

    def update(stage, completed=0, total=0, status='running'):
        nonlocal last_stage, last_write
        now = time.monotonic()
        if stage == last_stage and completed < total and now - last_write < 0.1:
            return
        pending = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False, encoding='utf-8') as stream:
                pending = Path(stream.name)
                json.dump({'status': status, 'stage': stage, 'completed': completed, 'total': total}, stream, ensure_ascii=False)
            pending.replace(path)
            last_stage, last_write = stage, now
        except OSError:
            if pending:
                pending.unlink(missing_ok=True)
            logging.getLogger(__name__).warning('月度读取进度写入失败', exc_info=True)

    update('读取月度核算记录')
    return update
