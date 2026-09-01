"""add daily_attendance_overrides.is_actual_attendance

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-09-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd4e5f6a7b8c9'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('daily_attendance_overrides', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_actual_attendance', sa.Boolean(), nullable=True))


def downgrade():
    with op.batch_alter_table('daily_attendance_overrides', schema=None) as batch_op:
        batch_op.drop_column('is_actual_attendance')
