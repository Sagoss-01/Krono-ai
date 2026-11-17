"""google workspace: compte Google, scopes, envois Gmail programmés

Revision ID: 9c4e7b1d2a3f
Revises: 7a1c3e9d5b20
Create Date: 2026-11-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9c4e7b1d2a3f'
down_revision: Union[str, Sequence[str], None] = '7a1c3e9d5b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('calendar_links', sa.Column('account_email', sa.String(length=255), nullable=True))
    op.add_column('calendar_links', sa.Column('scopes', sa.Text(), nullable=True))
    op.add_column('scheduled_messages', sa.Column('cc', sa.Text(), nullable=True))
    op.add_column('scheduled_messages', sa.Column('link_id', sa.Uuid(), nullable=True))


def downgrade() -> None:
    op.drop_column('scheduled_messages', 'link_id')
    op.drop_column('scheduled_messages', 'cc')
    op.drop_column('calendar_links', 'scopes')
    op.drop_column('calendar_links', 'account_email')
