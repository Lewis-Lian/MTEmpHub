"""Independent account active state, local token revocation and durable audit identity."""
from alembic import op
import sqlalchemy as sa

revision = '20261009_account_state'
down_revision = '20261009_month_refs'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    user_columns = {column['name'] for column in inspector.get_columns('users')}
    if 'is_active' not in user_columns:
        op.add_column('users', sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()))
    if 'auth_version' not in user_columns:
        op.add_column('users', sa.Column('auth_version', sa.Integer(), nullable=False, server_default='0'))
    audit_columns = {column['name'] for column in inspector.get_columns('account_set_backup_restores')}
    if 'operator_username' not in audit_columns:
        op.add_column('account_set_backup_restores', sa.Column('operator_username', sa.String(80), nullable=True))
    if 'task_id' not in audit_columns:
        op.add_column('account_set_backup_restores', sa.Column('task_id', sa.String(64), nullable=True))
    if 'ix_account_set_backup_restores_task_id' not in {
        index['name'] for index in inspector.get_indexes('account_set_backup_restores')
    }:
        op.create_index('ix_account_set_backup_restores_task_id', 'account_set_backup_restores', ['task_id'])
    op.execute(sa.text('''UPDATE account_set_backup_restores
        SET operator_username = (SELECT username FROM users WHERE users.id = account_set_backup_restores.operator_id)
        WHERE operator_username IS NULL'''))


def downgrade():
    op.drop_index('ix_account_set_backup_restores_task_id', table_name='account_set_backup_restores')
    with op.batch_alter_table('account_set_backup_restores') as batch:
        batch.drop_column('task_id')
        batch.drop_column('operator_username')
    with op.batch_alter_table('users') as batch:
        batch.drop_column('auth_version')
        batch.drop_column('is_active')
