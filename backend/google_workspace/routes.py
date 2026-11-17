"""
backend/google_workspace/routes.py
----------------------------------
API Gmail de l'utilisateur, sous /google. Toutes les routes exigent une connexion Google
préalable (liaison CalendarLink de fournisseur "google").

- GET  /google/status                       compte Google lié, Gmail autorisé ou non
- GET  /google/gmail/messages?q=&limit=     recherche (lecture seule)
- GET  /google/gmail/messages/{id}          lecture d'un message (lecture seule)
- POST /google/gmail/send                   envoi immédiat, après confirmation explicite
- POST /google/gmail/schedule               envoi programmé (worker), après confirmation explicite

Aucun envoi n'a lieu sans `confirmed: true`, et les destinataires sont validés côté serveur.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.routes import get_current_user
from backend.database import get_db
from backend.google_workspace import google_api as g
from backend.mailbox.policy import PolicyError, clean_recipients, clean_subject, clean_text, MAX_BODY
from backend.models.db_models import CalendarLink, ScheduledMessage, User

router = APIRouter(prefix="/google", tags=["google"])
GMAIL_SCOPE = "gmail.send"
MAX_SCHEDULE_DAYS = 30
MIN_SCHEDULE_MINUTES = 2


class SendIn(BaseModel):
    to: list[str] = Field(min_length=1, max_length=20)
    cc: list[str] = Field(default_factory=list, max_length=20)
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=20000)
    thread_id: str | None = Field(default=None, max_length=64)
    in_reply_to: str | None = Field(default=None, max_length=255)
    references: str | None = Field(default=None, max_length=1000)
    confirmed: bool = False


class ScheduleIn(SendIn):
    send_at: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")  # heure locale, comme les événements


async def _google_link(db: AsyncSession, user: User) -> CalendarLink:
    row = (await db.execute(select(CalendarLink).where(
        CalendarLink.user_id == user.id, CalendarLink.provider == "google"))).scalars().first()
    if row is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Connectez d'abord votre compte Google.")
    return row


def _gmail_link(link: CalendarLink) -> CalendarLink:
    if not g.has_scope(link, GMAIL_SCOPE):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Gmail n'est pas autorisé pour ce compte : reconnectez Google et acceptez l'accès à Gmail.")
    return link


def _checked(payload: SendIn) -> dict:
    """Validation des champs d'un envoi (mêmes règles pour l'envoi immédiat et programmé)."""
    try:
        to = clean_recipients(payload.to, "Destinataires")
        cc = clean_recipients(payload.cc, "Copie (Cc)")
        if not to:
            raise PolicyError("Au moins un destinataire est obligatoire.")
        return {
            "to": to, "cc": cc,
            "subject": clean_subject(payload.subject),
            "body": clean_text(payload.body, MAX_BODY, "Le message", required=True),
        }
    except PolicyError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


def _gerr(e: g.GoogleError) -> HTTPException:
    return HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))


@router.get("/status")
async def google_status(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    link = (await db.execute(select(CalendarLink).where(
        CalendarLink.user_id == user.id, CalendarLink.provider == "google"))).scalars().first()
    if link is None:
        return {"connected": False, "email": None, "gmail_ready": False}
    return {"connected": True, "email": link.account_email,
            "gmail_ready": g.has_scope(link, GMAIL_SCOPE)}


@router.get("/gmail/messages")
async def search_messages(
    q: str = Query("", max_length=200),
    limit: int = Query(10, ge=1, le=20),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    link = _gmail_link(await _google_link(db, user))
    try:
        access = await g.valid_access_token(db, link)
        return {"messages": await g.gmail_search(access, q.strip() or "in:inbox", limit)}
    except g.GoogleError as e:
        raise _gerr(e)


@router.get("/gmail/messages/{message_id}")
async def read_message(message_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    link = _gmail_link(await _google_link(db, user))
    try:
        access = await g.valid_access_token(db, link)
        return await g.gmail_get(access, message_id)
    except g.GoogleError as e:
        raise _gerr(e)


@router.post("/gmail/send")
async def send_now(payload: SendIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not payload.confirmed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Confirmez l'envoi après avoir relu le message.")
    checked = _checked(payload)
    link = _gmail_link(await _google_link(db, user))
    try:
        access = await g.valid_access_token(db, link)
        mime = g.build_mime(sender=link.account_email, in_reply_to=payload.in_reply_to,
                            references=payload.references, **checked)
        gmail_id = await g.gmail_send(access, mime, payload.thread_id)
    except g.GoogleError as e:
        raise _gerr(e)
    return {"ok": True, "gmail_id": gmail_id, "from": link.account_email, "to": checked["to"]}


@router.post("/gmail/schedule", status_code=status.HTTP_201_CREATED)
async def schedule(payload: ScheduleIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not payload.confirmed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Confirmez l'envoi programmé après avoir relu le message.")
    checked = _checked(payload)
    link = _gmail_link(await _google_link(db, user))
    when = datetime.strptime(payload.send_at, "%Y-%m-%dT%H:%M")
    delta = (when - datetime.now()).total_seconds()
    if delta < MIN_SCHEDULE_MINUTES * 60:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La date d'envoi doit être dans le futur.")
    if delta > MAX_SCHEDULE_DAYS * 86400:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Envoi programmable au plus {MAX_SCHEDULE_DAYS} jours à l'avance.")
    row = ScheduledMessage(
        user_id=user.id, recipient=", ".join(checked["to"]), channel="gmail",
        subject=checked["subject"], body=checked["body"], cc=", ".join(checked["cc"]) or None,
        link_id=link.id, scheduled_at=when, status="pending",
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"ok": True, "id": str(row.id), "send_at": when.strftime("%Y-%m-%dT%H:%M"), "to": checked["to"]}
