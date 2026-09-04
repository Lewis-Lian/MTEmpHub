"""add employees.card_no

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-09-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e5f6a7b8c9d0'
down_revision = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.add_column(sa.Column('card_no', sa.String(length=50), nullable=True))
        batch_op.create_unique_constraint('uq_employees_card_no', ['card_no'])


def downgrade():
    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.drop_constraint('uq_employees_card_no', type_='unique')
        batch_op.drop_column('card_no')
