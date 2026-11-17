"""
backend/assistant/routes.py
---------------------------
API de l'assistant Aura, sous /assistant.

POST /assistant/chat
  Entrée  : messages (historique de la conversation, dernier = demande courante),
            now_local (AAAA-MM-JJTHH:MM, heure locale du navigateur).
  Sortie  : reply (texte), suggestions (réponses rapides), actions (propositions à confirmer).
  Aucune action n'est exécutée par cette route : l'interface appelle les endpoints
  de l'agenda une fois l'utilisateur d'accord.
"""

import re
import secrets
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.assistant import brain, llm
from backend.assistant.context import EventFact, next_event
from backend.auth.routes import get_current_user
from backend.database import get_db
from backend.geo import service as geo_service
from backend.geo.itinerary import normalize_label
from backend.google_workspace import google_api as g
from backend.models.db_models import (CalendarLink, ConstraintType, Contact, Event, EventStatus,
                                      FrequentPlace, Meeting, User)

router = APIRouter(prefix="/assistant", tags=["assistant"])

TRAVEL_RE = re.compile(
    r"trajet|partir|départ|depart|retard|à l'heure|a l'heure|arriver|arrivée|itin[ée]raire|"
    r"combien de temps|quand dois|route|conduire|marcher|bus", re.IGNORECASE)
WINDOW_DAYS = 7
JITSI_BASE = "https://meet.jit.si/krono-"
TRAVEL_MARGIN_MIN = 10


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatIn(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)
    now_local: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")


async def _travel_estimate(next_ev: EventFact, places: list[FrequentPlace], db: AsyncSession, event_row: Event | None) -> dict | None:
    """Temps de trajet voiture depuis le domicile vers le prochain lieu. Renvoie None si impossible."""
    home = next((p for p in places if p.kind == "home"), None)
    if home is None or not next_ev.location:
        return None
    try:
        dest = None
        if event_row is not None and event_row.latitude is not None and event_row.geo_source == event_row.location:
            dest = (event_row.latitude, event_row.longitude)
        if dest is None:
            saved = next((p for p in places if normalize_label(p.label) == normalize_label(next_ev.location)), None)
            if saved:
                dest = (saved.latitude, saved.longitude)
        if dest is None:
            found = await geo_service.geocode_place(next_ev.location)
            dest = (found["lat"], found["lon"])
        route = await geo_service.calculate_multi_route([(home.latitude, home.longitude), dest], "drive")
        minutes = max(1, round(sum(leg["duration_s"] for leg in route["legs"]) / 60))
    except Exception:
        return None
    leave = next_ev.start - timedelta(minutes=minutes + TRAVEL_MARGIN_MIN)
    return {"ref": next_ev.ref, "title": next_ev.title, "origin": home.label,
            "minutes": minutes, "leave_at": leave.strftime("%H:%M")}


@router.post("/chat")
async def chat(payload: ChatIn, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    now = datetime.strptime(payload.now_local, "%Y-%m-%dT%H:%M")
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    rows = (await db.execute(
        select(Event).where(
            Event.owner_id == current_user.id,
            Event.start_time >= day_start,
            Event.start_time < day_start + timedelta(days=WINDOW_DAYS),
        ).order_by(Event.start_time)
    )).scalars().all()
    places_rows = (await db.execute(select(FrequentPlace).where(FrequentPlace.user_id == current_user.id))).scalars().all()
    contacts_rows = (await db.execute(select(Contact).where(Contact.user_id == current_user.id).limit(15))).scalars().all()

    events = [EventFact(
        ref=f"E{i + 1}", id=str(e.id), title=e.title or "", start=e.start_time, end=e.end_time,
        location=e.location or "", hard=e.constraint_type == ConstraintType.HARD,
    ) for i, e in enumerate(rows)]
    places = [(p.label, p.kind) for p in places_rows]
    contacts = [{"name": c.name, "email": c.email} for c in contacts_rows if c.name]

    last_user = next((m.content for m in reversed(payload.messages) if m.role == "user"), "")
    travel = None
    if TRAVEL_RE.search(last_user):
        upcoming = next_event(now, [e for e in events if e.start.date() == now.date() or e.start.date() == (now + timedelta(days=1)).date()])
        if upcoming and upcoming.location:
            event_row = next((r for r in rows if str(r.id) == upcoming.id), None)
            travel = await _travel_estimate(upcoming, places_rows, db, event_row)

    history = [{"role": m.role, "content": m.content} for m in payload.messages]

    google = (await db.execute(select(CalendarLink).where(
        CalendarLink.user_id == current_user.id, CalendarLink.provider == "google"))).scalars().first()
    search_fn = None
    if google is not None and g.has_scope(google, "gmail.readonly"):
        async def search_fn(query: str):
            access = await g.valid_access_token(db, google)
            return await g.gmail_search(access, query, 8)

    try:
        return await brain.respond(history=history, now=now, events=events, places=places,
                                   contacts=contacts, travel=travel, search_fn=search_fn)
    except llm.AssistantUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))


class MeetingIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    start_time: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
    end_time: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
    invitees: list[str] = Field(default_factory=list, max_length=20)
    send_invitations: bool = False
    confirmed: bool = False


@router.post("/meetings", status_code=status.HTTP_201_CREATED)
async def create_meeting(payload: MeetingIn, current_user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """Réunion vidéo : salle de visioconférence, événement d'agenda, invitations optionnelles par Gmail."""
    from backend.mailbox.policy import PolicyError, normalize_address

    if not payload.confirmed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Confirmez la réunion avant de la créer.")
    start = datetime.strptime(payload.start_time, "%Y-%m-%dT%H:%M")
    end = datetime.strptime(payload.end_time, "%Y-%m-%dT%H:%M")
    if end <= start:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La fin doit être après le début.")
    try:
        invitees = [normalize_address(a) for a in payload.invitees]
    except PolicyError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    code = secrets.token_urlsafe(9).replace("-", "").replace("_", "")[:12].lower()
    link = f"{JITSI_BASE}{code}"
    meeting = Meeting(host_id=current_user.id, title=payload.title.strip(), meeting_code=code,
                      status="scheduled", scheduled_start=start)
    event = Event(owner_id=current_user.id, title=payload.title.strip(), start_time=start, end_time=end,
                  location=link, constraint_type=ConstraintType.SOFT, status=EventStatus.CONFIRMED, source="local")
    db.add(meeting)
    db.add(event)
    await db.commit()
    await db.refresh(event)

    invitations_sent = False
    if payload.send_invitations and invitees:
        gl = (await db.execute(select(CalendarLink).where(
            CalendarLink.user_id == current_user.id, CalendarLink.provider == "google"))).scalars().first()
        if gl is not None and g.has_scope(gl, "gmail.send"):
            try:
                access = await g.valid_access_token(db, gl)
                body = (f"Vous êtes invité(e) à la réunion « {payload.title.strip()} ».\n"
                        f"Date : {start:%d/%m/%Y} de {start:%H:%M} à {end:%H:%M}\n"
                        f"Lien de visioconférence : {link}\n")
                mime = g.build_mime(sender=gl.account_email, to=invitees, cc=[],
                                    subject=f"Invitation : {payload.title.strip()}", body=body)
                await g.gmail_send(access, mime)
                invitations_sent = True
            except g.GoogleError:
                invitations_sent = False
    return {"meeting_id": str(meeting.id), "code": code, "link": link, "event_id": str(event.id),
            "invitations_sent": invitations_sent}
