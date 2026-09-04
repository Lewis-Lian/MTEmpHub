"""add leave_records.is_revoked / is_manual_edited

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-09-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('leave_records', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_revoked', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('is_manual_edited', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index('ix_leave_records_is_revoked', 'leave_records', ['is_revoked'])


def downgrade():
    op.drop_index('ix_leave_records_is_revoked', table_name='leave_records')
    with op.batch_alter_table('leave_records', schema=None) as batch_op:
        batch_op.drop_column('is_manual_edited')
        batch_op.drop_column('is_revoked')
