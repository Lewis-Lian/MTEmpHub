"""Separate computed manager month values from manual corrections.

Revision ID: 20261007_stat_sources
Revises: 20261007_backup
"""
from alembic import op
import sqlalchemy as sa

revision = '20261007_stat_sources'
down_revision = '20261007_backup'
branch_labels = None
depends_on = None


def upgrade():
    columns = {column['name'] for column in sa.inspect(op.get_bind()).get_columns('manager_month_stats')}
    for name in ('automatic_values', 'manual_values'):
        if name not in columns:
            op.add_column('manager_month_stats', sa.Column(name, sa.JSON(), nullable=True))
    # Existing numeric values remain untouched; null source metadata means legacy manual values.


def downgrade():
    with op.batch_alter_table('manager_month_stats') as batch:
        batch.drop_column('manual_values')
        batch.drop_column('automatic_values')
