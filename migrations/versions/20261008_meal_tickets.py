"""Meal subsidy snapshots, adjustments, payments and historical ledgers."""
from alembic import op
from models.meal_ticket import MEAL_MODELS

revision = '20261008_meals'
down_revision = 'f7a8b9c0d1e2'
branch_labels = None
depends_on = None


def upgrade():
    for model in MEAL_MODELS:
        model.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    for model in reversed(MEAL_MODELS):
        model.__table__.drop(bind=op.get_bind(), checkfirst=True)
