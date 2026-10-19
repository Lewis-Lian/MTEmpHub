"""Reusable guest accounts and immutable evidence of their actual recharges."""
from datetime import datetime
from models import db
from models.meal_ticket import new_key


class MealGuestCard(db.Model):
    __tablename__ = 'meal_guest_cards'
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(32), unique=True, nullable=False, default=new_key)
    card_no = db.Column(db.String(50), unique=True, nullable=False)
    emp_no = db.Column(db.String(50), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    operator = db.Column(db.String(80), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class MealGuestRecharge(db.Model):
    __tablename__ = 'meal_guest_recharges'
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(32), unique=True, nullable=False, default=new_key)
    month = db.Column(db.String(7), nullable=False, index=True)
    record_key = db.Column(db.String(32), db.ForeignKey('meal_ledger_records.key'), nullable=False)
    source_key = db.Column(db.String(150), unique=True, nullable=False)
    source_digest = db.Column(db.String(64), nullable=False)
    amount_cents = db.Column(db.Integer, nullable=False)
    occurred_at = db.Column(db.DateTime, nullable=False)
    operator = db.Column(db.String(80), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
