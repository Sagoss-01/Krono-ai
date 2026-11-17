"""
config.py
---------
Configuration du nouveau backend, incluant la clé API Gemini et l'accès PostgreSQL.
"""

import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # --- Base de données ---
    database_url: str = os.getenv(
        "DATABASE_URL", "postgresql+asyncpg://user:password@localhost:5432/krono_ai"
    )

    # --- JWT (jetons d'authentification locale) ---
    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "change-me-in-production")
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60 * 24  # 24h

    # --- OAuth2 ---
    google_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "")
    google_client_secret: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    microsoft_client_id: str = os.getenv("MICROSOFT_CLIENT_ID", "")
    microsoft_client_secret: str = os.getenv("MICROSOFT_CLIENT_SECRET", "")

    # --- IA (OpenRouter, Gemini & Anthropic) ---
    openrouter_api_key: str = os.getenv("OPENROUTER_API_KEY", "")
    openrouter_base_url: str = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    openrouter_model: str = os.getenv("OPENROUTER_MODEL", "openrouter/free")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    anthropic_model: str = "claude-3-5-sonnet-20241022"


    # --- Google Maps API (legacy) ---
    google_maps_api_key: str = os.getenv("GOOGLE_MAPS_API_KEY", "")

    # --- Geoapify ---
    geoapify_geocoding_key: str = os.getenv("GEOAPiFY_GEOCODING_KEY", "")
    geoapify_places_key: str = os.getenv("GEOAPIFY_PLACES_KEY", "")
    geoapify_routing_key: str = os.getenv("GEOAPIFY_ROUTING_KEY", "")
    geoapify_autocomplete_key: str = os.getenv("GEOAPIFY_AUTOCOMPLETE_KEY", "")
    geoapify_map_tiles_key: str = os.getenv("GEOAPIFY_MAP_TILES_KEY", "")


    # --- Notifications Push (VAPID) ---
    vapid_public_key: str = os.getenv("VAPID_PUBLIC_KEY", "")
    vapid_private_key: str = os.getenv("VAPID_PRIVATE_KEY", "")
    vapid_admin_email: str = os.getenv("VAPID_ADMIN_EMAIL", "mailto:admin@krono.ai")

    class Config:
        env_file = ".env"


settings = Settings()
