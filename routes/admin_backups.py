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
from services.account_set_backup_service import MAX_UPLOAD, export_backup, export_multi_backup, read_backup
from services.account_set_backup_schema import BackupError, BackupTargetChanged, options_checked
from services.account_set_restore_service import (build_preview, restore_backup, validate_selection, private_backup_root,
                                                  build_multi_preview, restore_multi_backup)

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
        from models.account_set_backup_restore import AccountSetBackupRestore
        if any(row.counts.get('status') == 'success' for row in AccountSetBackupRestore.query.filter_by(task_id=token).all()):
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

    @bp.post('/backups/export')
    @admin_required
    @handled
    def multi_backup_download():
        from services.account_set_export_progress_service import start_export_progress
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or 'account_set_ids' not in body:
            raise BackupError('导出请求无效')
        token = body.get('export_token')
        update = start_export_progress(token, None, g.current_user.id, account_set_ids=body['account_set_ids']) if token is not None else None
        try:
            data = export_multi_backup(body['account_set_ids'], body.get('categories'), progress=update)
        except Exception as exc:
            if update:
                update(status='failed', phase='failed', percent=0,
                       stage=str(exc) if isinstance(exc, BackupError) else '备份导出失败')
            raise
        response = send_file(BytesIO(data), mimetype='application/zip', as_attachment=True,
                             download_name='多月份备份.zip')
        if update:
            total = len(data)
            update(phase='download', completed=0, total=total, percent=0, stage='发送备份文件')
            source = response.response
            def download():
                completed = 0
                try:
                    for chunk in source:
                        yield chunk
                        completed += len(chunk)
                        update(phase='download', completed=completed, total=total,
                               percent=completed * 100 // total, stage='发送备份文件')
                    update(status='ready', phase='download', completed=completed, total=total,
                           percent=100, stage='备份文件发送完成')
                except BaseException:
                    update(status='failed', phase='download', completed=completed, total=total,
                           percent=completed * 100 // total, stage='备份文件发送中断')
                    raise
                finally:
                    if hasattr(source, 'close'):
                        source.close()
            response.response = download()
        return response

    @bp.get('/backups/export/progress')
    @admin_required
    @handled
    def multi_backup_progress():
        from services.account_set_export_progress_service import get_export_progress
        return jsonify(get_export_progress(request.args.get('export_token'), None, g.current_user.id))

    @bp.get('/backups/preview/progress')
    @admin_required
    @handled
    def multi_backup_import_progress():
        from services.account_set_import_progress_service import get_import_progress
        return jsonify(get_import_progress(request.args.get('progress_token'), g.current_user.id))

    @bp.post('/backups/preview')
    @admin_required
    @handled
    def multi_backup_upload():
        from services.account_set_import_progress_service import start_import_progress
        progress_token = request.args.get('progress_token')
        update = start_import_progress(progress_token, g.current_user.id) if progress_token is not None else None
        try:
            if request.content_length and request.content_length > MAX_UPLOAD + 1024 * 1024:
                if update:
                    update(status='failed', phase='failed', stage='上传文件超过 100 MiB')
                return jsonify({'error': '上传文件超过 100 MiB'}), 413
            uploaded = request.files.get('file')
            if not uploaded:
                raise BackupError('请选择 ZIP 备份文件')
            data = uploaded.stream.read(MAX_UPLOAD + 1)
            if len(data) > MAX_UPLOAD:
                if update:
                    update(status='failed', phase='failed', stage='上传文件超过 100 MiB')
                return jsonify({'error': '上传文件超过 100 MiB'}), 413
            document = read_backup(data, normalized=True, progress=update)
            from services.account_set_backup_schema import DATASET_CATEGORIES, FILE_DATASETS
            included = {scope.split('/')[-1] for scope, coverage in document['coverage'].items() if coverage['included']}
            categories = {DATASET_CATEGORIES[name] for name in included} - {'monthly_references'}
            if included & (FILE_DATASETS | {'meal_import_rows'}):
                categories.add('archives')
            selection = dict(months=document['months'], categories=sorted(categories), cross_month_keys=[], annual_keys=[])
            preview = build_multi_preview(document, selection, progress=update)
            clean_expired()
            token = uuid.uuid4().hex
            path = preview_root() / token
            path.mkdir(mode=0o700)
            try:
                (path / 'backup.zip').write_bytes(data)
                atomic_json(path / 'metadata.json', dict(owner_id=g.current_user.id, created_at=time.time(), format='multi'))
            except Exception:
                shutil.rmtree(path)
                raise
            response = jsonify(dict(token=token, selection=selection, **preview))
            if update:
                update(status='completed', phase='completed', completed=1, total=1, stage='差异预览已就绪')
            return response
        except Exception as exc:
            from sqlalchemy.exc import OperationalError
            message = str(exc) if isinstance(exc, BackupError) else '备份解析失败，请查看服务器日志'
            if isinstance(exc, OperationalError) and getattr(exc.orig, 'args', (None,))[0] in (1054, 1146):
                message = '数据库结构尚未升级，请先执行数据库升级后重试'
            if update:
                update(status='failed', phase='failed', stage=message)
            if isinstance(exc, BackupError):
                raise
            current_app.logger.exception('备份上传解析失败')
            return jsonify({'error': message}), 500

    @bp.post('/backups/<token>/preview')
    @admin_required
    @handled
    def multi_backup_preview(token):
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not isinstance(body.get('selection'), dict):
            raise BackupError('预览请求无效')
        with task_locked(token) as (path, metadata):
            document = read_backup((path / 'backup.zip').read_bytes(), normalized=True)
            preview = build_multi_preview(document, body['selection'], body.get('choices', {}))
            return jsonify(dict(token=token, selection=body['selection'], **preview))

    @bp.post('/backups/<token>/restore')
    @admin_required
    @handled
    def multi_backup_restore(token):
        body = request.get_json(silent=True)
        if (not isinstance(body, dict) or not isinstance(body.get('fingerprint'), str)
                or not isinstance(body.get('selection'), dict)):
            raise BackupError('确认请求无效')
        with task_locked(token) as (path, metadata):
            document = read_backup((path / 'backup.zip').read_bytes(), normalized=True)
            try:
                result = restore_multi_backup(document, body['selection'], body.get('choices', {}),
                                              body['fingerprint'], g.current_user.id, task_id=token)
            except BackupError:
                raise
            except Exception:
                current_app.logger.error('多月份恢复失败，业务事务已撤销')
                return jsonify({'error': '恢复失败，数据未保存，请重新预览后重试'}), 500
            # DB audit is authoritative if task-file cleanup fails after commit.
            try:
                metadata['completed'] = True
                atomic_json(path / 'metadata.json', metadata)
                (path / 'backup.zip').unlink()
            except OSError:
                result['warnings'].append('恢复已保存，预览临时文件将在过期后清理')
            return jsonify(result)

    @bp.delete('/backups/<token>')
    @admin_required
    @handled
    def multi_backup_cancel(token):
        with task_locked(token) as (path, metadata):
            shutil.rmtree(path)
        return jsonify({'status': 'ok'})

    @bp.get('/account-sets/<int:account_set_id>/backup')
    @admin_required
    @handled
    def account_set_backup_download(account_set_id):
        from services.account_set_export_progress_service import start_export_progress
        token = request.args.get('export_token')
        update = start_export_progress(token, account_set_id, g.current_user.id) if token else None
        try:
            data = export_backup(account_set_id, progress=update)
            if update:
                update(status='ready', phase='verification', percent=100, completed=1, total=1, stage='备份生成完成，准备下载')
        except Exception as exc:
            if update:
                update(status='failed', phase='failed', percent=0, stage=str(exc) if isinstance(exc, BackupError) else '账套导出失败')
            raise
        from models.account_set import AccountSet
        from models import db
        account = db.session.get(AccountSet, account_set_id)
        return send_file(BytesIO(data), mimetype='application/zip', as_attachment=True,
                         download_name='账套备份_%s.zip' % account.month)

    @bp.get('/account-sets/<int:account_set_id>/backup/progress')
    @admin_required
    @handled
    def account_set_backup_progress(account_set_id):
        from services.account_set_export_progress_service import get_export_progress
        return jsonify(get_export_progress(request.args.get('export_token'), account_set_id, g.current_user.id))

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
