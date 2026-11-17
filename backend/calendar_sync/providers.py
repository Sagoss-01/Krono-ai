"""
providers.py
-------------
Fournisseurs de calendrier Google & Outlook.
"""

from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone
import httpx

from backend.config import settings


class CalendarProvider(ABC):
    @abstractmethod
    def get_auth_url(self, state: str) -> str:
        ...

    @abstractmethod
    async def exchange_code(self, code: str) -> tuple[str, str, datetime]:
        ...

    @abstractmethod
    async def fetch_events(self, access_token: str, start: datetime, end: datetime) -> list[dict]:
        ...

    @abstractmethod
    async def push_event(self, access_token: str, event: dict) -> str:
        ...

    @abstractmethod
    async def refresh_access_token(self, refresh_token: str) -> tuple[str, datetime]:
        ...


class GoogleCalendarProvider(CalendarProvider):
    BASE_URL = "https://www.googleapis.com/calendar/v3"
    REDIRECT_URI = "http://127.0.0.1:8000/calendar/auth/google/callback"

    def get_auth_url(self, state: str) -> str:
        client_id = settings.google_client_id or ""
        scopes = "https://www.googleapis.com/auth/calendar.events"
        return (
            f"https://accounts.google.com/o/oauth2/v2/auth?"
            f"client_id={client_id}&"
            f"redirect_uri={self.REDIRECT_URI}&"
            f"response_type=code&"
            f"scope={scopes}&"
            f"access_type=offline&"
            f"prompt=consent&"
            f"state={state}"
        )

    async def exchange_code(self, code: str) -> tuple[str, str, datetime]:
        if not settings.google_client_id or not settings.google_client_secret:
            raise ValueError("GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET requis dans .env")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "code": code,
                    "redirect_uri": self.REDIRECT_URI,
                    "grant_type": "authorization_code",
                },
            )
            response.raise_for_status()
            data = response.json()
            access_token = data["access_token"]
            refresh_token = data.get("refresh_token", "")
            expires_in = data.get("expires_in", 3600)
            expiration = datetime.utcnow() + timedelta(seconds=expires_in)
            return access_token, refresh_token, expiration

    async def fetch_events(self, access_token: str, start: datetime, end: datetime) -> list[dict]:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/calendars/primary/events",
                headers={"Authorization": f"Bearer {access_token}"},
                params={
                    "timeMin": start.isoformat() + "Z" if not start.isoformat().endswith("Z") else start.isoformat(),
                    "timeMax": end.isoformat() + "Z" if not end.isoformat().endswith("Z") else end.isoformat()
                },
            )
            response.raise_for_status()
            return response.json().get("items", [])

    async def push_event(self, access_token: str, event: dict) -> str:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.BASE_URL}/calendars/primary/events",
                headers={"Authorization": f"Bearer {access_token}"},
                json=event,
            )
            response.raise_for_status()
            return response.json()["id"]

    async def refresh_access_token(self, refresh_token: str) -> tuple[str, datetime]:
        if not settings.google_client_id or not settings.google_client_secret:
            raise ValueError("GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET requis dans .env")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            response.raise_for_status()
            data = response.json()
            new_token = data["access_token"]
            expires_in = data.get("expires_in", 3600)
            expiration = datetime.utcnow() + timedelta(seconds=expires_in)
            return new_token, expiration


class OutlookCalendarProvider(CalendarProvider):
    BASE_URL = "https://graph.microsoft.com/v1.0/me"
    REDIRECT_URI = "http://127.0.0.1:8000/calendar/auth/microsoft/callback"

    def get_auth_url(self, state: str) -> str:
        client_id = settings.microsoft_client_id or ""
        scopes = "offline_access Calendars.ReadWrite"
        return (
            f"https://login.microsoftonline.com/common/oauth2/v2.0/authorize?"
            f"client_id={client_id}&"
            f"response_type=code&"
            f"redirect_uri={self.REDIRECT_URI}&"
            f"scope={scopes}&"
            f"state={state}"
        )

    async def exchange_code(self, code: str) -> tuple[str, str, datetime]:
        if not settings.microsoft_client_id or not settings.microsoft_client_secret:
            raise ValueError("MICROSOFT_CLIENT_ID et MICROSOFT_CLIENT_SECRET requis dans .env")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                data={
                    "client_id": settings.microsoft_client_id,
                    "client_secret": settings.microsoft_client_secret,
                    "code": code,
                    "redirect_uri": self.REDIRECT_URI,
                    "grant_type": "authorization_code",
                },
            )
            response.raise_for_status()
            data = response.json()
            access_token = data["access_token"]
            refresh_token = data.get("refresh_token", "")
            expires_in = data.get("expires_in", 3600)
            expiration = datetime.utcnow() + timedelta(seconds=expires_in)
            return access_token, refresh_token, expiration

    async def fetch_events(self, access_token: str, start: datetime, end: datetime) -> list[dict]:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/calendarview",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"startDateTime": start.isoformat(), "endDateTime": end.isoformat()},
            )
            response.raise_for_status()
            return response.json().get("value", [])

    async def push_event(self, access_token: str, event: dict) -> str:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.BASE_URL}/events",
                headers={"Authorization": f"Bearer {access_token}"},
                json=event,
            )
            response.raise_for_status()
            return response.json()["id"]

    async def refresh_access_token(self, refresh_token: str) -> tuple[str, datetime]:
        if not settings.microsoft_client_id or not settings.microsoft_client_secret:
            raise ValueError("MICROSOFT_CLIENT_ID et MICROSOFT_CLIENT_SECRET requis dans .env")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                data={
                    "client_id": settings.microsoft_client_id,
                    "client_secret": settings.microsoft_client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            response.raise_for_status()
            data = response.json()
            new_token = data["access_token"]
            expires_in = data.get("expires_in", 3600)
            expiration = datetime.utcnow() + timedelta(seconds=expires_in)
            return new_token, expiration


def get_provider(name: str) -> CalendarProvider:
    providers = {"google": GoogleCalendarProvider, "microsoft": OutlookCalendarProvider}
    if name not in providers:
        raise ValueError(f"Provider inconnu : {name}")
    return providers[name]()
