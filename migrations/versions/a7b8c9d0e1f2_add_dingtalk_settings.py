"""add system settings and employee DingTalk mapping

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-09-10 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "a7b8c9d0e1f2"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "system_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", sa.Text(), nullable=True),
    )
    op.create_index("ix_system_settings_key", "system_settings", ["key"], unique=True)
    with op.batch_alter_table("employees", schema=None) as batch_op:
        batch_op.add_column(sa.Column("dingtalk_user_id", sa.String(length=100), nullable=True))
        batch_op.create_index("ix_employees_dingtalk_user_id", ["dingtalk_user_id"])


def downgrade():
    with op.batch_alter_table("employees", schema=None) as batch_op:
        batch_op.drop_index("ix_employees_dingtalk_user_id")
        batch_op.drop_column("dingtalk_user_id")
    op.drop_index("ix_system_settings_key", table_name="system_settings")
    op.drop_table("system_settings")
