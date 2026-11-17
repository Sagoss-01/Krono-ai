"""
backend/geo/itinerary.py
------------------------
Logique de l'itinéraire de la journée, sans accès direct à la base ni au réseau :
les appels de géocodage et de routage sont passés en paramètres, ce qui permet
de tester chaque règle hors ligne.

Règles :
- les lieux des événements sont ordonnés par heure de début ;
- un lieu d'événement identique à un lieu fréquent (ex. « Bureau ») utilise ses
  coordonnées, sans appel réseau ;
- sinon le lieu est géocodé ; s'il est introuvable, l'événement est signalé mais
  l'itinéraire continue avec les autres arrêts ;
- au plus MAX_STOPS arrêts (limite de points d'une requête de routage) ;
- le point de départ est la position de l'utilisateur, sinon son domicile, sinon
  le premier arrêt de la journée.
"""

from dataclasses import dataclass
from typing import Awaitable, Callable

MAX_STOPS = 23  # Geoapify accepte 25 points, départ compris
PLACE_KINDS = {"home": "Domicile", "office": "Bureau", "school": "École", "hq": "QG", "other": "Autre"}

GeocodeFn = Callable[[str], Awaitable[dict]]
RouteFn = Callable[[list[tuple[float, float]], str], Awaitable[dict]]


@dataclass
class Point:
    label: str
    lat: float
    lon: float
    kind: str = "custom"          # home | office | school | hq | other | event | origin
    event_id: int | str | None = None
    start: str | None = None      # heure de début (ISO) pour les arrêts d'événements
    end: str | None = None
    address: str | None = None


def normalize_label(text: str) -> str:
    return " ".join((text or "").split()).casefold()


def match_saved_place(location: str, places: list[Point]) -> Point | None:
    """Un lieu d'événement égal à un libellé fréquent (« Bureau », « QG ») reprend ses coordonnées."""
    wanted = normalize_label(location)
    for place in places:
        if normalize_label(place.label) == wanted:
            return place
    return None


async def resolve_event_points(events: list[dict], places: list[Point], geocode: GeocodeFn) -> tuple[list[Point], list[str], dict]:
    """
    events : dicts {id, title, start, end, location, latitude, longitude, geo_source}.
    Renvoie (arrêts ordonnés, avertissements, coordonnées à mémoriser {event_id: (lat, lon, source)}).
    """
    points: list[Point] = []
    warnings: list[str] = []
    to_persist: dict = {}
    for ev in events:
        location = " ".join((ev.get("location") or "").split())
        if not location:
            continue
        if ev.get("latitude") is not None and ev.get("longitude") is not None and ev.get("geo_source") == location:
            lat, lon, address = ev["latitude"], ev["longitude"], location
        else:
            saved = match_saved_place(location, places)
            if saved:
                lat, lon, address = saved.lat, saved.lon, saved.address or location
            else:
                try:
                    found = await geocode(location)
                except Exception:
                    warnings.append(f"Lieu introuvable pour « {ev['title']} » : {location}")
                    continue
                lat, lon, address = found["lat"], found["lon"], found.get("formatted") or location
                to_persist[ev["id"]] = (lat, lon, location)
        points.append(Point(label=ev["title"], lat=lat, lon=lon, kind="event", event_id=ev["id"],
                            start=ev.get("start"), end=ev.get("end"), address=address))
    return points, warnings, to_persist


async def build_day_itinerary(events: list[dict], places: list[Point], origin: Point | None,
                              mode: str, geocode: GeocodeFn, route: RouteFn) -> dict:
    points, warnings, to_persist = await resolve_event_points(events, places, geocode)

    if len(points) > MAX_STOPS:
        warnings.append(f"Seuls les {MAX_STOPS} premiers arrêts de la journée sont inclus.")
        points = points[:MAX_STOPS]

    start = origin
    if start is None:
        home = next((p for p in places if p.kind == "home"), None)
        start = home or (points.pop(0) if points else None)
        if start is not None and start.kind == "event":
            start.kind = "origin"
    result = {
        "origin": _public(start) if start else None,
        "stops": [_public(p) | {"order": i + 1} for i, p in enumerate(points)],
        "legs": [],
        "geometry": [],
        "total_distance_km": 0.0,
        "total_duration_min": 0.0,
        "warnings": warnings,
        "to_persist": to_persist,
    }
    waypoints = ([start] if start else []) + points
    if len(waypoints) < 2:
        return result  # rien à relier : on renvoie seulement la liste

    routed = await route([(p.lat, p.lon) for p in waypoints], mode)
    names = [p.label for p in waypoints]
    legs = []
    for i, leg in enumerate(routed["legs"]):
        legs.append({
            "from": names[i], "to": names[i + 1],
            "distance_km": round(leg["distance_m"] / 1000, 2),
            "duration_min": round(leg["duration_s"] / 60, 1),
        })
    result["legs"] = legs
    result["geometry"] = [[lat, lon] for lon, lat in routed["coords"]]
    result["total_distance_km"] = round(sum(l["distance_km"] for l in legs), 2)
    result["total_duration_min"] = round(sum(l["duration_min"] for l in legs), 1)
    return result


def _public(p: Point) -> dict:
    return {
        "label": p.label, "kind": p.kind, "lat": p.lat, "lon": p.lon,
        "event_id": str(p.event_id) if p.event_id is not None else None,
        "start": p.start, "end": p.end, "address": p.address,
    }
