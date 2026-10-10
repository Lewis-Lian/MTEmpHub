"""One transaction for all selected months, shared identities and local files."""
from datetime import date, datetime
from pathlib import Path
import json
import shutil
import uuid

from flask import current_app
from sqlalchemy import Date, DateTime, text
from sqlalchemy.exc import IntegrityError
from models import db
from models.user import User
from models.account_set_backup_restore import AccountSetBackupOrigin, AccountSetBackupRestore
from services.account_set_backup_schema import (
    V2_DATASETS, V2_REFS, FILE_DATASETS, HISTORY, BackupError, BackupTargetChanged, digest,
)
from services.multi_month_restore_preview import _build, EXIT_CURRENT
from services.account_set_restore_service import private_backup_root, restore_lock, cleanup_old_files
from services.account_set_backup_service import serialize_row


# Explicit business dependencies also include the meal string foreign keys.
ORDER = ['departments', 'shifts', 'employees', 'account_set', 'users',
         'employee_shift_assignments', 'user_employee_assignments', 'user_department_assignments',
         'snapshots', 'factory_rest', 'daily_records', 'monthly_reports', 'leave_records',
         'overtime_records', 'daily_overrides', 'employee_overrides', 'manager_overrides',
         'annual_leave', 'manager_stats', 'override_history', 'sync_history', 'imports',
         'meal_batches', 'meal_items', 'meal_adjustments', 'meal_payments',
         'meal_followup_tasks', 'meal_followup_allocations',
         'meal_imports', 'meal_import_rows', 'meal_ledger_imports', 'meal_ledger_records']


def _fields(name, value, month):
    ds = V2_DATASETS[name]
    fields = {}
    for field in ds.fields:
        if field not in value:
            continue  # V1 subsets never reset later fields.
        item = value[field]
        kind = ds.model.__table__.columns[field].type
        if item is not None and isinstance(kind, DateTime):
            item = datetime.fromisoformat(item)
        elif item is not None and isinstance(kind, Date):
            item = date.fromisoformat(item)
        fields[field] = item
    for field, (natural, model, attribute) in V2_REFS.get(name, {}).items():
        # Frozen V1 account-scoped rows carry their month in the container.
        identifier = value.get(natural, month) if natural == 'account_month' else value[natural]
        fields[field] = model.query.filter(getattr(model, attribute) == identifier).one().id if identifier is not None else None
    return fields


def _audit(task_id, operator_id, username, document, selection, counts):
    requested = selection.get('months', [])
    months = document.get('months') or [document.get('month')]
    selected = sorted(m for m in requested if isinstance(m, str) and m in months) if isinstance(requested, list) else []
    db.session.add(AccountSetBackupRestore(
        month=selected[0] if selected else months[0],
        operator_id=operator_id, operator_username=username, task_id=task_id,
        backup_digest=digest({k: v for k, v in document.items() if k != '_files'}), counts=counts))


