"""
reminder_worker.py
------------------
Worker d'arrière-plan : envoie les messages programmés arrivés à échéance.

Canaux :
- "gmail"    : envoi depuis le compte Google de l'utilisateur (liaison CalendarLink) ;
- "email"    : envoi générique (service e-mail configuré) ;
- "whatsapp" : WhatsApp Business.

Les dates programmées sont en heure locale (comme les événements) : elles sont comparées
à l'heure locale du serveur. Un échec marque le message "failed" sans bloquer les autres.
"""
import asyncio
import logging
from datetime import datetime

from sqlalchemy import select

from backend.database import AsyncSessionLocal
from backend.models.db_models import CalendarLink, ScheduledMessage
from backend.messaging.email_service import send_email
from backend.messaging.whatsapp_service import send_whatsapp_message
from backend.google_workspace import google_api

logger = logging.getLogger("krono.worker")


async def _send_gmail(db, msg: ScheduledMessage) -> None:
    link = await db.get(CalendarLink, msg.link_id) if msg.link_id else None
    if link is None or link.provider != "google":
        raise RuntimeError("compte Google introuvable pour cet envoi")
    access = await google_api.valid_access_token(db, link)
    to = [a.strip() for a in msg.recipient.split(",") if a.strip()]
    cc = [a.strip() for a in (msg.cc or "").split(",") if a.strip()]
    mime = google_api.build_mime(sender=link.account_email, to=to, cc=cc, subject=msg.subject or "", body=msg.body)
    await google_api.gmail_send(access, mime)


async def process_scheduled_messages():
    """Traite un lot de messages planifiés arrivés à échéance."""
    async with AsyncSessionLocal() as db:
        try:
            now = datetime.now()
            stmt = (
                select(ScheduledMessage)
                .where(ScheduledMessage.status == "pending", ScheduledMessage.scheduled_at <= now)
                .limit(20)
            )
            messages = (await db.execute(stmt)).scalars().all()
            for msg in messages:
                try:
                    if msg.channel == "gmail":
                        await _send_gmail(db, msg)
                    elif msg.channel == "email":
                        await send_email(to_email=msg.recipient, subject=msg.subject or "Notification Krono AI",
                                         body_text=msg.body)
                    elif msg.channel == "whatsapp":
                        await send_whatsapp_message(to_phone=msg.recipient, body_text=msg.body)
                    msg.status = "sent"
                    logger.info(f"[Worker] Message planifié #{msg.id} envoyé à {msg.recipient}")
                except Exception as ex:
                    logger.error(f"[Worker] Échec envoi message #{msg.id}: {type(ex).__name__}")
                    msg.status = "failed"
            if messages:
                await db.commit()
        except Exception as e:
            logger.error(f"[Worker] Erreur cycle messages planifiés: {type(e).__name__}")


async def start_scheduled_message_worker(interval_seconds: int = 30):
    """Boucle infinie exécutée en tâche de fond dans FastAPI."""
    logger.info("[Worker] Démarrage du worker de messages et rappels d'arrière-plan...")
    try:
        while True:
            await process_scheduled_messages()
            await asyncio.sleep(interval_seconds)
    except asyncio.CancelledError:
        logger.info("[Worker] Arrêt gracieux du worker de messages.")
