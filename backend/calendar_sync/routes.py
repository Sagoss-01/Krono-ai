"""
routes.py (calendar_sync)
--------------------------
Endpoints pour l'enregistrement et la synchronisation de calendriers.
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.routes import get_current_user
from fastapi.responses import RedirectResponse
from backend.auth.security import encrypt_token, decrypt_token, decode_access_token
from backend.database import get_db
from backend.models.db_models import User, CalendarLink, Event, ConstraintType
from backend.models.schemas import CalendarLinkCreate, CalendarLinkOut
from backend.calendar_sync.providers import get_provider
from backend.calendar_sync.deduplication import IncomingEvent, deduplicate
from backend.scheduler.conflict_engine import ScheduleEvent, resolve_conflicts
from backend.google_workspace import google_api

router = APIRouter(prefix="/calendar", tags=["calendar"])

@router.get("/auth/{provider}/login")
async def provider_login(provider: str, token: str):
    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Token invalide")
    try:
        if provider == "google":
            return RedirectResponse(url=google_api.build_auth_url(user_id))
        provider_client = get_provider(provider)
        # État signé : un tiers ne peut pas lier ce compte à un autre utilisateur
        auth_url = provider_client.get_auth_url(state=google_api.make_state(user_id))
        return RedirectResponse(url=auth_url)
    except (ValueError, google_api.GoogleError) as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/auth/{provider}/callback")
async def provider_callback(provider: str, state: str, code: str | None = None, db: AsyncSession = Depends(get_db)):
    try:
        user_id = google_api.read_state(state)
    except google_api.GoogleError:
        return RedirectResponse(url="http://localhost:3000?sync=error&msg=state")
    if not code:
        return RedirectResponse(url="http://localhost:3000?sync=error&msg=denied")

    account_email, scopes = None, None
    try:
        if provider == "google":
            data = await google_api.exchange_code(code)
            access_token, refresh_token, token_expires_at = data["access_token"], data["refresh_token"], data["expires_at"]
            account_email, scopes = data["email"], data["scope"]
        else:
            provider_client = get_provider(provider)
            access_token, refresh_token, token_expires_at = await provider_client.exchange_code(code)
    except Exception:
        return RedirectResponse(url="http://localhost:3000?sync=error&msg=exchange")

    encrypted_access = encrypt_token(access_token)
    encrypted_refresh = encrypt_token(refresh_token) if refresh_token else None

    existing_stmt = select(CalendarLink).where(
        CalendarLink.user_id == user_id,
        CalendarLink.provider == provider
    )
    res = await db.execute(existing_stmt)
    link = res.scalar_one_or_none()

    if link:
        link.encrypted_access_token = encrypted_access
        if encrypted_refresh:
            link.encrypted_refresh_token = encrypted_refresh
        link.token_expires_at = token_expires_at
        link.account_email = account_email or link.account_email
        link.scopes = scopes or link.scopes
    else:
        link = CalendarLink(
            user_id=user_id,
            provider=provider,
            encrypted_access_token=encrypted_access,
            encrypted_refresh_token=encrypted_refresh,
            token_expires_at=token_expires_at,
            account_email=account_email,
            scopes=scopes,
        )
        db.add(link)

    await db.commit()
    return RedirectResponse(url="http://localhost:3000?sync=success")



@router.post("/links", response_model=CalendarLinkOut)
async def create_calendar_link(
    payload: CalendarLinkCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        get_provider(payload.provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    encrypted_access = encrypt_token(payload.access_token)
    encrypted_refresh = encrypt_token(payload.refresh_token) if payload.refresh_token else None
    
    expires_in = payload.expires_in_seconds or 3600
    token_expires_at = datetime.utcnow() + timedelta(seconds=expires_in)

    existing_stmt = select(CalendarLink).where(
        CalendarLink.user_id == current_user.id,
        CalendarLink.provider == payload.provider
    )
    res = await db.execute(existing_stmt)
    link = res.scalar_one_or_none()

    if link:
        link.encrypted_access_token = encrypted_access
        link.encrypted_refresh_token = encrypted_refresh
        link.token_expires_at = token_expires_at
    else:
        link = CalendarLink(
            user_id=current_user.id,
            provider=payload.provider,
            encrypted_access_token=encrypted_access,
            encrypted_refresh_token=encrypted_refresh,
            token_expires_at=token_expires_at,
        )
        db.add(link)

    await db.commit()
    await db.refresh(link)
    return link


@router.get("/links", response_model=list[CalendarLinkOut])
async def list_calendar_links(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(CalendarLink).where(CalendarLink.user_id == current_user.id))
    return result.scalars().all()


def _parse_datetime(dt_str: str) -> datetime:
    if dt_str.endswith("Z"):
        dt_str = dt_str[:-1] + "+00:00"
    dt = datetime.fromisoformat(dt_str)
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


@router.post("/sync")
async def sync_external_calendars(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    links_res = await db.execute(select(CalendarLink).where(CalendarLink.user_id == current_user.id))
    links = links_res.scalars().all()

    if not links:
        return {"status": "success", "message": "Aucun calendrier externe configure.", "imported": 0}

    now_utc = datetime.now(timezone.utc)
    start_sync = now_utc.replace(tzinfo=None)
    end_sync = (now_utc + timedelta(days=7)).replace(tzinfo=None)

    events_res = await db.execute(select(Event).where(Event.owner_id == current_user.id))
    db_events = events_res.scalars().all()

    existing_incoming = [
        IncomingEvent(
            external_id=e.external_id,
            source=e.source,
            title=e.title,
            start=e.start_time,
            end=e.end_time,
        )
        for e in db_events
    ]

    all_incoming_events: list[IncomingEvent] = []

    locations: dict[tuple[str, str], str | None] = {}
    for link in links:
        if link.provider == "google":
            # Agenda Google : pagination, récurrences développées, lieux conservés
            try:
                access = await google_api.valid_access_token(db, link)
                items = await google_api.list_calendar_events(access, *google_api.import_window())
            except Exception:
                continue
            for item in items:
                parsed = google_api.parse_google_event(item)
                if not parsed:
                    continue
                locations[("google", parsed["external_id"])] = parsed["location"]
                all_incoming_events.append(IncomingEvent(
                    external_id=parsed["external_id"], source="google", title=parsed["title"],
                    start=parsed["start"], end=parsed["end"],
                ))
            continue

        provider = get_provider(link.provider)
        
        if link.token_expires_at and datetime.now(timezone.utc) >= link.token_expires_at.replace(tzinfo=timezone.utc) - timedelta(minutes=1):
            if not link.encrypted_refresh_token:
                continue
            
            try:
                refresh_token = decrypt_token(link.encrypted_refresh_token)
                new_access, new_expiry = await provider.refresh_access_token(refresh_token)
                link.encrypted_access_token = encrypt_token(new_access)
                link.token_expires_at = new_expiry
                await db.commit()
            except Exception:
                continue

        try:
            access_token = decrypt_token(link.encrypted_access_token)
        except Exception:
            continue

        try:
            raw_events = await provider.fetch_events(access_token, start_sync, end_sync)
            for item in raw_events:
                if link.provider == "google":
                    title = item.get("summary", "Evenement sans titre")
                    start_str = item.get("start", {}).get("dateTime") or item.get("start", {}).get("date")
                    end_str = item.get("end", {}).get("dateTime") or item.get("end", {}).get("date")
                    ext_id = item.get("id")
                else:  # microsoft
                    title = item.get("subject", "Evenement sans titre")
                    start_str = item.get("start", {}).get("dateTime")
                    end_str = item.get("end", {}).get("dateTime")
                    ext_id = item.get("id")

                if not start_str or not end_str:
                    continue

                all_incoming_events.append(
                    IncomingEvent(
                        external_id=ext_id,
                        source=link.provider,
                        title=title,
                        start=_parse_datetime(start_str),
                        end=_parse_datetime(end_str),
                    )
                )
        except Exception:
            continue

    to_import, duplicates = deduplicate(existing_incoming, all_incoming_events)

    new_events_inserted = []
    for inc in to_import:
        new_evt = Event(
            owner_id=current_user.id,
            title=inc.title,
            start_time=inc.start,
            end_time=inc.end,
            # Événement importé : il existe aussi chez le fournisseur, l'assistant et le planificateur
            # ne le déplacent pas (contrainte dure, règle 1 de CLAUDE.md)
            constraint_type=ConstraintType.HARD,
            source=inc.source,
            external_id=inc.external_id,
            location=locations.get((inc.source, inc.external_id)),
        )
        db.add(new_evt)
        new_events_inserted.append(new_evt)

    if new_events_inserted:
        await db.commit()

    final_events_res = await db.execute(select(Event).where(Event.owner_id == current_user.id))
    final_db_events = final_events_res.scalars().all()

    calc_events = [
        ScheduleEvent(
            id=str(e.id),
            title=e.title,
            start=e.start_time,
            end=e.end_time,
            constraint_type=e.constraint_type,
        )
        for e in final_db_events
    ]

    moves = resolve_conflicts(calc_events)
    
    resolved_count = 0
    if moves:
        for e in final_db_events:
            event_id_str = str(e.id)
            if event_id_str in moves:
                new_start, new_end = moves[event_id_str]
                e.start_time = new_start
                e.end_time = new_end
                resolved_count += 1
        await db.commit()

    return {
        "status": "success",
        "imported": len(to_import),
        "duplicates_ignored": len(duplicates),
        "scheduler_relocations": resolved_count,
    }
