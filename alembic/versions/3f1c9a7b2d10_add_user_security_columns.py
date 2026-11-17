"""add user security columns

Le modèle ORM `User` déclare des colonnes (rôle admin, suspension, 2FA,
récupération de compte) qui n'existaient pas encore en base. SQLAlchemy
sélectionne toutes les colonnes du modèle : sans elles, login et inscription
échouent avec une erreur "colonne inexistante".

Les colonnes booléennes reçoivent une valeur par défaut côté serveur (false),
ce qui permet d'ajouter NOT NULL sans toucher aux lignes existantes.

Revision ID: 3f1c9a7b2d10
Revises: a49457a1ce8a
Create Date: 2026-11-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3f1c9a7b2d10'
down_revision: Union[str, Sequence[str], None] = 'a49457a1ce8a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('is_admin', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column('users', sa.Column('is_suspended', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column('users', sa.Column('two_factor_secret', sa.String(length=64), nullable=True))
    op.add_column('users', sa.Column('two_factor_enabled', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column('users', sa.Column('recovery_email', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('recovery_code', sa.String(length=32), nullable=True))
    op.add_column('users', sa.Column('recovery_expires', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'recovery_expires')
    op.drop_column('users', 'recovery_code')
    op.drop_column('users', 'recovery_email')
    op.drop_column('users', 'two_factor_enabled')
    op.drop_column('users', 'two_factor_secret')
    op.drop_column('users', 'is_suspended')
    op.drop_column('users', 'is_admin')
