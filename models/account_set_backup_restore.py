from datetime import datetime
from . import db


class AccountSetBackupOrigin(db.Model):
    """Portable source identity; local IDs are never trusted across databases."""
    __tablename__ = 'account_set_backup_origins'
    id = db.Column(db.Integer, primary_key=True)
    dataset = db.Column(db.String(40), nullable=False)
    origin_key = db.Column(db.String(64), nullable=False)
    local_id = db.Column(db.Integer, nullable=False)
    provenance = db.Column(db.JSON, nullable=False, default=dict)
    __table_args__ = (db.UniqueConstraint('dataset', 'origin_key', name='uq_backup_origin'),)


class AccountSetBackupRestore(db.Model):
    __tablename__ = 'account_set_backup_restores'
    id = db.Column(db.Integer, primary_key=True)
    month = db.Column(db.String(7), nullable=False)
    operator_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    operator_username = db.Column(db.String(80), nullable=True)
    task_id = db.Column(db.String(64), nullable=True, index=True)
    backup_digest = db.Column(db.String(64), nullable=False)
    counts = db.Column(db.JSON, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


def remove_backup_origins(dataset, identifiers):
    AccountSetBackupOrigin.query.filter(
        AccountSetBackupOrigin.dataset == dataset,
        AccountSetBackupOrigin.local_id.in_(identifiers),
    ).delete(synchronize_session=False)


# ORM deletion paths (including replacement uploads and account cascade).
from sqlalchemy import event
from models.account_set import AccountSetImport
from models.dingtalk_sync_run import DingTalkSyncRun
from models.attendance_override_history import AttendanceOverrideHistory


def _remove_deleted_origin(mapper, connection, target):
    names = {AccountSetImport: 'imports', DingTalkSyncRun: 'sync_history', AttendanceOverrideHistory: 'override_history'}
    connection.execute(AccountSetBackupOrigin.__table__.delete().where(
        AccountSetBackupOrigin.dataset == names[type(target)],
        AccountSetBackupOrigin.local_id == target.id,
    ))


for _model in (AccountSetImport, DingTalkSyncRun, AttendanceOverrideHistory):
    event.listen(_model, 'after_delete', _remove_deleted_origin)
