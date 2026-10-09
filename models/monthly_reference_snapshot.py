"""Month-owned reference data, independent of mutable current ORM rows."""
from datetime import datetime

from . import db


class MonthlyReferenceSnapshot(db.Model):
    __tablename__ = 'monthly_reference_snapshots'

    id = db.Column(db.Integer, primary_key=True)
    month = db.Column(db.String(7), nullable=False)
    kind = db.Column(db.String(20), nullable=False)
    business_key = db.Column(db.String(100), nullable=False)
    payload = db.Column(db.JSON, nullable=False)
    provenance = db.Column(db.JSON, nullable=False)
    quality = db.Column(db.String(20), nullable=False)
    schema_version = db.Column(db.Integer, nullable=False, default=1)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('month', 'kind', 'business_key', name='uq_month_reference'),
    )
