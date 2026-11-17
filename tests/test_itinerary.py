"""
test_itinerary.py
-----------------
Tests HORS RÉSEAU de la logique d'itinéraire de la journée (backend/geo/itinerary.py).
Géocodage et routage sont remplacés par des fausses fonctions.

Lancer depuis la racine du projet :  python -m pytest tests/test_itinerary.py
"""

import asyncio

import pytest

from backend.geo import itinerary
from backend.geo.itinerary import MAX_STOPS, Point


def run(coro):
    return asyncio.run(coro)


async def no_geocode(query):
    raise AssertionError(f"géocodage inattendu pour {query!r}")


def fake_geocoder(table):
    async def geocode(query):
        if query not in table:
            raise ValueError("Aucun résultat")
        lat, lon = table[query]
        return {"lat": lat, "lon": lon, "formatted": f"{query}, Lomé"}
    return geocode


def fake_router(calls):
    async def route(waypoints, mode):
        calls.append((list(waypoints), mode))
        legs = [{"distance_m": 1000 * (i + 1), "duration_s": 60 * (i + 1)} for i in range(len(waypoints) - 1)]
        coords = [[lon, lat] for lat, lon in waypoints]  # tracé simplifié : passe par chaque point
        return {"coords": coords, "legs": legs}
    return route


def event(id_, title, start, location, **extra):
    base = {"id": id_, "title": title, "start": start, "end": start, "location": location,
            "latitude": None, "longitude": None, "geo_source": None}
    base.update(extra)
    return base


# ─── Lieux fréquents ─────────────────────────────────────────────────────────

def test_saved_place_matches_label_ignoring_case_and_spaces():
    places = [Point(label="Bureau", lat=6.1, lon=1.2, kind="office")]
    assert itinerary.match_saved_place("  bureau ", places) is places[0]
    assert itinerary.match_saved_place("Université", places) is None


def test_saved_place_used_without_geocoding():
    places = [Point(label="Bureau", lat=6.13, lon=1.21, kind="office", address="12 rue X")]
    events = [event("e1", "Réunion", "2026-11-12T09:00", "bureau")]
    points, warnings, persist = run(itinerary.resolve_event_points(events, places, no_geocode))
    assert points[0].lat == 6.13 and warnings == [] and persist == {}


def test_stored_coordinates_reused_when_location_unchanged():
    events = [event("e1", "Cours", "2026-11-12T08:00", "Campus A", latitude=6.2, longitude=1.3, geo_source="Campus A")]
    points, _, persist = run(itinerary.resolve_event_points(events, [], no_geocode))
    assert (points[0].lat, points[0].lon) == (6.2, 1.3) and persist == {}


def test_changed_location_is_geocoded_again():
    events = [event("e1", "Cours", "2026-11-12T08:00", "Campus B", latitude=6.2, longitude=1.3, geo_source="Campus A")]
    geocode = fake_geocoder({"Campus B": (6.3, 1.4)})
    points, _, persist = run(itinerary.resolve_event_points(events, [], geocode))
    assert (points[0].lat, points[0].lon) == (6.3, 1.4)
    assert persist == {"e1": (6.3, 1.4, "Campus B")}


def test_unknown_location_is_reported_and_skipped():
    events = [
        event("e1", "Visite", "2026-11-12T10:00", "Lieu inexistant"),
        event("e2", "Déjeuner", "2026-11-12T12:00", "Restaurant Y"),
    ]
    geocode = fake_geocoder({"Restaurant Y": (6.15, 1.25)})
    points, warnings, _ = run(itinerary.resolve_event_points(events, [], geocode))
    assert [p.label for p in points] == ["Déjeuner"]
    assert any("Visite" in w for w in warnings)


def test_events_without_location_are_not_stops():
    events = [event("e1", "Appel", "2026-11-12T10:00", "   ")]
    points, warnings, _ = run(itinerary.resolve_event_points(events, [], no_geocode))
    assert points == [] and warnings == []


# ─── Itinéraire complet ──────────────────────────────────────────────────────

