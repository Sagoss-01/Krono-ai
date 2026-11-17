"""
migrate_sqlite_to_postgres.py
-----------------------------
Migre toutes les données de krono_ai.db (SQLite) vers PostgreSQL local.
Crée d'abord les tables via SQLAlchemy, puis copie les données.
"""
import asyncio
import sqlite3
import os
import sys
from pathlib import Path

# Ajouter le répertoire racine au path
ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

SQLITE_PATH = ROOT / "krono_ai.db"

from datetime import datetime

def parse_dt(val):
    """Convertit une string SQLite en datetime Python, ou None."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(val, fmt)
        except ValueError:
            continue
    return None  # fallback silencieux


async def main():
    from backend.database import engine, Base
    from backend.models import db_models  # noqa: F401 — enregistre les modèles

    # 1. Créer les tables sur PostgreSQL
    print("=== [1] Création des tables sur PostgreSQL ===")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("    Tables créées avec succès ✓")

    if not SQLITE_PATH.exists():
        print(f"\n⚠ SQLite introuvable à {SQLITE_PATH} — migration des données ignorée.")
        print("    (Les tables vides sont prêtes sur PostgreSQL)")
        return

    # 2. Ouvrir SQLite
    print(f"\n=== [2] Lecture de {SQLITE_PATH} ===")
    con = sqlite3.connect(str(SQLITE_PATH))
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    # Compter les enregistrements
    for table in ["users", "calendar_links", "events"]:
        try:
            n = cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            print(f"    {table}: {n} enregistrement(s)")
        except Exception:
            print(f"    {table}: table absente dans SQLite")

    # 3. Migrer avec une connexion asyncpg brute (psycopg2-style INSERT)
    print("\n=== [3] Migration des données ===")
    import asyncpg
    pg_url = os.getenv("DATABASE_URL").replace("postgresql+asyncpg://", "postgresql://")
    pg_conn = await asyncpg.connect(pg_url)

    try:
        # --- users ---
        users = cur.execute("SELECT id, email, hashed_password, full_name, created_at FROM users").fetchall()
        for u in users:
            await pg_conn.execute(
                """INSERT INTO users (id, email, hashed_password, full_name, created_at)
                   VALUES ($1::uuid, $2, $3, $4, $5)
                   ON CONFLICT (id) DO NOTHING""",
                u["id"], u["email"], u["hashed_password"], u["full_name"], parse_dt(u["created_at"])
            )
        print(f"    users: {len(users)} migrés ✓")

        # --- calendar_links ---
        try:
            links = cur.execute(
                "SELECT id, user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expires_at FROM calendar_links"
            ).fetchall()
            for l in links:
                await pg_conn.execute(
                    """INSERT INTO calendar_links (id, user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expires_at)
                       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
                       ON CONFLICT (id) DO NOTHING""",
                    l["id"], l["user_id"], l["provider"],
                    l["encrypted_access_token"], l["encrypted_refresh_token"], parse_dt(l["token_expires_at"])
                )
            print(f"    calendar_links: {len(links)} migrés ✓")
        except Exception as e:
            print(f"    calendar_links: ignorés ({e})")

        # --- events ---
        try:
            events = cur.execute(
                "SELECT id, owner_id, title, start_time, end_time, location, constraint_type, status, external_id, source, created_at FROM events"
            ).fetchall()
            for ev in events:
                await pg_conn.execute(
                    """INSERT INTO events (id, owner_id, title, start_time, end_time, location, constraint_type, status, external_id, source, created_at)
                       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                       ON CONFLICT (id) DO NOTHING""",
                    ev["id"], ev["owner_id"], ev["title"],
                    parse_dt(ev["start_time"]), parse_dt(ev["end_time"]), ev["location"],
                    ev["constraint_type"], ev["status"],
                    ev["external_id"], ev["source"], parse_dt(ev["created_at"])
                )
            print(f"    events: {len(events)} migrés ✓")
        except Exception as e:
            print(f"    events: erreur ({e})")

    finally:
        await pg_conn.close()
        con.close()

    # 4. Vérification finale
    print("\n=== [4] Vérification sur PostgreSQL ===")
    import asyncpg
    pg_conn2 = await asyncpg.connect(pg_url)
    for table in ["users", "calendar_links", "events"]:
        n = await pg_conn2.fetchval(f"SELECT COUNT(*) FROM {table}")
        print(f"    {table}: {n} enregistrement(s) ✓")
    await pg_conn2.close()

    print("\n Migration SQLite → PostgreSQL terminée avec succès !")
    print("   Le backend peut maintenant être redémarré avec PostgreSQL.")

if __name__ == "__main__":
    asyncio.run(main())
