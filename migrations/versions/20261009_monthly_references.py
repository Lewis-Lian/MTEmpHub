"""Add missing-only monthly references and independent current active state."""
from alembic import op
import sqlalchemy as sa

revision = '20261009_month_refs'
down_revision = '20261009_meal_rules'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    for table in ('employees', 'departments', 'shifts'):
        if 'is_active' not in {column['name'] for column in inspector.get_columns(table)}:
            op.add_column(table, sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()))
    if not inspector.has_table('monthly_reference_snapshots'):
        op.create_table(
            'monthly_reference_snapshots',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('month', sa.String(7), nullable=False),
            sa.Column('kind', sa.String(20), nullable=False),
            sa.Column('business_key', sa.String(100), nullable=False),
            sa.Column('payload', sa.JSON(), nullable=False),
            sa.Column('provenance', sa.JSON(), nullable=False),
            sa.Column('quality', sa.String(20), nullable=False),
            sa.Column('schema_version', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('month', 'kind', 'business_key', name='uq_month_reference'),
        )


def downgrade():
    op.drop_table('monthly_reference_snapshots')
    for table in ('employees', 'departments', 'shifts'):
        with op.batch_alter_table(table) as batch:
            batch.drop_column('is_active')
