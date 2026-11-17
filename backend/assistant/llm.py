"""
backend/assistant/llm.py
------------------------
Appel du modèle de langage de l'assistant. Sortie JSON structurée (règle de CLAUDE.md) :
Gemini avec response_schema, repli sur OpenRouter en mode JSON. Si aucun fournisseur ne
répond, on lève AssistantUnavailable : l'assistant ne fabrique jamais une réponse de secours.
"""

import asyncio
import re
import json

from google import genai
from google.genai import types

from backend.ai.gemini_client import _call_openrouter
from backend.config import settings


# Délai maximal par fournisseur : au-delà, on passe au suivant (évite une conversation bloquée)
PROVIDER_TIMEOUT_S = 45   # le modèle gratuit OpenRouter peut être lent
MAX_ATTEMPTS = 2          # une nouvelle tentative par fournisseur sur erreur temporaire
RETRY_PAUSE_S = 2


def clean_json_text(raw: str) -> str:
    """Retire les blocs ``` et le texte autour de l'objet JSON."""
    text = (raw or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    return text[start:end + 1] if start != -1 and end > start else text


class AssistantUnavailable(Exception):
    """Aucun fournisseur d'IA n'a répondu."""


ACTION_TYPES = ["create_event", "move_event", "delete_event", "send_email", "schedule_email",
                "create_contact", "create_meeting", "search_emails"]
# Le SDK Gemini réserve la clé "type" dans les schémas : le champ est envoyé sous "kind" et renommé
# en "type" à la réception (voir normalize_actions).
ACTION_FIELDS = ["kind", "ref", "title", "date", "start_time", "end_time", "location", "reason",
                 "to", "cc", "subject", "body", "query", "name", "email", "phone", "company"]

# Schéma en dictionnaire JSON (et non en types.Schema) : avec le SDK google-genai 0.3.0, les objets
# Schema déclenchent une erreur interne lors de la conversion du schéma.
ACTION_ITEM_SCHEMA = {
    "type": "OBJECT",
    "properties": {"kind": {"type": "STRING", "enum": ACTION_TYPES},
                   **{f: {"type": "STRING"} for f in ACTION_FIELDS if f != "kind"}},
    "required": ACTION_FIELDS,
}
RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "reply": {"type": "STRING"},
        "suggestions": {"type": "ARRAY", "items": {"type": "STRING"}},
        "actions": {"type": "ARRAY", "items": ACTION_ITEM_SCHEMA},
    },
    "required": ["reply", "suggestions", "actions"],
}


def _generate_gemini(system: str, conversation: str) -> str:
    client = genai.Client(api_key=settings.gemini_api_key)
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=conversation,
        config=types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_schema=RESPONSE_SCHEMA,
            temperature=0.4,
        ),
    )
    return response.text or ""


def normalize_actions(data: dict) -> dict:
    """Rétablit le champ "type" attendu par le reste de l'application."""
    actions = data.get("actions")
    if isinstance(actions, list):
        for a in actions:
            if isinstance(a, dict) and "kind" in a and "type" not in a:
                a["type"] = a.pop("kind")
    return data


def _parse(raw: str) -> dict:
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        raise AssistantUnavailable("réponse illisible")
    if not isinstance(data, dict):
        raise AssistantUnavailable("réponse illisible")
    return data


async def _attempt(label: str, fn, *args) -> dict:
    """Un appel à un fournisseur. Les erreurs temporaires (délai, surcharge, quota) sont retentées."""
    last = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            raw = await asyncio.wait_for(asyncio.to_thread(fn, *args), PROVIDER_TIMEOUT_S)
            return raw
        except Exception as e:
            last = e
            print(f"[assistant] {label} tentative {attempt} : {type(e).__name__}")
            if attempt < MAX_ATTEMPTS:
                await asyncio.sleep(RETRY_PAUSE_S)
    raise last


async def generate(system: str, conversation: str) -> dict:
    """
    Renvoie le JSON du modèle. Ordre : OpenRouter (prioritaire), puis Gemini ; chacun est
    retenté une fois en cas d'erreur temporaire. Lève AssistantUnavailable sinon.
    """
    if settings.openrouter_api_key:
        try:
            raw = await _attempt("OpenRouter", _call_openrouter, system, conversation + "\n\nRéponds uniquement en JSON.")
            return normalize_actions(_parse(clean_json_text(raw)))
        except Exception:
            pass
    if settings.gemini_api_key:
        try:
            raw = await _attempt("Gemini", _generate_gemini, system, conversation)
            return normalize_actions(_parse(raw))
        except Exception:
            pass
    raise AssistantUnavailable("Aucun service d'IA n'est disponible pour le moment. Réessayez dans un instant.")
