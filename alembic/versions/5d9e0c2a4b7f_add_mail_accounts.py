"""add mail accounts

Table des adresses e-mail liées par identifiants IMAP/SMTP (module mailbox).
Le mot de passe est stocké chiffré (Fernet), jamais en clair.

Revision ID: 5d9e0c2a4b7f
Revises: 8b2d4e6f1a9c
Create Date: 2026-11-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5d9e0c2a4b7f'
down_revision: Union[str, Sequence[str], None] = '8b2d4e6f1a9c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'mail_accounts',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('address', sa.String(length=254), nullable=False),
        sa.Column('provider', sa.String(length=20), nullable=False),
        sa.Column('imap_host', sa.String(length=255), nullable=False),
        sa.Column('imap_port', sa.Integer(), nullable=False),
        sa.Column('smtp_host', sa.String(length=255), nullable=False),
        sa.Column('smtp_port', sa.Integer(), nullable=False),
        sa.Column('encrypted_password', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'address', name='uq_mail_accounts_user_address'),
    )
    op.create_index(op.f('ix_mail_accounts_user_id'), 'mail_accounts', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_mail_accounts_user_id'), table_name='mail_accounts')
    op.drop_table('mail_accounts')
