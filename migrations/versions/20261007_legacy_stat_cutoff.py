"""Keep 2026 legacy corrections through August and resume automatic values from September.

Revision ID: 20261007_stat_cutoff
Revises: 20261007_stat_sources
"""
from alembic import op
from services.manager_stat_legacy_upgrade import migrate_legacy_manager_stats

revision = '20261007_stat_cutoff'
down_revision = '20261007_stat_sources'
branch_labels = None
depends_on = None


def upgrade():
    migrate_legacy_manager_stats(op.get_bind())


def downgrade():
    # Keep source information: removing it would erase subsequent explicit corrections.
    pass
