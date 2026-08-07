"""add actual_attendance_days to employee_attendance_overrides

Revision ID: a1b2c3d4e5f6
Revises: 681e8410935f
Create Date: 2026-08-07 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = '681e8410935f'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('employee_attendance_overrides', schema=None) as batch_op:
        batch_op.add_column(sa.Column('actual_attendance_days', sa.Float(), nullable=True))


def downgrade():
    with op.batch_alter_table('employee_attendance_overrides', schema=None) as batch_op:
        batch_op.drop_column('actual_attendance_days')
