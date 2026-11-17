"""
verify_setup.py
-----------------
À exécuter EN LOCAL (pas dans le sandbox Claude) une fois ton .env rempli.
Teste séparément Gemini et PostgreSQL pour savoir précisément lequel des
deux pose problème en cas d'erreur.

Usage :
    cd krono-ai
    pip install -r requirements.txt
    python3 verify_setup.py
"""

import asyncio
import os
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

from dotenv import load_dotenv

load_dotenv()


def check_env_vars():
    print("=== 1. Vérification des variables d'environnement ===")
    required = ["DATABASE_URL", "JWT_SECRET_KEY", "GEMINI_API_KEY"]
    missing = [v for v in required if not os.getenv(v)]
    if missing:
        print(f"❌ Variables manquantes dans .env : {', '.join(missing)}")
        sys.exit(1)
    print("✅ Toutes les variables requises sont présentes.\n")


def check_gemini():
    print("=== 2. Test de connexion à Gemini ===")
    try:
        from google import genai
        import time

        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model=os.getenv("GEMINI_MODEL", "gemini-3.8-flash"),
                    contents="Réponds juste par le mot: OK",
                )
                print(f"✅ Gemini a répondu : {response.text.strip()}\n")
                return True
            except Exception as e:
                if "503" in str(e) and attempt < 2:
                    time.sleep(1.5)
                    continue
                raise
    except Exception as e:
        print(f"❌ Échec de l'appel Gemini : {e}\n")
        print("   Vérifie que GEMINI_API_KEY est correcte et active sur")
        print("   https://aistudio.google.com/apikey\n")
        return False


async def check_postgres():
    print("=== 3. Test de connexion à PostgreSQL ===")
    try:
        from sqlalchemy.ext.asyncio import create_async_engine
        from sqlalchemy import text

        db_url = os.getenv("DATABASE_URL")

        # NOTE : Neon exige SSL. Avec asyncpg, on le passe via connect_args,
        # pas via "?sslmode=require" dans l'URL (syntaxe psycopg2, incompatible ici).
        connect_args = {"ssl": "require"} if "neon.tech" in db_url else {}

        engine = create_async_engine(db_url, connect_args=connect_args)
        async with engine.connect() as conn:
            query = "SELECT sqlite_version();" if "sqlite" in db_url else "SELECT version();"
            result = await conn.execute(text(query))
            version = result.scalar()
            db_type = "SQLite" if "sqlite" in db_url else "PostgreSQL"
            print(f"[OK] Connexion {db_type} reussie.")
            print(f"   Version : {version}\n")
        await engine.dispose()
        return True
    except Exception as e:
        print(f"❌ Échec de connexion PostgreSQL : {e}\n")
        print("   Vérifie que DATABASE_URL est correcte, commence bien par")
        print("   'postgresql+asyncpg://' et que le mot de passe est exact.\n")
        return False


async def main():
    check_env_vars()
    gemini_ok = check_gemini()
    postgres_ok = await check_postgres()

    print("=== Résumé ===")
    print(f"Gemini      : {'[OK]' if gemini_ok else '[A CORRIGER]'}")
    print(f"PostgreSQL  : {'[OK]' if postgres_ok else '[A CORRIGER]'}")

    if gemini_ok and postgres_ok:
        print("\n[OK] Tout est branche ! Tu peux lancer : uvicorn app.main:app --reload")
    else:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
