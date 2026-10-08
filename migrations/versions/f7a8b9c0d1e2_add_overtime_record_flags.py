"""Add overtime revocation and manual edit flags."""
from alembic import op
import sqlalchemy as sa

revision = 'f7a8b9c0d1e2'
down_revision = '20261007_stat_cutoff'
branch_labels = None
depends_on = None


def upgrade():
    existing_columns = {column['name'] for column in sa.inspect(op.get_bind()).get_columns('overtime_records')}
    with op.batch_alter_table('overtime_records') as batch:
        for name in ('is_revoked', 'is_manual_edited'):
            if name not in existing_columns:
                batch.add_column(sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    with op.batch_alter_table('overtime_records') as batch:
        batch.drop_column('is_manual_edited')
        batch.drop_column('is_revoked')
