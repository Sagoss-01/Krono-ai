"""
database.py
-----------
Configure la connexion asynchrone à PostgreSQL avec support SSL Neon.
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

from backend.config import settings

# Configuration des arguments de connexion (SSL pour Neon, check_same_thread pour SQLite)
if "sqlite" in settings.database_url:
    connect_args = {"check_same_thread": False}
elif "neon.tech" in settings.database_url:
    connect_args = {"ssl": "require"}
else:
    connect_args = {}

engine = create_async_engine(settings.database_url, connect_args=connect_args, echo=False, future=True)

AsyncSessionLocal = async_sessionmaker(
    bind=engine, class_=AsyncSession, expire_on_commit=False
)

Base = declarative_base()


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
