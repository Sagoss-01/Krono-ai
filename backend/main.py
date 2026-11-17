"""
main.py
-------
Point d'entrée de l'application FastAPI.
"""

import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.database import Base, engine
from backend.auth.routes import router as auth_router
from backend.agent.routes import router as agent_router
from backend.ai.routes import router as ai_router
from backend.scheduler.routes import router as scheduler_router
from backend.calendar_sync.routes import router as calendar_router
from backend.notifications.routes import router as notifications_router
from backend.geo.routes import router as geo_router
from backend.contacts.routes import router as contacts_router
from backend.messaging.routes import router as messaging_router
from backend.messaging.inbox_routes import router as inbox_router
from backend.schedule_import.routes import router as schedule_import_router
from backend.briefing.routes import router as briefing_router
from backend.auth.security_routes import router as security_router
from backend.admin.routes import router as admin_router
from backend.mailbox.routes import router as mailbox_router
from backend.assistant.routes import router as assistant_router
from backend.google_workspace.routes import router as google_router
from backend.workers.reminder_worker import start_scheduled_message_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Création / mise à jour automatique des tables pour les nouveaux modules
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Lancement du worker d'arrière-plan (rappels, emails programmés)
    worker_task = asyncio.create_task(start_scheduled_message_worker(interval_seconds=30))
    yield
    # Nettoyage des connexions et arrêt du worker à l'arrêt
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass
    await engine.dispose()


app = FastAPI(
    title="Krono AI API",
    description="Backend de planning intelligent et agent conversationnel avec FastAPI et Langgraph.",
    version="1.0.0",
    lifespan=lifespan,
)

# Configuration CORS pour autoriser le frontend React
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # À restreindre en production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inclusion des routeurs
app.include_router(auth_router)
app.include_router(agent_router)
app.include_router(ai_router)
app.include_router(scheduler_router)
app.include_router(calendar_router)
app.include_router(notifications_router)
app.include_router(geo_router)
app.include_router(contacts_router)
app.include_router(messaging_router)
app.include_router(inbox_router)
app.include_router(schedule_import_router)
app.include_router(briefing_router)
app.include_router(security_router)
app.include_router(admin_router)
app.include_router(mailbox_router)
app.include_router(assistant_router)
app.include_router(google_router)



@app.get("/")
def read_root():
    return {
        "status": "online",
        "message": "Bienvenue sur l'API de Krono AI. Accédez à /docs pour explorer la documentation interactive."
    }
