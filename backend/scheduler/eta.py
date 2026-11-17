"""
eta.py
------
Calculateur d'ETA robuste pour Krono AI.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import math
import httpx

from backend.config import settings


@dataclass
class ETAResult:
    estimated_arrival: datetime
    delay_minutes: int
    is_late: bool


def _fallback_travel_time_minutes(
    origin_lat: float, origin_lng: float, destination_lat: float, destination_lng: float
) -> int:
    R = 6371.0  # Rayon de la Terre en km

    lat1 = math.radians(origin_lat)
    lon1 = math.radians(origin_lng)
    lat2 = math.radians(destination_lat)
    lon2 = math.radians(destination_lng)

    dlon = lon2 - lon1
    dlat = lat2 - lat1

    a = math.sin(dlat / 2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    distance_km = R * c
    road_distance_km = distance_km * 1.3
    speed_kmh = 50.0
    travel_time_hours = road_distance_km / speed_kmh

    if distance_km < 0.05:
        return 0
    return max(round(travel_time_hours * 60), 5)


async def _fetch_travel_time_minutes(
    origin_lat: float, origin_lng: float, destination_lat: float, destination_lng: float
) -> int:
    if not settings.google_maps_api_key:
        return _fallback_travel_time_minutes(origin_lat, origin_lng, destination_lat, destination_lng)

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                "https://maps.googleapis.com/maps/api/distancematrix/json",
                params={
                    "origins": f"{origin_lat},{origin_lng}",
                    "destinations": f"{destination_lat},{destination_lng}",
                    "mode": "driving",
                    "key": settings.google_maps_api_key,
                },
            )
            if response.status_code != 200:
                return _fallback_travel_time_minutes(origin_lat, origin_lng, destination_lat, destination_lng)

            data = response.json()
            if data.get("status") != "OK":
                return _fallback_travel_time_minutes(origin_lat, origin_lng, destination_lat, destination_lng)

            element = data["rows"][0]["elements"][0]
            if element.get("status") != "OK":
                return _fallback_travel_time_minutes(origin_lat, origin_lng, destination_lat, destination_lng)

            duration_seconds = element["duration"]["value"]
            return round(duration_seconds / 60)
    except Exception:
        return _fallback_travel_time_minutes(origin_lat, origin_lng, destination_lat, destination_lng)


async def compute_eta(
    current_lat: float,
    current_lng: float,
    meeting_lat: float,
    meeting_lng: float,
    meeting_time: datetime,
) -> ETAResult:
    travel_minutes = await _fetch_travel_time_minutes(
        current_lat, current_lng, meeting_lat, meeting_lng
    )
    estimated_arrival = datetime.now(timezone.utc) + timedelta(minutes=travel_minutes)
    
    if meeting_time.tzinfo is None:
        meeting_time = meeting_time.replace(tzinfo=timezone.utc)
        
    delay = int((estimated_arrival - meeting_time).total_seconds() / 60)

    return ETAResult(
        estimated_arrival=estimated_arrival,
        delay_minutes=max(delay, 0),
        is_late=delay > 0,
    )
