"""add contact is_favorite

Le modèle ORM `Contact` déclare la colonne `is_favorite`, absente de la base.
Sans elle, toute requête sur les contacts échoue (erreur 500), et le navigateur
affiche alors une erreur CORS trompeuse, car la réponse d'erreur n'a pas les
en-têtes CORS.

Revision ID: 8b2d4e6f1a9c
Revises: 3f1c9a7b2d10
Create Date: 2026-11-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8b2d4e6f1a9c'
down_revision: Union[str, Sequence[str], None] = '3f1c9a7b2d10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('contacts', sa.Column('is_favorite', sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    op.drop_column('contacts', 'is_favorite')
