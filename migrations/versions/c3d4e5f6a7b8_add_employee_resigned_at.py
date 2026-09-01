"""add employees.resigned_at

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c3d4e5f6a7b8'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.add_column(sa.Column('resigned_at', sa.Date(), nullable=True))
    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.create_index('ix_employees_resigned_at', ['resigned_at'])


def downgrade():
    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.drop_index('ix_employees_resigned_at')
    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.drop_column('resigned_at')
