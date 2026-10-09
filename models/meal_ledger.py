"""Independent business-month records; never affect subsidy settlement."""
from datetime import datetime

from models import db
from models.meal_ticket import new_key


class MealLedgerRecord(db.Model):
    __tablename__ = 'meal_ledger_records'
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(32), unique=True, nullable=False, default=new_key)
    kind = db.Column(db.String(20), nullable=False)
    month = db.Column(db.String(7), nullable=False, index=True)
    record_date = db.Column(db.Date, nullable=False)
    amount_cents = db.Column(db.Integer, nullable=False, default=0)
    data = db.Column(db.JSON, nullable=False)
    active_slot = db.Column(db.String(255), unique=True)
    request_key = db.Column(db.String(100), unique=True, nullable=False)
    request_digest = db.Column(db.String(64), nullable=False)
    source_key = db.Column(db.String(150), unique=True)
    operator = db.Column(db.String(80), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    voided = db.Column(db.Boolean, nullable=False, default=False)
    void_reason = db.Column(db.String(500))
    void_operator = db.Column(db.String(80))
    voided_at = db.Column(db.DateTime)


class MealLedgerImport(db.Model):
    __tablename__ = 'meal_ledger_imports'
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(32), unique=True, nullable=False, default=new_key)
    kind = db.Column(db.String(20), nullable=False)
    month = db.Column(db.String(7), nullable=False, index=True)
    source_filename = db.Column(db.String(255), nullable=False)
    file_digest = db.Column(db.String(64), nullable=False)
    stored_path = db.Column(db.String(500), nullable=False)
    data = db.Column(db.JSON, nullable=False)
    status = db.Column(db.String(20), nullable=False, default='preview')
    operator = db.Column(db.String(80), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


LEDGER_MODELS = (MealLedgerRecord, MealLedgerImport)
