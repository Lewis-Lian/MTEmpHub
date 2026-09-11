"""add DingTalk attendance sync runs

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-09-10 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "dingtalk_sync_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_set_id", sa.Integer(), nullable=False),
        sa.Column("month", sa.String(length=7), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="dingtalk"),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("read_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("imported_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unmatched_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unmatched", sa.JSON(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["account_set_id"], ["account_sets.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_dingtalk_sync_runs_account_set_id", "dingtalk_sync_runs", ["account_set_id"])
    op.create_index("ix_dingtalk_sync_runs_month", "dingtalk_sync_runs", ["month"])


def downgrade():
    op.drop_index("ix_dingtalk_sync_runs_month", table_name="dingtalk_sync_runs")
    op.drop_index("ix_dingtalk_sync_runs_account_set_id", table_name="dingtalk_sync_runs")
    op.drop_table("dingtalk_sync_runs")
