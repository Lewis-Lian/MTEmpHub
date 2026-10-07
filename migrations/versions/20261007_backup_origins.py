"""Persistent portable backup identities and restore audit.

Revision ID: 20261007_backup
Revises: e6f7a8b9c0d1
"""
from alembic import op
import sqlalchemy as sa

revision = '20261007_backup'
down_revision = 'e6f7a8b9c0d1'
branch_labels = None
depends_on = None


def upgrade():
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if 'account_set_backup_origins' not in tables:
        op.create_table('account_set_backup_origins',
                        sa.Column('id', sa.Integer(), primary_key=True),
                        sa.Column('dataset', sa.String(40), nullable=False),
                        sa.Column('origin_key', sa.String(64), nullable=False),
                        sa.Column('local_id', sa.Integer(), nullable=False),
                        sa.Column('provenance', sa.JSON(), nullable=False),
                        sa.UniqueConstraint('dataset', 'origin_key', name='uq_backup_origin'))
    if 'account_set_backup_restores' not in tables:
        op.create_table('account_set_backup_restores',
                        sa.Column('id', sa.Integer(), primary_key=True),
                        sa.Column('month', sa.String(7), nullable=False),
                        sa.Column('operator_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
                        sa.Column('backup_digest', sa.String(64), nullable=False),
                        sa.Column('counts', sa.JSON(), nullable=False),
                        sa.Column('created_at', sa.DateTime(), nullable=False))


def downgrade():
    op.drop_table('account_set_backup_restores')
    op.drop_table('account_set_backup_origins')
