from datetime import datetime
import uuid

from . import db


def new_key():
    return uuid.uuid4().hex


class MealTicketBatch(db.Model):
    __tablename__ = 'meal_ticket_batches'
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(32), unique=True, nullable=False, default=new_key)
    account_set_id = db.Column(db.Integer, db.ForeignKey('account_sets.id'), nullable=False)
    month = db.Column(db.String(7), unique=True, nullable=False)
    recharge_month = db.Column(db.String(7), nullable=False)
    rule_version = db.Column(db.String(40), nullable=False, default='actual-days-v1')
    rate_cents = db.Column(db.Integer, nullable=False, default=800)
    status = db.Column(db.String(20), nullable=False, default='draft')
    version = db.Column(db.Integer, nullable=False, default=1)
    source_digest = db.Column(db.String(64), nullable=False)
    created_by = db.Column(db.String(80), nullable=False)
    confirmed_by = db.Column(db.String(80))
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    confirmed_at = db.Column(db.DateTime)
    reconciliation = db.Column(db.JSON)


class MealTicketItem(db.Model):
    __tablename__ = 'meal_ticket_items'
    __table_args__ = (db.UniqueConstraint('batch_key', 'emp_id'),)
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(32), unique=True, nullable=False, default=new_key)
    batch_key = db.Column(db.String(32), db.ForeignKey('meal_ticket_batches.key'), nullable=False)
    month = db.Column(db.String(7), nullable=False, index=True)
    emp_id = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=False)
    emp_no_snapshot = db.Column(db.String(50), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    dept_name = db.Column(db.String(100), nullable=False)
    is_manager = db.Column(db.Boolean, nullable=False)
    days = db.Column(db.Float, nullable=False)
    base_cents = db.Column(db.Integer, nullable=False)
    source = db.Column(db.JSON, nullable=False)
    error = db.Column(db.String(255), nullable=False, default='')


class MealTicketAdjustment(db.Model):
    __tablename__ = 'meal_ticket_adjustments'
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(32), unique=True, nullable=False, default=new_key)
    item_key = db.Column(db.String(32), db.ForeignKey('meal_ticket_items.key'), nullable=False)
    month = db.Column(db.String(7), nullable=False, index=True)
    amount_cents = db.Column(db.Integer, nullable=False)
    reason = db.Column(db.String(500), nullable=False)
    operator = db.Column(db.String(80), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class MealTicketPayment(db.Model):
    __tablename__ = 'meal_ticket_payments'
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(32), unique=True, nullable=False, default=new_key)
    item_key = db.Column(db.String(32), db.ForeignKey('meal_ticket_items.key'), nullable=False)
    month = db.Column(db.String(7), nullable=False, index=True)
    kind = db.Column(db.String(20), nullable=False)
    amount_cents = db.Column(db.Integer, nullable=False)
    payment_date = db.Column(db.Date, nullable=False)
    reference = db.Column(db.String(500), nullable=False)
    operator = db.Column(db.String(80), nullable=False)
    request_key = db.Column(db.String(100), unique=True, nullable=False)
    request_digest = db.Column(db.String(64), nullable=False)
    reversal_of = db.Column(db.String(32), db.ForeignKey('meal_ticket_payments.key'), unique=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class MealTicketImport(db.Model):
    __tablename__ = 'meal_ticket_imports'
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(32), unique=True, nullable=False, default=new_key)
    month = db.Column(db.String(7), nullable=False, index=True)
    recharge_month = db.Column(db.String(7), nullable=False)
    source_filename = db.Column(db.String(255), nullable=False)
    file_digest = db.Column(db.String(64), nullable=False)
    stored_path = db.Column(db.String(500), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='preview')
    operator = db.Column(db.String(80), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (db.UniqueConstraint('file_digest', 'month'),)


class MealTicketImportRow(db.Model):
    __tablename__ = 'meal_ticket_import_rows'
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(32), unique=True, nullable=False, default=new_key)
    import_key = db.Column(db.String(32), db.ForeignKey('meal_ticket_imports.key'), nullable=False)
    month = db.Column(db.String(7), nullable=False, index=True)
    emp_id = db.Column(db.Integer, db.ForeignKey('employees.id'))
    data = db.Column(db.JSON, nullable=False)


MEAL_MODELS = (MealTicketBatch, MealTicketItem, MealTicketAdjustment, MealTicketPayment,
               MealTicketImport, MealTicketImportRow)
