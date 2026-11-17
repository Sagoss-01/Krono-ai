"""
backend/google_workspace/google_api.py
--------------------------------------
Client Google : connexion du compte, agenda (import) et Gmail (lecture, recherche, envoi).

Sécurité :
- le paramètre `state` de l'OAuth est SIGNÉ (JWT court, 10 minutes, finalité dédiée) : un
  tiers ne peut pas lier un compte Google à un autre utilisateur en forgeant cet identifiant ;
- les jetons sont chiffrés (Fernet) avant stockage, et jamais renvoyés au navigateur ;
- les scopes demandés sont les plus étroits possibles (événements, Gmail lecture et envoi).

Limites : Gmail ne permet pas de programmer un envoi ; l'envoi différé est géré par le
worker de Krono (backend/workers). L'import d'agenda lit l'agenda principal, 60 jours en avant.
"""

import base64
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

import httpx
import jwt

from backend.auth.security import decrypt_token, encrypt_token
from backend.config import settings

REDIRECT_URI = "http://127.0.0.1:8000/calendar/auth/google/callback"
SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]
STATE_PURPOSE = "google_oauth_state"
CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"
GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
IMPORT_DAYS_BACK = 7
IMPORT_DAYS_FORWARD = 60
MAX_BODY = 20_000


class GoogleError(Exception):
    """Erreur présentable à l'utilisateur."""


# ─── Connexion OAuth ─────────────────────────────────────────────────────────

def make_state(user_id: str) -> str:
    payload = {"sub": str(user_id), "purpose": STATE_PURPOSE,
               "exp": datetime.now(timezone.utc) + timedelta(minutes=10)}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def read_state(state: str) -> str:
    try:
        payload = jwt.decode(state, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        raise GoogleError("Connexion Google expirée ou invalide. Recommencez.")
    if payload.get("purpose") != STATE_PURPOSE:
        raise GoogleError("Connexion Google invalide. Recommencez.")
    return payload["sub"]


def build_auth_url(user_id: str) -> str:
    if not settings.google_client_id or not settings.google_client_secret:
        raise GoogleError("GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET doivent être renseignés dans .env.")
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",          # garantit un refresh_token
        "include_granted_scopes": "true",
        "state": make_state(user_id),
    }
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)


async def exchange_code(code: str) -> dict:
    """Échange le code contre des jetons. Renvoie access_token, refresh_token, expires_at, scope, email."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(TOKEN_URL, data={
            "client_id": settings.google_client_id, "client_secret": settings.google_client_secret,
            "code": code, "redirect_uri": REDIRECT_URI, "grant_type": "authorization_code",
        })
        if resp.status_code != 200:
            raise GoogleError("Google a refusé la connexion. Recommencez ou vérifiez les autorisations.")
        data = resp.json()
        access = data["access_token"]
        info = await client.get(USERINFO_URL, headers={"Authorization": f"Bearer {access}"})
        email = info.json().get("email") if info.status_code == 200 else None
    return {
        "access_token": access,
        "refresh_token": data.get("refresh_token"),
        "expires_at": datetime.utcnow() + timedelta(seconds=int(data.get("expires_in", 3600))),
        "scope": data.get("scope", ""),
        "email": email,
    }


async def refresh(refresh_token: str) -> tuple[str, datetime]:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(TOKEN_URL, data={
            "client_id": settings.google_client_id, "client_secret": settings.google_client_secret,
            "refresh_token": refresh_token, "grant_type": "refresh_token",
        })
        if resp.status_code != 200:
            raise GoogleError("Le jeton Google a expiré : reconnectez votre compte Google.")
        data = resp.json()
    return data["access_token"], datetime.utcnow() + timedelta(seconds=int(data.get("expires_in", 3600)))


async def valid_access_token(db, link) -> str:
    """Jeton d'accès utilisable : rafraîchi (et re-chiffré) s'il expire dans moins d'une minute."""
    expires = link.token_expires_at
    if expires is None or datetime.utcnow() >= expires - timedelta(minutes=1):
        if not link.encrypted_refresh_token:
            raise GoogleError("Reconnectez votre compte Google : aucun jeton de renouvellement.")
        new_access, new_expiry = await refresh(decrypt_token(link.encrypted_refresh_token))
        link.encrypted_access_token = encrypt_token(new_access)
        link.token_expires_at = new_expiry
        await db.commit()
    return decrypt_token(link.encrypted_access_token)


def has_scope(link, scope_fragment: str) -> bool:
    return scope_fragment in (link.scopes or "")


# ─── Agenda ──────────────────────────────────────────────────────────────────

