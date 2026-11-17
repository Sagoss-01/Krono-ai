"""
mail_reader.py
--------------
Lecture des emails entrants depuis Gmail (Google) et Outlook (Microsoft)
via leurs API respectives, en utilisant les tokens OAuth2 déjà stockés
dans la table `calendar_links`.
"""

import base64
import logging
from datetime import datetime, timedelta
from typing import Any

import httpx

logger = logging.getLogger("krono-mail-reader")

# Nombre max de mails récupérés par appel
MAX_EMAILS = 20
# Fenêtre temporelle par défaut (dernières 24h)
DEFAULT_HOURS_BACK = 24


# ---------------------------------------------------------------------------
# Gmail
# ---------------------------------------------------------------------------

async def fetch_gmail_messages(access_token: str, hours_back: int = DEFAULT_HOURS_BACK) -> list[dict[str, Any]]:
    """
    Récupère les derniers emails Gmail via l'API Gmail.
    Retourne une liste de dicts normalisés :
    {
        "external_id", "provider", "sender", "subject",
        "snippet", "body_text", "received_at"
    }
    """
    since = datetime.utcnow() - timedelta(hours=hours_back)
    # Filtre Gmail (epoch seconds)
    since_epoch = int(since.timestamp())

    headers = {"Authorization": f"Bearer {access_token}"}
    results: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=15.0) as client:
        # 1. Lister les IDs des messages récents
        list_resp = await client.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            headers=headers,
            params={
                "maxResults": MAX_EMAILS,
                "q": f"after:{since_epoch}",
            },
        )
        list_resp.raise_for_status()
        messages_meta = list_resp.json().get("messages", [])

        # 2. Récupérer le détail de chaque message
        for meta in messages_meta:
            msg_id = meta["id"]
            try:
                detail_resp = await client.get(
                    f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}",
                    headers=headers,
                    params={"format": "full"},
                )
                detail_resp.raise_for_status()
                data = detail_resp.json()

                headers_list = data.get("payload", {}).get("headers", [])
                headers_map = {h["name"].lower(): h["value"] for h in headers_list}

                sender = headers_map.get("from", "")
                subject = headers_map.get("subject", "(sans objet)")
                date_str = headers_map.get("date", "")

                # Parsing de la date
                received_at = _parse_email_date(date_str)

                snippet = data.get("snippet", "")
                body_text = _extract_gmail_body(data.get("payload", {}))

                results.append({
                    "external_id": msg_id,
                    "provider": "google",
                    "sender": sender,
                    "subject": subject,
                    "snippet": snippet,
                    "body_text": body_text[:3000],  # tronqué à 3000 chars
                    "received_at": received_at,
                })
            except Exception as e:
                logger.warning(f"[Gmail] Erreur sur message {msg_id}: {e}")
                continue

    return results


def _extract_gmail_body(payload: dict) -> str:
    """Extrait récursivement le corps texte d'un payload Gmail."""
    body_data = payload.get("body", {}).get("data", "")
    if body_data:
        try:
            return base64.urlsafe_b64decode(body_data + "==").decode("utf-8", errors="replace")
        except Exception:
            pass

    for part in payload.get("parts", []):
        mime = part.get("mimeType", "")
        if mime == "text/plain":
            data = part.get("body", {}).get("data", "")
            if data:
                try:
                    return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
                except Exception:
                    pass
        elif mime.startswith("multipart"):
            result = _extract_gmail_body(part)
            if result:
                return result
    return ""


# ---------------------------------------------------------------------------
# Outlook / Microsoft Graph
# ---------------------------------------------------------------------------

async def fetch_outlook_messages(access_token: str, hours_back: int = DEFAULT_HOURS_BACK) -> list[dict[str, Any]]:
    """
    Récupère les derniers emails Outlook via Microsoft Graph.
    Retourne une liste de dicts normalisés identiques à Gmail.
    """
    since = (datetime.utcnow() - timedelta(hours=hours_back)).strftime("%Y-%m-%dT%H:%M:%SZ")
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    results: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            "https://graph.microsoft.com/v1.0/me/messages",
            headers=headers,
            params={
                "$top": MAX_EMAILS,
                "$filter": f"receivedDateTime ge {since}",
                "$select": "id,subject,from,receivedDateTime,bodyPreview,body",
                "$orderby": "receivedDateTime desc",
            },
        )
        resp.raise_for_status()
        items = resp.json().get("value", [])

        for item in items:
            sender_obj = item.get("from", {}).get("emailAddress", {})
            sender = f"{sender_obj.get('name', '')} <{sender_obj.get('address', '')}>"
            subject = item.get("subject", "(sans objet)")
            snippet = item.get("bodyPreview", "")
            body_text = item.get("body", {}).get("content", "")
            received_str = item.get("receivedDateTime", "")
            received_at = None
            if received_str:
                try:
                    received_at = datetime.fromisoformat(received_str.replace("Z", "+00:00"))
                except Exception:
                    pass

            results.append({
                "external_id": item.get("id", ""),
                "provider": "microsoft",
                "sender": sender,
                "subject": subject,
                "snippet": snippet,
                "body_text": body_text[:3000],
                "received_at": received_at,
            })

    return results


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_email_date(date_str: str) -> datetime | None:
    """Essaie plusieurs formats de date RFC2822 courants."""
    import email.utils
    if not date_str:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(date_str)
        return parsed.replace(tzinfo=None)  # Stockage UTC naïf
    except Exception:
        return None
