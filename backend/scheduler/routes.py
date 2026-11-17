"""
routes.py (scheduler)
----------------------
Routes pour le Smart-Scheduler et le calcul d'ETA.
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import PlainTextResponse
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.routes import get_current_user
from backend.database import get_db
from backend.models.db_models import User, Event, ConstraintType, EventStatus
from backend.models.schemas import (
    ETARequest, ETAResponse, EventOut, EventCreate, EventUpdate,
    OptimizeFuzzyRequest, OptimizeFuzzyResponse, FuzzyTaskItem, ScheduleProposalItem,
    BatchCreateEventsRequest, BatchCreateEventsResponse
)
from backend.scheduler.conflict_engine import ScheduleEvent, resolve_conflicts, detect_conflicts
from backend.scheduler.eta import compute_eta
from backend.ai.fuzzy_parser import parse_fuzzy_intentions
from backend.scheduler.dynamic_optimizer import optimize_schedule_for_tasks

router = APIRouter(prefix="/scheduler", tags=["scheduler"])


@router.post("/events", response_model=EventOut, status_code=201)
async def create_event_manual(
    payload: EventCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Crée un événement manuellement depuis le tableau de bord (sans passer par l'IA)."""
    if payload.start_time >= payload.end_time:
        raise HTTPException(status_code=422, detail="L'heure de début doit être strictement avant l'heure de fin.")

    # Convertir la chaîne constraint_type en enum
    try:
        ct = ConstraintType(payload.constraint_type)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"constraint_type invalide : '{payload.constraint_type}'. Valeurs acceptées : hard, soft.")

    event = Event(
        title=payload.title,
        start_time=payload.start_time,
        end_time=payload.end_time,
        location=payload.location,
        constraint_type=ct,
        status=EventStatus.CONFIRMED,
        source="manual",
        owner_id=current_user.id,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


@router.put("/events/{event_id}", response_model=EventOut)
async def update_event_manual(
    event_id: str,
    payload: EventUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Met à jour partiellement un événement existant appartenant à l'utilisateur authentifié."""
    from uuid import UUID as _UUID
    try:
        uid = _UUID(event_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="event_id invalide (doit être un UUID).")

    result = await db.execute(select(Event).where(Event.id == uid))
    event = result.scalars().first()

    if not event:
        raise HTTPException(status_code=404, detail="Événement introuvable.")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Vous n'êtes pas autorisé à modifier cet événement.")

    # Appliquer les champs fournis uniquement
    if payload.title is not None:
        event.title = payload.title
    if payload.start_time is not None:
        event.start_time = payload.start_time
    if payload.end_time is not None:
        event.end_time = payload.end_time
    if payload.location is not None:
        event.location = payload.location
    if payload.description is not None:
        event.description = payload.description
    if payload.constraint_type is not None:
        try:
            event.constraint_type = ConstraintType(payload.constraint_type)
        except ValueError:
            raise HTTPException(
                status_code=422,
                detail=f"constraint_type invalide : '{payload.constraint_type}'. Valeurs acceptées : hard, soft."
            )

    # Vérifier la cohérence temporelle après mise à jour
    if event.start_time >= event.end_time:
        raise HTTPException(status_code=422, detail="L'heure de début doit être strictement avant l'heure de fin.")

    event.status = EventStatus.CONFIRMED
    await db.commit()
    await db.refresh(event)
    return event


@router.delete("/events/{event_id}", status_code=204)
async def delete_event_manual(
    event_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Supprime définitivement un événement appartenant à l'utilisateur authentifié."""
    from uuid import UUID as _UUID
    try:
        uid = _UUID(event_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="event_id invalide (doit être un UUID).")

    result = await db.execute(select(Event).where(Event.id == uid))
    event = result.scalars().first()

    if not event:
        raise HTTPException(status_code=404, detail="Événement introuvable.")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Vous n'êtes pas autorisé à supprimer cet événement.")

    await db.delete(event)
    await db.commit()
    # 204 No Content — pas de corps de réponse




@router.post("/resolve", response_model=list[EventOut])
async def resolve_user_conflicts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.owner_id == current_user.id))
    db_events = result.scalars().all()

    if not db_events:
        return []

    calc_events = [
        ScheduleEvent(
            id=str(e.id),
            title=e.title,
            start=e.start_time,
            end=e.end_time,
            constraint_type=e.constraint_type,
        )
        for e in db_events
    ]

    conflicts_before = detect_conflicts(calc_events)
    hard_conflict_ids = set()
    for a, b in conflicts_before:
        if a.constraint_type == ConstraintType.HARD and b.constraint_type == ConstraintType.HARD:
            hard_conflict_ids.add(a.id)
            hard_conflict_ids.add(b.id)

    moves = resolve_conflicts(calc_events)

    updated_events = []
    for e in db_events:
        event_id_str = str(e.id)
        e.status = EventStatus.CONFIRMED

        if event_id_str in moves:
            new_start, new_end = moves[event_id_str]
            e.start_time = new_start
            e.end_time = new_end
        elif event_id_str in hard_conflict_ids:
            e.status = EventStatus.CONFLICT

        updated_events.append(e)

    await db.commit()
    for e in updated_events:
        await db.refresh(e)

    return updated_events


@router.post("/eta", response_model=ETAResponse)
async def get_travel_eta(
    payload: ETARequest,
    current_user: User = Depends(get_current_user),
):
    try:
        res = await compute_eta(
            current_lat=payload.current_lat,
            current_lng=payload.current_lng,
            meeting_lat=payload.meeting_lat,
            meeting_lng=payload.meeting_lng,
            meeting_time=payload.meeting_time,
        )
        return ETAResponse(
            estimated_arrival=res.estimated_arrival,
            delay_minutes=res.delay_minutes,
            is_late=res.is_late,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur d'ETA : {str(e)}"
        )


@router.get("/events", response_model=list[EventOut])
async def list_user_events(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retourne la liste des événements de l'utilisateur triés par date."""
    result = await db.execute(
        select(Event).where(Event.owner_id == current_user.id).order_by(Event.start_time)
    )
    return result.scalars().all()


@router.post("/optimize-fuzzy", response_model=OptimizeFuzzyResponse)
async def optimize_fuzzy_intentions_endpoint(
    payload: OptimizeFuzzyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Transforme des données hétérogènes et des intentions textuelles floues
    en un emploi du temps dynamiquement optimisé.
    Exemple : 'mes cheveux sont devenus trop longs' -> 'Proposition : ajouter un événement « rdv chez le coiffeur » Dimanche à 17h'
    """
    from datetime import date
    ref_date = date.today()
    if payload.today_iso:
        try:
            ref_date = date.fromisoformat(payload.today_iso)
        except Exception:
            pass

    # 1. Déduction sémantique
    parsed = parse_fuzzy_intentions(payload.text, payload.today_iso)
    tasks = parsed.get("tasks", [])

    if not tasks:
        return OptimizeFuzzyResponse(
            status="no_intent_detected",
            summary="Aucune intention d'activité ou tâche concrète n'a pu être déduite de ce texte.",
            tasks=[],
            proposals=[]
        )

    # 2. Récupération des événements existants
    result = await db.execute(
        select(Event).where(Event.owner_id == current_user.id)
    )
    db_events = result.scalars().all()

    # 3. Optimisation dynamique
    proposal = optimize_schedule_for_tasks(tasks, db_events, reference_date=ref_date)

    fuzzy_items = [FuzzyTaskItem(**t) for t in tasks]
    return OptimizeFuzzyResponse(
        status="success",
        summary=proposal.summary_message,
        tasks=fuzzy_items,
        proposals=proposal.items
    )


@router.post("/batch-create", response_model=BatchCreateEventsResponse, status_code=201)
async def batch_create_events(
    payload: BatchCreateEventsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Insère un lot d'événements créés ou approuvés en une seule transaction."""
    created_events = []
    for item in payload.events:
        if item.start_time >= item.end_time:
            continue
        ct = ConstraintType.HARD if item.constraint_type == "hard" else ConstraintType.SOFT
        ev = Event(
            title=item.title,
            start_time=item.start_time,
            end_time=item.end_time,
            location=item.location,
            constraint_type=ct,
            status=EventStatus.CONFIRMED,
            source="fuzzy_optimizer",
            owner_id=current_user.id,
        )
        db.add(ev)
        created_events.append(ev)

    await db.commit()
    for ev in created_events:
        await db.refresh(ev)

    return BatchCreateEventsResponse(
        created_count=len(created_events),
        events=created_events
    )


# ─── EXPORTATION STANDARD ICALENDAR (.ICS) ──────────────────────────────────

def _format_ics_datetime(dt) -> str:
    """Formate un datetime au standard RFC 5545 (ex: 20261106T143000Z)."""
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _generate_ics_calendar(events: list[Event], cal_name: str = "Krono AI Calendar") -> str:
    """Génère une chaîne iCalendar valide conforme RFC 5545."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Krono AI//Smart-Scheduler//FR",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{cal_name}",
        "X-WR-TIMEZONE:UTC",
    ]

    for ev in events:
        uid = f"{ev.id}@krono-ai.local"
        dtstamp = _format_ics_datetime(ev.created_at)
        dtstart = _format_ics_datetime(ev.start_time)
        dtend = _format_ics_datetime(ev.end_time)
        summary = ev.title.replace("\n", " ").replace(";", "\\;")
        location = (ev.location or "").replace("\n", " ").replace(";", "\\;")

        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{dtstamp}",
            f"DTSTART:{dtstart}",
            f"DTEND:{dtend}",
            f"SUMMARY:{summary}",
            f"LOCATION:{location}",
            f"DESCRIPTION:Contrainte: {ev.constraint_type.value.upper()} | Source: {ev.source}",
            f"STATUS:CONFIRMED",
            "END:VEVENT",
        ])

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


@router.get("/events/export/ics", response_class=PlainTextResponse)
async def export_all_events_ics(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Exporte l'ensemble du calendrier de l'utilisateur au format iCalendar (.ics)."""
    stmt = select(Event).where(Event.owner_id == current_user.id).order_by(Event.start_time.asc())
    res = await db.execute(stmt)
    events = res.scalars().all()

    ics_content = _generate_ics_calendar(events, cal_name=f"Agenda {current_user.full_name or 'Krono'}")
    return Response(
        content=ics_content,
        media_type="text/calendar",
        headers={
            "Content-Disposition": f"attachment; filename=krono_calendar_{current_user.id}.ics",
            "Cache-Control": "no-cache",
        }
    )


@router.get("/events/{event_id}/ics", response_class=PlainTextResponse)
async def export_single_event_ics(
    event_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Exporte un événement individuel au format iCalendar (.ics)."""
    stmt = select(Event).where(Event.id == event_id, Event.owner_id == current_user.id)
    res = await db.execute(stmt)
    ev = res.scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Événement introuvable.")

    ics_content = _generate_ics_calendar([ev], cal_name=ev.title)
    return Response(
        content=ics_content,
        media_type="text/calendar",
        headers={
            "Content-Disposition": f"attachment; filename=event_{ev.id}.ics",
            "Cache-Control": "no-cache",
        }
    )