def _rfc3339(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


async def list_calendar_events(access: str, time_min: datetime, time_max: datetime) -> list[dict]:
    """Tous les événements de l'agenda principal sur la période (pagination et récurrences développées)."""
    items: list[dict] = []
    page_token = None
    async with httpx.AsyncClient(timeout=20) as client:
        while True:
            params = {"timeMin": _rfc3339(time_min), "timeMax": _rfc3339(time_max),
                      "singleEvents": "true", "orderBy": "startTime", "maxResults": 250}
            if page_token:
                params["pageToken"] = page_token
            resp = await client.get(f"{CALENDAR_BASE}/calendars/primary/events",
                                    headers={"Authorization": f"Bearer {access}"}, params=params)
            if resp.status_code != 200:
                raise GoogleError("Impossible de lire l'agenda Google.")
            data = resp.json()
            items.extend(data.get("items", []))
            page_token = data.get("nextPageToken")
            if not page_token or len(items) >= 2000:
                break
    return items


def import_window() -> tuple[datetime, datetime]:
    now = datetime.utcnow()
    return now - timedelta(days=IMPORT_DAYS_BACK), now + timedelta(days=IMPORT_DAYS_FORWARD)


def parse_google_event(item: dict) -> dict | None:
    """Événement Google -> dict {external_id, title, start, end, location} (heures locales naïves)."""
    if item.get("status") == "cancelled":
        return None
    start_raw = item.get("start", {}).get("dateTime") or item.get("start", {}).get("date")
    end_raw = item.get("end", {}).get("dateTime") or item.get("end", {}).get("date")
    if not start_raw or not end_raw:
        return None
    start = _to_naive(start_raw)
    end = _to_naive(end_raw)
    if end <= start:
        end = start + timedelta(minutes=30)
    return {
        "external_id": item.get("id"),
        "title": (item.get("summary") or "Événement sans titre")[:255],
        "start": start, "end": end,
        "location": (item.get("location") or "")[:255] or None,
    }


def _to_naive(value: str) -> datetime:
    if len(value) == 10:  # journée entière
        return datetime.fromisoformat(value)
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


# ─── Gmail ───────────────────────────────────────────────────────────────────

def _header(headers: list[dict], name: str) -> str:
    for h in headers or []:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


async def gmail_search(access: str, query: str, limit: int = 10) -> list[dict]:
    """Recherche Gmail (syntaxe Gmail native : from:, subject:, is:unread, after:...)."""
    async with httpx.AsyncClient(timeout=20) as client:
        headers = {"Authorization": f"Bearer {access}"}
        resp = await client.get(f"{GMAIL_BASE}/messages", headers=headers,
                                params={"q": query, "maxResults": max(1, min(limit, 20))})
        if resp.status_code != 200:
            raise GoogleError("La recherche Gmail a échoué.")
        ids = [m["id"] for m in resp.json().get("messages", [])]
        results = []
        for mid in ids:
            meta = await client.get(f"{GMAIL_BASE}/messages/{mid}", headers=headers, params={
                "format": "metadata", "metadataHeaders": ["From", "To", "Subject", "Date"]})
            if meta.status_code != 200:
                continue
            m = meta.json()
            h = m.get("payload", {}).get("headers", [])
            results.append({
                "id": mid, "thread_id": m.get("threadId"),
                "from": _header(h, "From")[:200], "subject": _header(h, "Subject")[:200],
                "date": _header(h, "Date")[:60], "snippet": (m.get("snippet") or "")[:300],
            })
    return results


def _extract_text(payload: dict) -> str:
    """Texte brut d'un message Gmail : première partie text/plain, sinon HTML réduit en texte."""
    def walk(part, want):
        if part.get("mimeType") == want and part.get("body", {}).get("data"):
            return base64.urlsafe_b64decode(part["body"]["data"] + "==").decode("utf-8", "replace")
        for sub in part.get("parts", []) or []:
            found = walk(sub, want)
            if found:
                return found
        return ""
    text = walk(payload, "text/plain")
    if not text:
        html = walk(payload, "text/html")
        text = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
        text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"[ \t]+", " ", text).strip()[:MAX_BODY]


async def gmail_get(access: str, message_id: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]{4,64}", message_id or ""):
        raise GoogleError("Identifiant de message invalide.")
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(f"{GMAIL_BASE}/messages/{message_id}",
                                headers={"Authorization": f"Bearer {access}"}, params={"format": "full"})
        if resp.status_code != 200:
            raise GoogleError("Message introuvable.")
        m = resp.json()
    h = m.get("payload", {}).get("headers", [])
    return {
        "id": message_id, "thread_id": m.get("threadId"),
        "from": _header(h, "From"), "to": _header(h, "To"), "cc": _header(h, "Cc"),
        "subject": _header(h, "Subject"), "date": _header(h, "Date"),
        "message_id": _header(h, "Message-ID"), "references": _header(h, "References"),
        "text": _extract_text(m.get("payload", {})),
    }


def build_mime(*, sender: str, to: list[str], cc: list[str], subject: str, body: str,
               in_reply_to: str | None = None, references: str | None = None) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=sender.split("@", 1)[1])
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = f"{references} {in_reply_to}".strip() if references else in_reply_to
    msg.set_content(body)
    return msg


async def gmail_send(access: str, mime: EmailMessage, thread_id: str | None = None) -> str:
    raw = base64.urlsafe_b64encode(mime.as_bytes()).decode("ascii")
    payload = {"raw": raw}
    if thread_id:
        payload["threadId"] = thread_id
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{GMAIL_BASE}/messages/send",
                                 headers={"Authorization": f"Bearer {access}"}, json=payload)
        if resp.status_code == 403:
            raise GoogleError("Gmail refuse l'envoi : autorisez l'envoi de mail pour votre compte Google.")
        if resp.status_code != 200:
            raise GoogleError("Gmail n'a pas accepté l'envoi.")
        return resp.json().get("id", "")
