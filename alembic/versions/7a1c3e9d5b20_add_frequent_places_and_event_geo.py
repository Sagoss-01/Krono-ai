"""add frequent places and event coordinates

Lieux fréquentés de l'utilisateur (carte) et coordonnées mémorisées sur les
événements, pour calculer l'itinéraire de la journée sans géocoder deux fois.

Revision ID: 7a1c3e9d5b20
Revises: 5d9e0c2a4b7f
Create Date: 2026-11-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7a1c3e9d5b20'
down_revision: Union[str, Sequence[str], None] = '5d9e0c2a4b7f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('events', sa.Column('latitude', sa.Float(), nullable=True))
    op.add_column('events', sa.Column('longitude', sa.Float(), nullable=True))
    op.add_column('events', sa.Column('geo_source', sa.String(length=255), nullable=True))
    op.create_table(
        'frequent_places',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('label', sa.String(length=80), nullable=False),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('latitude', sa.Float(), nullable=False),
        sa.Column('longitude', sa.Float(), nullable=False),
        sa.Column('address', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'label', name='uq_frequent_places_user_label'),
    )
    op.create_index(op.f('ix_frequent_places_user_id'), 'frequent_places', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_frequent_places_user_id'), table_name='frequent_places')
    op.drop_table('frequent_places')
    op.drop_column('events', 'geo_source')
    op.drop_column('events', 'longitude')
    op.drop_column('events', 'latitude')
