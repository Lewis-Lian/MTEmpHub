"""Independent meal ledgers and import previews."""
from alembic import op
import sqlalchemy as sa
from models.meal_ledger import LEDGER_MODELS

revision = '20261008_ledgers'
down_revision = '20261008_meals'
branch_labels = None
depends_on = None


def upgrade():
    for model in LEDGER_MODELS:
        model.__table__.create(bind=op.get_bind(), checkfirst=True)
    columns = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('meal_ticket_batches')}
    if 'reconciliation' not in columns:
        op.add_column('meal_ticket_batches', sa.Column('reconciliation', sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table('meal_ticket_batches') as batch:
        batch.drop_column('reconciliation')
    for model in reversed(LEDGER_MODELS):
        model.__table__.drop(bind=op.get_bind(), checkfirst=True)
