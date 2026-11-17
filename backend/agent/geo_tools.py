"""
backend/agent/geo_tools.py
--------------------------
Outils LangGraph que l agent peut appeler en langage naturel
pour repondre aux questions geographiques.
"""

import asyncio
from langchain_core.tools import tool
from backend.geo.service import geocode_place, search_places, calculate_route


@tool
def geocode_place_tool(query: str) -> dict:
    """
    Convertit un nom de lieu ou une adresse en coordonnees GPS (latitude, longitude).
    Utilise quand l utilisateur mentionne un lieu, une ville, une adresse ou un etablissement.
    Exemple : "Universite de Lome", "Tour Eiffel", "10 rue de la Paix Paris"
    """
    return asyncio.get_event_loop().run_until_complete(geocode_place(query))


@tool
def search_places_tool(lat: float, lon: float, category: str, radius: int = 2000) -> list:
    """
    Recherche des etablissements proches d un point GPS dans un rayon donne (en metres).
    Categories disponibles : education, healthcare, catering.restaurant, commercial.supermarket,
    sport, accommodation.hotel, service.financial.bank, public_transport.
    Utilise quand l utilisateur demande : "trouver un hopital pres de X", "cafes autour de moi".
    """
    return asyncio.get_event_loop().run_until_complete(
        search_places(lat, lon, category, radius)
    )


@tool
def calculate_route_tool(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    mode: str = "drive",
) -> dict:
    """
    Calcule l itineraire et la duree entre deux points GPS.
    mode : drive (voiture), walk (a pied), bicycle (velo)
    Retourne : distance en km, duree en minutes, tracé GeoJSON.
    Utilise quand l utilisateur demande : "combien de temps pour aller de X a Y ?",
    "calculer le trajet", "distance entre ... et ...".
    """
    return asyncio.get_event_loop().run_until_complete(
        calculate_route(origin_lat, origin_lon, dest_lat, dest_lon, mode)
    )


# Liste exportee pour l agent
GEO_TOOLS = [geocode_place_tool, search_places_tool, calculate_route_tool]
