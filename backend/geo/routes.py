"""
backend/geo/routes.py
---------------------
Endpoints FastAPI servant de proxy securise vers Geoapify.
Tous les appels sont authentifies (JWT requis).
"""

import uuid
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.routes import get_current_user
from backend.database import get_db
from backend.models.db_models import Event, FrequentPlace, User
from backend.geo import service as geo_service
from backend.geo import itinerary

router = APIRouter(prefix="/geo", tags=["geolocation"])


# ---- Schemas ---------------------------------------------------------------

class GeocodeRequest(BaseModel):
    query: str


class PlacesRequest(BaseModel):
    lat: float
    lon: float
    category: str
    radius: int = 2000
    limit: int = 10


class RouteRequest(BaseModel):
    origin_lat: float
    origin_lon: float
    dest_lat: float
    dest_lon: float
    mode: str = "drive"  # drive | walk | bicycle


# ---- Endpoints -------------------------------------------------------------

@router.post("/geocode")
async def geocode(
    payload: GeocodeRequest,
    _current_user: User = Depends(get_current_user),
):
    """Convertit un nom de lieu en coordonnees GPS."""
    try:
        result = await geo_service.geocode_place(payload.query)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur Geoapify Geocoding : {e}")


@router.post("/places")
async def places(
    payload: PlacesRequest,
    _current_user: User = Depends(get_current_user),
):
    """Recherche des lieux d'une categorie dans un rayon."""
    try:
        result = await geo_service.search_places(
            payload.lat, payload.lon, payload.category, payload.radius, payload.limit
        )
        return {"places": result, "count": len(result)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur Geoapify Places : {e}")


@router.post("/route")
async def route(
    payload: RouteRequest,
    _current_user: User = Depends(get_current_user),
):
    """Calcule un itineraire entre deux points."""
    if payload.mode not in ("drive", "walk", "bicycle"):
        raise HTTPException(status_code=422, detail="mode doit etre : drive | walk | bicycle")
    try:
        result = await geo_service.calculate_route(
            payload.origin_lat, payload.origin_lon,
            payload.dest_lat,   payload.dest_lon,
            payload.mode,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur Geoapify Routing : {e}")


@router.get("/autocomplete")
async def autocomplete(
    text: str = Query(..., min_length=2),
    limit: int = Query(5, ge=1, le=10),
    _current_user: User = Depends(get_current_user),
):
    """Suggestions d'adresse en temps reel."""
    try:
        result = await geo_service.autocomplete_address(text, limit)
        return {"suggestions": result}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur Geoapify Autocomplete : {e}")


@router.get("/tiles-key")
async def get_tiles_key(
    _current_user: User = Depends(get_current_user),
):
    """Expose la cle Map Tiles au frontend authentifie."""
    from backend.config import settings
    return {"key": settings.geoapify_map_tiles_key}


# ---- Lieux fréquentés (Domicile, Bureau, École, QG...) ----------------------

class FrequentPlaceIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    kind: str = Field(default="other", max_length=20)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    address: str | None = Field(default=None, max_length=255)


def _place_out(p: FrequentPlace) -> dict:
    return {
        "id": str(p.id), "label": p.label, "kind": p.kind,
        "kind_label": itinerary.PLACE_KINDS.get(p.kind, "Autre"),
        "latitude": p.latitude, "longitude": p.longitude, "address": p.address,
    }


def _check_kind(kind: str) -> str:
    if kind not in itinerary.PLACE_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Type de lieu inconnu.")
    return kind


async def _geocode_or_422(address: str) -> dict:
    try:
        return await geo_service.geocode_place(address)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Adresse introuvable : {address}")
    except httpx.HTTPError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Le service de géocodage ne répond pas.")


async def _owned_place(db: AsyncSession, user: User, place_id: str) -> FrequentPlace:
    try:
        pid = uuid.UUID(place_id)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lieu introuvable.")
    row = (await db.execute(
        select(FrequentPlace).where(FrequentPlace.id == pid, FrequentPlace.user_id == user.id)
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lieu introuvable.")
    return row


@router.get("/frequent-places")
async def list_frequent_places(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(FrequentPlace).where(FrequentPlace.user_id == current_user.id).order_by(FrequentPlace.created_at)
    )).scalars().all()
    return {"places": [_place_out(p) for p in rows]}


@router.post("/frequent-places", status_code=status.HTTP_201_CREATED)
async def create_frequent_place(payload: FrequentPlaceIn, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    kind = _check_kind(payload.kind)
    label = " ".join(payload.label.split())
    lat, lon, address = payload.latitude, payload.longitude, payload.address
    if lat is None or lon is None:
        if not address or not address.strip():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Indiquez des coordonnées ou une adresse.")
        found = await _geocode_or_422(address.strip())
        lat, lon = found["lat"], found["lon"]
        address = found.get("formatted") or address.strip()
    place = FrequentPlace(user_id=current_user.id, label=label, kind=kind, latitude=lat, longitude=lon, address=address)
    db.add(place)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"Un lieu « {label} » existe déjà.")
    await db.refresh(place)
    return _place_out(place)


@router.put("/frequent-places/{place_id}")
async def update_frequent_place(place_id: str, payload: FrequentPlaceIn, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    place = await _owned_place(db, current_user, place_id)
    changes = payload.model_dump(exclude_unset=True)
    if "kind" in changes:
        place.kind = _check_kind(payload.kind)
    if "label" in changes:
        place.label = " ".join(payload.label.split())
    if payload.latitude is not None and payload.longitude is not None:
        place.latitude, place.longitude = payload.latitude, payload.longitude
        if "address" in changes:
            place.address = payload.address
    elif "address" in changes and payload.address and payload.address.strip():
        found = await _geocode_or_422(payload.address.strip())
        place.latitude, place.longitude = found["lat"], found["lon"]
        place.address = found.get("formatted") or payload.address.strip()
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Un lieu porte déjà ce nom.")
    await db.refresh(place)
    return _place_out(place)


@router.delete("/frequent-places/{place_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_frequent_place(place_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    place = await _owned_place(db, current_user, place_id)
    await db.delete(place)
    await db.commit()
    return None


# ---- Itinéraire de la journée ----------------------------------------------

ITINERARY_MODES = ("drive", "walk", "bicycle")


@router.get("/day-itinerary")
async def day_itinerary(
    date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    mode: str = Query("drive"),
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Itinéraire complet d'une journée : arrêts = événements ayant un lieu, dans l'ordre horaire.
    Départ : la position envoyée (lat, lon), sinon le domicile, sinon le premier arrêt.
    """
    if mode not in ITINERARY_MODES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "mode doit être : drive | walk | bicycle")
    try:
        day_start = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Date invalide (AAAA-MM-JJ).")

    rows = (await db.execute(
        select(Event).where(
            Event.owner_id == current_user.id,
            Event.start_time >= day_start,
            Event.start_time < day_start + timedelta(days=1),
        ).order_by(Event.start_time)
    )).scalars().all()
    saved = (await db.execute(select(FrequentPlace).where(FrequentPlace.user_id == current_user.id))).scalars().all()

    places = [itinerary.Point(label=p.label, lat=p.latitude, lon=p.longitude, kind=p.kind, address=p.address) for p in saved]
    events = [{
        "id": e.id, "title": e.title,
        "start": e.start_time.isoformat(timespec="minutes"), "end": e.end_time.isoformat(timespec="minutes"),
        "location": e.location or "", "latitude": e.latitude, "longitude": e.longitude, "geo_source": e.geo_source,
    } for e in rows]
    origin = None
    if lat is not None and lon is not None:
        origin = itinerary.Point(label="Ma position", lat=lat, lon=lon, kind="origin")

    try:
        result = await itinerary.build_day_itinerary(
            events, places, origin, mode,
            geocode=geo_service.geocode_place, route=geo_service.calculate_multi_route,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    except httpx.HTTPError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Le service d'itinéraire ne répond pas.")

    # Coordonnées trouvées pendant le calcul : mémorisées pour les prochains appels
    to_persist = result.pop("to_persist")
    if to_persist:
        by_id = {e.id: e for e in rows}
        for event_id, (la, lo, source) in to_persist.items():
            row = by_id[event_id]
            row.latitude, row.longitude, row.geo_source = la, lo, source
        await db.commit()

    result["date"] = date
    result["mode"] = mode
    result["events_without_location"] = sum(1 for e in rows if not (e.location or "").strip())
    return result
