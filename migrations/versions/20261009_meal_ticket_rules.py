"""Add per-employee manager meal ticket calculation option."""
from alembic import op
import sqlalchemy as sa

revision = '20261009_meal_rules'
down_revision = '20261008_ledgers'
branch_labels = None
depends_on = None


def upgrade():
    columns = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('employees')}
    if 'meal_ticket_as_manager' not in columns:
        op.add_column('employees', sa.Column('meal_ticket_as_manager', sa.Boolean(),
            nullable=False, server_default=sa.false()))


def downgrade():
    with op.batch_alter_table('employees') as batch:
        batch.drop_column('meal_ticket_as_manager')
