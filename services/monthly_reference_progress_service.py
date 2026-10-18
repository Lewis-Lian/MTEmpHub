"""Private, request-scoped snapshot progress shared by application workers."""
import json
import logging
import os
import re
import tempfile
import time
from pathlib import Path

logger = logging.getLogger(__name__)
PUBLIC_FIELDS = ('status', 'phase', 'stage', 'completed', 'total', 'percent')


def progress_path(token):
    from services.account_set_restore_service import private_backup_root
    if not isinstance(token, str) or not re.fullmatch('[0-9a-f]{32}', token):
        raise ValueError('快照任务标识无效')
    return private_backup_root() / 'snapshot-progress' / (token + '.json')


def get_reference_progress(token, owner_id):
    path = progress_path(token)
    idle = dict(status='idle', phase='waiting', stage='等待快照任务开始', completed=0, total=0, percent=None)
    try:
        payload = json.loads(path.read_text())
    except FileNotFoundError:
        return idle
    if payload['owner_id'] != owner_id:
        raise ValueError('无权读取该快照进度')
    if time.time() - payload['updated_at'] > 3600:
        return {**idle, 'stage': '快照进度已过期'}
    return {key: payload[key] for key in PUBLIC_FIELDS}


def start_reference_progress(token, owner_id):
    path = progress_path(token)
    if path.exists():
        get_reference_progress(token, owner_id)
        raise ValueError('快照任务标识已使用，请重新操作')
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    for old in path.parent.glob('*.json'):
        if old == path:
            continue
        try:
            payload = json.loads(old.read_text())
            if payload['owner_id'] == owner_id and time.time() - payload['updated_at'] > 3600:
                old.unlink(missing_ok=True)
        except (OSError, ValueError, KeyError):
            continue
    latest = dict(phase='prepare', stage='准备快照任务', completed=0, total=0)
    last_write, last_phase = 0, None

    def update(status='running', _create=False, **work):
        nonlocal last_write, last_phase
        latest.update(work)
        now = time.time()
        completed, total = latest['completed'], latest['total']
        phase = (latest['phase'], latest['stage'])
        if not _create and status == 'running' and phase == last_phase and now - last_write < 0.25 and completed != total:
            return
        percent = min(100, completed * 100 / total) if total else None
        if status == 'completed':
            percent = 100
        elif status == 'failed':
            percent = None
        payload = dict(owner_id=owner_id, updated_at=now, status=status, percent=percent, **latest)
        pending = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False, encoding='utf-8') as stream:
                pending = Path(stream.name)
                json.dump(payload, stream, ensure_ascii=False)
            if _create:
                os.link(pending, path)
                pending.unlink()
            else:
                pending.replace(path)
            last_write, last_phase = now, phase
        except FileExistsError as exc:
            raise ValueError('快照任务标识已使用，请重新操作') from exc
        except OSError as exc:
            if _create:
                raise ValueError('无法创建快照进度') from exc
            logger.warning('快照进度写入失败', exc_info=True)
        finally:
            if pending:
                pending.unlink(missing_ok=True)

    update(_create=True)
    return update


def report(progress, phase, stage, completed=0, total=0):
    if progress:
        progress(phase=phase, stage=stage, completed=completed, total=total)


def progress_rows(rows, progress, phase, stage):
    """Advance only after the caller has processed each real row."""
    report(progress, phase, stage, 0, len(rows))
    for index, row in enumerate(rows, 1):
        yield row
        report(progress, phase, stage, index, len(rows))
