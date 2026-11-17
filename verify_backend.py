"""
verify_backend.py
------------------
Vérifie le bon fonctionnement du nouveau backend (FastAPI + Langgraph).
"""

import asyncio
import os
import sys

from dotenv import load_dotenv

# Charge les variables locales
load_dotenv()


def check_env_vars():
    print("=== 1. Vérification des variables d'environnement ===")
    required = ["DATABASE_URL", "JWT_SECRET_KEY"]
    
    missing = [v for v in required if not os.getenv(v)]
    if missing:
        print(f"[ERREUR] Variables manquantes dans .env : {', '.join(missing)}")
        print("Veuillez renseigner ces variables dans le fichier .env puis relancer.")
        sys.exit(1)

    if not os.getenv("OPENROUTER_API_KEY") and not os.getenv("GEMINI_API_KEY"):
        print("[AVERTISSEMENT] Ni OPENROUTER_API_KEY ni GEMINI_API_KEY ne sont configurées.")
    else:
        print("[OK] Variables d'environnement critiques présentes.")
    print("")


def check_imports():
    print("=== 2. Vérification des imports du nouveau backend ===")
    try:
        from backend.config import settings
        from backend.database import Base, engine, get_db
        from backend.models.db_models import User, Event, CalendarLink
        from backend.models.schemas import UserCreate, EventOut
        from backend.auth.security import hash_password, create_access_token
        from backend.ai.nlp_service import clean_transcription
        from backend.ai.gemini_client import parse_natural_language_task, _openrouter_client
        from backend.scheduler.conflict_engine import detect_conflicts
        from backend.calendar_sync.deduplication import deduplicate
        from backend.notifications.push_service import send_push_notification
        from backend.agent.graph import agent_graph
        print("[OK] Tous les modules du dossier 'backend' s'importent avec succès !\n")
        return True
    except Exception as e:
        print(f"[ERREUR] Échec lors de l'import des modules : {e}\n")
        return False


def check_openrouter():
    print("=== 3. Test de connexion à OpenRouter ===")
    from openai import OpenAI
    api_key = os.getenv("OPENROUTER_API_KEY")
    base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    model = os.getenv("OPENROUTER_MODEL", "openrouter/free")
    if not api_key:
        print("[SKIP] Clé OPENROUTER_API_KEY non configurée dans .env, test sauté.\n")
        return False
    try:
        client = OpenAI(base_url=base_url, api_key=api_key)
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "Réponds uniquement par le mot: OK"}],
        )
        print(f"[OK] Connexion OpenRouter fonctionnelle. Modèle : {model}, Réponse : {response.choices[0].message.content.strip()}\n")
        return True
    except Exception as e:
        print(f"[ERREUR] Échec de l'appel OpenRouter : {e}\n")
        return False


def check_gemini():
    print("=== 3 bis. Test de connexion à Gemini ===")
    try:
        from google import genai
        
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            print("[SKIP] Clé API Gemini non configurée dans .env, test sauté.\n")
            return False

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=os.getenv("GEMINI_MODEL", "gemini-3.8-flash"),
            contents="Réponds uniquement par le mot: OK",
        )
        print(f"[OK] Connexion Gemini fonctionnelle. Réponse : {response.text.strip()}\n")
        return True
    except Exception as e:
        print(f"[SKIP] Échec de l'appel Gemini ({e}), OpenRouter servira de moteur principal.\n")
        return False



async def check_postgres():
    print("=== 4. Test de connexion à PostgreSQL ===")
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("[SKIP] URL de base de données non spécifiée, test sauté.\n")
        return False

    try:
        from sqlalchemy.ext.asyncio import create_async_engine
        from sqlalchemy import text

        # Détection SSL Neon
        connect_args = {"ssl": "require"} if "neon.tech" in db_url else {}

        engine = create_async_engine(db_url, connect_args=connect_args)
        async with engine.connect() as conn:
            query = "SELECT sqlite_version();" if "sqlite" in db_url else "SELECT version();"
            result = await conn.execute(text(query))
            version = result.scalar()
            db_type = "SQLite" if "sqlite" in db_url else "PostgreSQL"
            print(f"[OK] Connexion {db_type} réussie.")
            print(f"   Version du SGBD : {version}\n")
        await engine.dispose()
        return True
    except Exception as e:
        print(f"[ERREUR] Échec de connexion PostgreSQL : {e}\n")
        print("   Vérifiez votre DATABASE_URL dans le fichier .env.\n")
        return False


async def check_langgraph_agent():
    print("=== 5. Test d'exécution de l'agent Langgraph ===")
    try:
        from backend.agent.graph import agent_graph
        from backend.database import AsyncSessionLocal, engine, Base
        from sqlalchemy import select
        from backend.models.db_models import User
        
        # Les tables sont gérées par Alembic
        # async with engine.begin() as conn:
        #     await conn.run_sync(Base.metadata.create_all)
        
        # On vérifie si on a au moins un utilisateur pour tester en base
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User))
            user = result.scalars().first()
            if not user:
                print("[INFO] Aucun utilisateur trouve en base. Creation d'un utilisateur de test...")
                from backend.auth.security import hash_password
                user = User(
                    email="test@krono.ai",
                    hashed_password=hash_password("password123"),
                    full_name="Jean Dupont"
                )
                db.add(user)
                await db.commit()
                await db.refresh(user)
            
            user_id = str(user.id)
            
            inputs = {
                "user_id": user_id,
                "raw_input": "euh ajoute sport demain midi de 12h à 13h genre avec Jean Dupont",
                "cleaned_input": "",
                "token_map": {},
                "intent": None,
                "conflicts": [],
                "resolved_moves": {},
                "response_message": "",
                "status": "success",
            }
            
            config = {
                "configurable": {
                    "db": db,
                    "today_iso": "2026-07-06"
                }
            }
            
            print("[INFO] Invocation de l'agent Langgraph...")
            res = await agent_graph.ainvoke(inputs, config=config)
            print("[OK] L'agent a répondu !")
            print(f"   Message final : {res.get('response_message')}")
            print(f"   Intention extraite : {res.get('intent')}")
            print(f"   Statut : {res.get('status')}\n")
            return True
            
    except Exception as e:
        print(f"[ERREUR] Échec de l'exécution de l'agent Langgraph : {e}\n")
        return False


async def main():
    check_env_vars()
    imports_ok = check_imports()
    if not imports_ok:
        sys.exit(1)
        
    openrouter_ok = check_openrouter()
    gemini_ok = check_gemini()
    postgres_ok = await check_postgres()
    
    agent_ok = False
    if postgres_ok:
        agent_ok = await check_langgraph_agent()

    print("=== Résumé de la vérification ===")
    print(f"Structure & Imports  : {'[OK]' if imports_ok else '[ÉCHEC]'}")
    print(f"Connexion OpenRouter : {'[OK]' if openrouter_ok else '[ÉCHEC ou SAUTÉ]'}")
    print(f"Connexion Gemini     : {'[OK]' if gemini_ok else '[ÉCHEC ou SAUTÉ]'}")
    print(f"Connexion Database   : {'[OK]' if postgres_ok else '[ÉCHEC ou SAUTÉ]'}")
    print(f"Agent Langgraph      : {'[OK]' if agent_ok else '[ÉCHEC ou SAUTÉ]'}")

    if imports_ok:
        print("\n[OK] Le nouveau backend dans '/backend' est pret !")
        print("Vous pouvez le démarrer avec : uvicorn backend.main:app --reload")



if __name__ == "__main__":
    asyncio.run(main())