def restore_multi_backup(document, selection, choices, fingerprint, operator_id, *, task_id=None):
    task_id = task_id or uuid.uuid4().hex
    root = private_backup_root()
    staging = root / 'staging' / task_id
    destination = Path(current_app.config['UPLOAD_FOLDER']).resolve() / 'backup_restores' / task_id
    committed = False
    with restore_lock():
        # Rollback and expire: confirmation must not reuse the preview's ORM cache.
        db.session.rollback()
        db.session.expire_all()
        operator = db.session.get(User, operator_id)
        username = operator.username if operator else None
        db.session.rollback()
        try:
            if db.engine.dialect.name == 'sqlite':
                db.session.execute(text('BEGIN IMMEDIATE'))
            else:
                for ds in V2_DATASETS.values():
                    ds.model.query.order_by(ds.model.id).with_for_update().all()
            preview, document, internal, local = _build(document, selection, choices, private=True)
            if preview['fingerprint'] != fingerprint:
                raise BackupTargetChanged('系统数据已变化，请重新预览后确认')
            if preview['blockers']:
                raise BackupError('；'.join(b['message'] for b in preview['blockers']))
            changes = [r for r in preview['rows'] if r['enabled'] and r['choice'] == 'backup' and r['status'] != 'same']
            objects = {}
            for row in changes:
                scope, identity, left, value = internal[row['row_key']]
                info = local.get(row['row_key']) or local.get(scope + '/' + identity)
                if row['dataset'] == 'meal_ledger_imports' and info is None:
                    info = next((v for k, v in local.items() if k.endswith('/meal_ledger_imports/' + identity)), None)
                objects[row['row_key']] = db.session.get(V2_DATASETS[row['dataset']].model, info['id']) if info else None
            counts = dict(new=0, updated=0, deleted=0, skipped=len(preview['rows']) - len(changes))
            category_counts, old_paths, file_paths = {}, [], {}
            # Bytes remain private until every selected file has been staged.
            for row in changes:
                value = internal[row['row_key']][3]
                if not value:
                    continue
                file_key = value.get('avatar_file_key' if row['dataset'] == 'users' else 'file_key')
                if file_key:
                    staging.mkdir(parents=True, exist_ok=True, mode=0o700)
                    filename = uuid.uuid4().hex
                    (staging / filename).write_bytes(document['_files'][file_key])
                    file_paths[row['row_key']] = destination / filename
            if staging.exists():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(staging), str(destination))
            # Release selected card assignments before a valid swap is applied.
            for row in changes:
                obj = objects[row['row_key']]
                if row['dataset'] == 'employees' and obj and internal[row['row_key']][3]:
                    obj.card_no = None
            db.session.flush()
            # Temporary parent anchors release selected meal items without
            # disabling FK checks or touching any unselected consumer.
            anchors = []
            batch_model = V2_DATASETS['meal_batches'].model
            for row in changes:
                obj = objects[row['row_key']]
                value = internal[row['row_key']][3]
                if row['dataset'] == 'meal_items' and obj and value:
                    batch = batch_model.query.filter_by(key=obj.batch_key).one()
                    fields = {c.name: getattr(batch, c.name) for c in batch_model.__table__.columns if c.name != 'id'}
                    fields.update(key=uuid.uuid4().hex, month='T' + uuid.uuid4().hex[:6])
                    anchor = batch_model(**fields)
                    db.session.add(anchor)
                    db.session.flush()
                    obj.batch_key = anchor.key
                    db.session.flush()
                    anchors.append(anchor)
                if row['dataset'] == 'meal_payments' and obj and value:
                    obj.request_key = uuid.uuid4().hex
                    obj.reversal_of = None
                if row['dataset'] == 'meal_ledger_records' and obj and value:
                    obj.active_slot = obj.source_key = None
                    obj.request_key = uuid.uuid4().hex
                if row['dataset'] == 'meal_imports' and obj and value:
                    obj.file_digest = uuid.uuid4().hex
            db.session.flush()
            # Delete business children first; current identities remain FK anchors.
            deletions = [r for r in changes if internal[r['row_key']][3] is None]
            deletions.sort(key=lambda r: (ORDER.index(r['dataset']), bool((r['system'] or {}).get('reversal_of'))), reverse=True)
            affected_users = set()
            for row in deletions:
                name, obj = row['dataset'], objects[row['row_key']]
                if name in EXIT_CURRENT:
                    obj.is_active = False
                    if name == 'users':
                        affected_users.add(obj.id)
                else:
                    db.session.delete(obj)
                if name in FILE_DATASETS:
                    old_paths.append(str(Path(obj.stored_path).resolve()))
                if name.startswith('user_'):
                    affected_users.add(obj.user_id)
                counts['deleted'] += 1
                category_counts.setdefault(row['category'], dict(new=0, updated=0, deleted=0))['deleted'] += 1
                db.session.flush()
            for row in changes:
                obj = objects[row['row_key']]
                value = internal[row['row_key']][3]
                if row['dataset'] == 'meal_batches' and obj and value and obj.key != value['key']:
                    obj.key = uuid.uuid4().hex
            db.session.flush()
            writes = [r for r in changes if internal[r['row_key']][3] is not None]
            writes.sort(key=lambda r: (ORDER.index(r['dataset']), bool(internal[r['row_key']][3].get('reversal_of'))))
            # New department anchors first, then resolve the final parent tree.
            for row in writes:
                if row['dataset'] == 'departments' and objects[row['row_key']] is None:
                    value = internal[row['row_key']][3]
                    obj = V2_DATASETS['departments'].model(dept_no=value['dept_no'], dept_name=value['dept_name'])
                    db.session.add(obj)
                    db.session.flush()
                    objects[row['row_key']] = obj
            for row in writes:
                name, value = row['dataset'], internal[row['row_key']][3]
                ds, obj = V2_DATASETS[name], objects[row['row_key']]
                fields = _fields(name, value, row['month'])
                if name == 'account_set' and obj is None:
                    fields.update(is_active=False, is_locked=False)
                if name in FILE_DATASETS:
                    if obj:
                        old_paths.append(str(Path(obj.stored_path).resolve()))
                    fields['stored_path'] = str(file_paths[row['row_key']])
                if name == 'users':
                    # Avatar URLs point at the existing protected avatar endpoint.
                    if value.get('avatar_file_key'):
                        avatar_dir = Path(current_app.config['UPLOAD_FOLDER']) / 'avatars'
                        avatar_dir.mkdir(parents=True, exist_ok=True)
                        avatar_path = avatar_dir / (task_id + '-' + file_paths[row['row_key']].name)
                        staged_path = file_paths[row['row_key']]
                        file_paths[row['row_key']] = avatar_path
                        shutil.move(str(staged_path), str(avatar_path))
                        fields['avatar'] = '/api/auth/avatar/' + avatar_path.name
                    elif 'avatar_preset' in value or 'avatar_file_key' in value:
                        fields['avatar'] = value.get('avatar_preset')
                    if obj and obj.avatar and obj.avatar.startswith('/api/auth/avatar/'):
                        old_paths.append(str((Path(current_app.config['UPLOAD_FOLDER']) / 'avatars' / Path(obj.avatar).name).resolve()))
                if hasattr(ds.model, 'updated_by'):
                    fields['updated_by'] = operator_id
                if name == 'override_history':
                    fields['operator_user_id'] = None
                if obj is None:
                    obj = ds.model(**fields)
                    db.session.add(obj)
                else:
                    for field, content in fields.items():
                        setattr(obj, field, content)
                db.session.flush()
                if name == 'users':
                    affected_users.add(obj.id)
                elif name.startswith('user_'):
                    affected_users.add(obj.user_id)
                if name in HISTORY:
                    AccountSetBackupOrigin.query.filter_by(dataset=name, local_id=obj.id).delete(synchronize_session=False)
                    origin = AccountSetBackupOrigin.query.filter_by(dataset=name, origin_key=value['origin_key']).first()
                    content = {k: v for k, v in serialize_row(name, obj).items()
                               if k not in ('created_at', 'origin_key', 'provenance', 'file_key', 'file_sha256', 'file_size')}
                    provenance = {**value['provenance'], '_content_hash': digest(content)}
                    if origin is None:
                        db.session.add(AccountSetBackupOrigin(dataset=name, origin_key=value['origin_key'], local_id=obj.id, provenance=provenance))
                    else:
                        origin.local_id, origin.provenance = obj.id, provenance
                action = 'new' if row['status'] == 'new' else 'updated'
                counts[action] += 1
                category_counts.setdefault(row['category'], dict(new=0, updated=0, deleted=0))[action] += 1
            for user_id in affected_users:
                db.session.get(User, user_id).revoke_tokens()
            for anchor in anchors:
                db.session.delete(anchor)
            db.session.flush()
            admins = User.query.filter_by(role='admin', is_active=True, login_disabled_until_admin_unlock=False).all()
            if not any(u.password_hash and not u.is_temporarily_login_locked() for u in admins):
                raise BackupError('恢复后必须保留至少一个可登录管理员')
            details = dict(status='success', months=preview['months'], selection=selection, choices=choices,
                           counts=counts, category_counts=category_counts,
                           final_choices={r['row_key']: r['choice'] for r in preview['rows'] if r['enabled']},
                           affected_months=sorted({m for r in changes for m in r['affected_months']}),
                           current_exits=[r['row_key'] for r in deletions if r['dataset'] in EXIT_CURRENT])
            _audit(task_id, operator_id, username, document, selection, details)
            journal = root / 'cleanup.json'
            previous = json.loads(journal.read_text()) if journal.exists() else []
            journal.write_text(json.dumps(sorted(set(previous + old_paths))))
            db.session.commit()
            committed = True
            try:
                warnings = cleanup_old_files(root)
            except Exception:
                warnings = ['旧归档清理暂未完成，恢复数据已保存，下次恢复时会重试']
            return dict(task_id=task_id, months=preview['months'], counts=counts, category_counts=category_counts,
                        warnings=warnings, reauthentication_required=operator_id in affected_users)
        except Exception as exc:
            db.session.rollback()
            # Failure is audited separately after the entire business transaction rolls back.
            if username:
                _audit(task_id, operator_id, username, document, selection,
                       dict(status='failed', months=selection.get('months', []), error='恢复未保存'))
                db.session.commit()
            if isinstance(exc, IntegrityError):
                raise BackupError('业务编号或卡号冲突，导入未保存，请重新预览') from exc
            raise
        finally:
            if not committed:
                db.session.rollback()
                for path in file_paths.values() if 'file_paths' in locals() else []:
                    path.unlink(missing_ok=True)
                shutil.rmtree(staging, ignore_errors=True)
                shutil.rmtree(destination, ignore_errors=True)
