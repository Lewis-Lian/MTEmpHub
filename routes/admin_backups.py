"""Private, expiring backup previews; every mutation is server-derived."""
from __future__ import annotations

from contextlib import contextmanager
from functools import wraps
from io import BytesIO
from pathlib import Path
import fcntl
import json
import re
import shutil
import time
import uuid

from flask import current_app, g, jsonify, request, send_file
from services.account_set_backup_service import MAX_UPLOAD, export_backup, read_backup
from services.account_set_backup_schema import BackupError, BackupTargetChanged, options_checked
from services.account_set_restore_service import build_preview, restore_backup, validate_selection, private_backup_root

TTL = 3600


def preview_root():
    root = private_backup_root() / 'previews'
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    return root


def atomic_json(path, value):
    pending = path.with_suffix('.tmp')
    pending.write_text(json.dumps(value), encoding='utf-8')
    pending.replace(path)


@contextmanager
def task_locked(token):
    if not re.fullmatch('[0-9a-f]{32}', token):
        raise BackupError('预览任务无效')
    path = preview_root() / token
    if not path.is_dir():
        raise BackupError('预览任务已失效，请重新上传')
    try:
        lock = (path / 'task.lock').open('a')
    except FileNotFoundError as exc:
        raise BackupError('预览任务已失效') from exc
    with lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        metadata_path = path / 'metadata.json'
        if not metadata_path.exists():
            raise BackupError('预览任务已失效')
        metadata = json.loads(metadata_path.read_text())
        if metadata['owner_id'] != g.current_user.id:
            raise BackupError('无权访问该预览任务')
        if time.time() - metadata['created_at'] > TTL:
            shutil.rmtree(path)
            raise BackupError('预览已过期，请重新上传')
        if metadata.get('completed'):
            raise BackupError('该备份已处理，请重新上传以再次比较')
        yield path, metadata


def clean_expired():
    # Lock before deleting so cleanup cannot remove an in-flight restore.
    for path in preview_root().iterdir():
        if not path.is_dir():
            continue
        try:
            with (path / 'task.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                metadata = json.loads((path / 'metadata.json').read_text())
                if time.time() - metadata['created_at'] > TTL:
                    shutil.rmtree(path)
        except (BlockingIOError, FileNotFoundError):
            continue


def register_admin_backup_routes(bp, admin_required):
    def handled(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            try:
                return function(*args, **kwargs)
            except BackupTargetChanged as exc:
                return jsonify({'error': str(exc)}), 409
            except BackupError as exc:
                return jsonify({'error': str(exc)}), 400
        return wrapped

    @bp.get('/account-sets/<int:account_set_id>/backup')
    @admin_required
    @handled
    def account_set_backup_download(account_set_id):
        data = export_backup(account_set_id)
        from models.account_set import AccountSet
        from models import db
        account = db.session.get(AccountSet, account_set_id)
        return send_file(BytesIO(data), mimetype='application/zip', as_attachment=True,
                         download_name='账套备份_%s.zip' % account.month)

    @bp.post('/account-set-backups/preview')
    @admin_required
    @handled
    def account_set_backup_upload():
        if request.content_length and request.content_length > MAX_UPLOAD + 1024 * 1024:
            return jsonify({'error': '上传文件超过 100 MiB'}), 413
        uploaded = request.files.get('file')
        if not uploaded:
            raise BackupError('请选择 ZIP 备份文件')
        data = uploaded.stream.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            return jsonify({'error': '上传文件超过 100 MiB'}), 413
        document = read_backup(data)
        preview = build_preview(document, {})
        clean_expired()
        token = uuid.uuid4().hex
        path = preview_root() / token
        path.mkdir(mode=0o700)
        (path / 'backup.zip').write_bytes(data)
        atomic_json(path / 'metadata.json', {'owner_id': g.current_user.id, 'created_at': time.time()})
        return jsonify({'token': token, **preview})

    @bp.post('/account-set-backups/<token>/preview')
    @admin_required
    @handled
    def account_set_backup_preview(token):
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            raise BackupError('预览请求无效')
        options = options_checked(body.get('options', {}))
        with task_locked(token) as (path, metadata):
            document = read_backup((path / 'backup.zip').read_bytes())
            preview = build_preview(document, options)
            preview['blockers'] = validate_selection(document, options, preview['rows'], body.get('choices', {}))
            return jsonify({'token': token, **preview})

    @bp.post('/account-set-backups/<token>/restore')
    @admin_required
    @handled
    def account_set_backup_restore(token):
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not isinstance(body.get('fingerprint'), str):
            raise BackupError('确认请求无效')
        with task_locked(token) as (path, metadata):
            document = read_backup((path / 'backup.zip').read_bytes())
            result = restore_backup(document, body.get('options', {}), body.get('choices', {}),
                                    body['fingerprint'], g.current_user.id)
            metadata['completed'] = True
            atomic_json(path / 'metadata.json', metadata)
            (path / 'backup.zip').unlink()
            return jsonify(result)

    @bp.delete('/account-set-backups/<token>')
    @admin_required
    @handled
    def account_set_backup_cancel(token):
        with task_locked(token) as (path, metadata):
            shutil.rmtree(path)
        return jsonify({'status': 'ok'})