def test_full_day_route_starts_at_user_position_and_keeps_time_order():
    events = [
        event("e1", "Cours", "2026-11-12T08:00", "Campus", latitude=6.20, longitude=1.30, geo_source="Campus"),
        event("e2", "Réunion", "2026-11-12T14:00", "Bureau"),
    ]
    places = [Point(label="Bureau", lat=6.13, lon=1.21, kind="office")]
    origin = Point(label="Ma position", lat=6.10, lon=1.20, kind="origin")
    calls = []

    result = run(itinerary.build_day_itinerary(events, places, origin, "drive", no_geocode, fake_router(calls)))

    waypoints, mode = calls[0]
    assert mode == "drive"
    assert waypoints == [(6.10, 1.20), (6.20, 1.30), (6.13, 1.21)]
    assert [s["label"] for s in result["stops"]] == ["Cours", "Réunion"]
    assert [leg["from"] for leg in result["legs"]] == ["Ma position", "Cours"]
    assert result["origin"]["label"] == "Ma position"
    assert result["total_distance_km"] == pytest.approx(1 + 2)
    assert result["total_duration_min"] == pytest.approx(1 + 2)
    assert result["geometry"][0] == [6.10, 1.20]


def test_home_is_start_when_no_position_given():
    places = [Point(label="Domicile", lat=6.0, lon=1.0, kind="home")]
    events = [event("e1", "Cours", "2026-11-12T08:00", "Campus", latitude=6.2, longitude=1.3, geo_source="Campus")]
    calls = []
    result = run(itinerary.build_day_itinerary(events, places, None, "walk", no_geocode, fake_router(calls)))
    assert calls[0][0][0] == (6.0, 1.0)
    assert result["origin"]["label"] == "Domicile"


def test_first_stop_becomes_start_without_position_or_home():
    events = [
        event("e1", "Cours", "2026-11-12T08:00", "Campus", latitude=6.2, longitude=1.3, geo_source="Campus"),
        event("e2", "Réunion", "2026-11-12T14:00", "Bureau", latitude=6.1, longitude=1.2, geo_source="Bureau"),
    ]
    calls = []
    result = run(itinerary.build_day_itinerary(events, [], None, "drive", no_geocode, fake_router(calls)))
    assert result["origin"]["label"] == "Cours"
    assert [s["label"] for s in result["stops"]] == ["Réunion"]
    assert len(calls[0][0]) == 2


def test_single_point_returns_stops_without_routing():
    calls = []
    events = [event("e1", "Cours", "2026-11-12T08:00", "Campus", latitude=6.2, longitude=1.3, geo_source="Campus")]
    result = run(itinerary.build_day_itinerary(events, [], None, "drive", no_geocode, fake_router(calls)))
    assert calls == [] and result["legs"] == [] and len(result["stops"]) == 0


def test_too_many_stops_are_truncated_with_warning():
    events = [
        event(f"e{i}", f"Arrêt {i}", f"2026-11-12T{8 + i % 10:02d}:00", f"Lieu {i}",
              latitude=6.0 + i / 1000, longitude=1.0, geo_source=f"Lieu {i}")
        for i in range(MAX_STOPS + 5)
    ]
    origin = Point(label="Ma position", lat=6.0, lon=1.0, kind="origin")
    calls = []
    result = run(itinerary.build_day_itinerary(events, [], origin, "drive", no_geocode, fake_router(calls)))
    assert len(result["stops"]) == MAX_STOPS
    assert len(calls[0][0]) == MAX_STOPS + 1  # départ compris
    assert any("premiers" in w for w in result["warnings"])


def test_points_to_persist_are_returned_for_storage():
    events = [event("e9", "Visite", "2026-11-12T10:00", "Marché central")]
    geocode = fake_geocoder({"Marché central": (6.14, 1.22)})
    calls = []
    result = run(itinerary.build_day_itinerary(events, [], None, "drive", geocode, fake_router(calls)))
    assert result["to_persist"] == {"e9": (6.14, 1.22, "Marché central")}


# ─── Format réel du tracé Geoapify ───────────────────────────────────────────

def test_multiline_geometry_is_flattened_for_multi_stop_routes():
    from backend.geo.service import flatten_line
    line = {"type": "LineString", "coordinates": [[1.2, 6.1], [1.3, 6.2]]}
    multi = {"type": "MultiLineString", "coordinates": [[[1.2, 6.1], [1.25, 6.15]], [[1.25, 6.15], [1.3, 6.2]]]}
    assert flatten_line(line) == [[1.2, 6.1], [1.3, 6.2]]
    assert flatten_line(multi) == [[1.2, 6.1], [1.25, 6.15], [1.25, 6.15], [1.3, 6.2]]
