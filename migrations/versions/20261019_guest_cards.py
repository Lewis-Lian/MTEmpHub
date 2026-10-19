"""Guest card registry and actual recharge matching evidence."""
from alembic import op
from models.meal_guest_card import MealGuestCard, MealGuestRecharge

revision = '20261019_guest_cards'
down_revision = '20261009_account_state'
branch_labels = None
depends_on = None


def upgrade():
    for model in (MealGuestCard, MealGuestRecharge):
        model.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    for model in (MealGuestRecharge, MealGuestCard):
        model.__table__.drop(bind=op.get_bind(), checkfirst=True)
