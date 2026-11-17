"""
backend/geo/service.py
----------------------
Service async Geoapify -- proxy securise cote serveur.
Expose 4 fonctions : geocode_place, search_places, calculate_route, autocomplete_address.
"""

import httpx
from backend.config import settings

GEOCODING_BASE    = "https://api.geoapify.com/v1/geocode/search"
PLACES_BASE       = "https://api.geoapify.com/v2/places"
ROUTING_BASE      = "https://api.geoapify.com/v1/routing"
AUTOCOMPLETE_BASE = "https://api.geoapify.com/v1/geocode/autocomplete"


async def geocode_place(query: str) -> dict:
    """Convertit un nom de lieu ou une adresse en coordonnees GPS."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            GEOCODING_BASE,
            params={
                "text": query,
                "limit": 1,
                "lang": "fr",
                "apiKey": settings.geoapify_geocoding_key,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        features = data.get("features", [])
        if not features:
            raise ValueError(f"Aucun resultat pour : {query!r}")
        props = features[0]["properties"]
        geo   = features[0]["geometry"]["coordinates"]
        return {
            "lat": geo[1],
            "lon": geo[0],
            "formatted": props.get("formatted", ""),
            "country": props.get("country", ""),
            "city": props.get("city", ""),
        }


async def search_places(lat: float, lon: float, category: str, radius: int = 2000, limit: int = 10) -> list:
    """Recherche des etablissements d'une categorie dans un rayon (metres) autour d'un point."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            PLACES_BASE,
            params={
                "categories": category,
                "filter": f"circle:{lon},{lat},{radius}",
                "limit": limit,
                "lang": "fr",
                "apiKey": settings.geoapify_places_key,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        results = []
        for feat in data.get("features", []):
            props  = feat["properties"]
            coords = feat["geometry"]["coordinates"]
            results.append({
                "name": props.get("name", props.get("formatted", "Lieu inconnu")),
                "lat": coords[1],
                "lon": coords[0],
                "address": props.get("formatted", ""),
                "category": (props.get("categories") or [category])[0],
            })
        return results


async def calculate_route(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    mode: str = "drive",
) -> dict:
    """Calcule un itineraire entre deux points. mode : drive | walk | bicycle"""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            ROUTING_BASE,
            params={
                "waypoints": f"{origin_lat},{origin_lon}|{dest_lat},{dest_lon}",
                "mode": mode,
                "lang": "fr",
                "apiKey": settings.geoapify_routing_key,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        features = data.get("features", [])
        if not features:
            raise ValueError("Aucun itineraire trouve.")
        props      = features[0]["properties"]
        legs       = props.get("legs", [{}])
        distance_m = sum(leg.get("distance", 0) for leg in legs)
        duration_s = sum(leg.get("time", 0) for leg in legs)
        coords     = features[0]["geometry"]["coordinates"]
        return {
            "distance_m":   distance_m,
            "distance_km":  round(distance_m / 1000, 2),
            "duration_s":   duration_s,
            "duration_min": round(duration_s / 60, 1),
            "mode":         mode,
            "geojson_coords": coords,
        }


async def autocomplete_address(text: str, limit: int = 5) -> list:
    """Retourne des suggestions d'adresse en temps reel."""
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(
            AUTOCOMPLETE_BASE,
            params={
                "text": text,
                "limit": limit,
                "lang": "fr",
                "apiKey": settings.geoapify_autocomplete_key,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        suggestions = []
        for feat in data.get("features", []):
            props  = feat["properties"]
            coords = feat["geometry"]["coordinates"]
            suggestions.append({
                "label": props.get("formatted", ""),
                "lat":   coords[1],
                "lon":   coords[0],
            })
        return suggestions


async def calculate_multi_route(waypoints: list[tuple[float, float]], mode: str = "drive") -> dict:
    """
    Itinéraire passant par plusieurs points, dans l'ordre (une seule requête Geoapify).
    Renvoie : coords [[lon, lat], ...] du tracé complet et legs (distance_m, duration_s) par tronçon.
    """
    if len(waypoints) < 2:
        raise ValueError("Au moins deux points sont nécessaires pour un itinéraire.")
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            ROUTING_BASE,
            params={
                "waypoints": "|".join(f"{lat},{lon}" for lat, lon in waypoints),
                "mode": mode,
                "lang": "fr",
                "apiKey": settings.geoapify_routing_key,
            },
        )
        if resp.status_code == 400:
            # Geoapify refuse un point situé loin de toute route praticable (mer, zone sans réseau)
            raise ValueError("Itinéraire impossible : un des lieux n'est proche d'aucune route praticable pour ce mode.")
        resp.raise_for_status()
        features = resp.json().get("features", [])
        if not features:
            raise ValueError("Aucun itinéraire trouvé entre ces points.")
        feature = features[0]
        legs = [
            {"distance_m": leg.get("distance", 0), "duration_s": leg.get("time", 0)}
            for leg in feature["properties"].get("legs", [])
        ]
        return {"coords": flatten_line(feature["geometry"]), "legs": legs}


def flatten_line(geometry: dict) -> list:
    """
    Tracé en liste plate de points [lon, lat].
    Geoapify renvoie un LineString pour deux points et un MultiLineString (une liste de tronçons)
    dès qu'il y a plusieurs étapes : on concatène les tronçons.
    """
    coords = geometry.get("coordinates", [])
    if geometry.get("type") == "MultiLineString":
        return [point for part in coords for point in part]
    return coords
