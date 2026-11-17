"""
mail_analyzer.py
----------------
Analyse des emails :
  1. Détection d'événements agendables (réunion, rendez-vous, deadline…)
  2. Génération d'une empreinte sémantique (topic_fingerprint) pour la déduplication
  3. Détection de doublons thématiques entre mails de sources différentes
"""

import json
import re
import logging
from datetime import datetime, date
from typing import Any

from backend.config import settings

logger = logging.getLogger("krono-mail-analyzer")


# ---------------------------------------------------------------------------
# Mots-clés déterministes pour la détection d'événement
# ---------------------------------------------------------------------------
EVENT_KEYWORDS_FR = [
    "réunion", "reunion", "rendez-vous", "rdv", "meeting", "conférence",
    "conference", "webinar", "webinaire", "séminaire", "seminaire",
    "formation", "déjeuner", "dejeuner", "appel", "call", "entretien",
    "interview", "présentation", "presentation", "atelier", "workshop",
    "date limite", "deadline", "échéance", "echeance", "à 9h", "à 10h",
    "à 14h", "à 15h", "à 16h", "le lundi", "le mardi", "le mercredi",
    "le jeudi", "le vendredi", "ce soir", "demain", "la semaine prochaine",
    "vous êtes invité", "vous etes invite", "invitation", "confirmer votre présence",
    "order of the day", "ordre du jour", "agenda"
]

DATE_PATTERN = re.compile(
    r"\b(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{2,4})\b"
    r"|\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)"
    r"|\bdemain\b|\baujourd'hui\b|\bce soir\b|\bla semaine prochaine\b",
    re.IGNORECASE
)
TIME_PATTERN = re.compile(r"\b(\d{1,2})[h:](\d{2})?\b")


# ---------------------------------------------------------------------------
# 1. Détection d'événement (heuristique résiliente)
# ---------------------------------------------------------------------------

def detect_event_heuristic(subject: str, body: str) -> dict[str, Any]:
    """
    Détecte si un mail parle d'un événement agenda.
    Retourne {
        "contains_event": bool,
        "event_title": str | None,
        "event_date": str | None,
        "event_time": str | None,
        "event_location": str | None,
        "event_confidence": float   # 0.0 – 1.0
    }
    """
    text = f"{subject} {body}".lower()

    # Score sur les mots-clés
    matched_kw = [kw for kw in EVENT_KEYWORDS_FR if kw in text]
    kw_score = min(len(matched_kw) / 3.0, 1.0)  # Seuil : 3 mots-clés = confidence 1.0

    # Détection date/heure
    date_matches = DATE_PATTERN.findall(f"{subject} {body}")
    time_matches = TIME_PATTERN.findall(f"{subject} {body}")
    has_date = bool(date_matches)
    has_time = bool(time_matches)

    confidence = kw_score
    if has_date:
        confidence = min(confidence + 0.2, 1.0)
    if has_time:
        confidence = min(confidence + 0.1, 1.0)

    contains_event = confidence >= 0.35

    # Extraction de l'heure (premier match)
    event_time = None
    if time_matches:
        h, m = time_matches[0]
        event_time = f"{int(h):02d}:{int(m) if m else 0:02d}"

    # Titre déduit de l'objet du mail
    event_title = _clean_subject_as_title(subject) if contains_event else None

    # Localisation (heuristique simple)
    location_match = re.search(
        r"(?:salle|room|bureau|office|en ligne|online|zoom|teams|meet|lieu\s*:\s*)([^\.,\n]{3,50})",
        f"{subject} {body}", re.IGNORECASE
    )
    event_location = location_match.group(1).strip() if location_match else None

    # Date ISO (si numérique trouvée)
    event_date = None
    for match in date_matches:
        d, m_num, y, *_ = match
        if d and m_num:
            try:
                year = int(y) if len(y) == 4 else 2000 + int(y)
                event_date = f"{year}-{int(m_num):02d}-{int(d):02d}"
                break
            except Exception:
                pass

    return {
        "contains_event": contains_event,
        "event_title": event_title,
        "event_date": event_date,
        "event_time": event_time,
        "event_location": event_location,
        "event_confidence": round(confidence, 2),
    }


async def detect_event_with_ai(subject: str, body: str, today_iso: str) -> dict[str, Any]:
    """
    Analyse IA (Gemini/Claude) pour détecter un événement dans un mail.
    Retourne le même format que detect_event_heuristic.
    Falls back to heuristic if AI is unavailable.
    """
    # --- Tentative IA ---
    try:
        from backend.ai.gemini_client import (
            _openrouter_client,
            _call_openrouter,
            _client,
            _call_claude_messages,
            settings as ai_settings,
            _clean_and_parse_json,
        )

        MAIL_EVENT_SCHEMA = {
            "type": "object",
            "properties": {
                "contains_event": {"type": "boolean"},
                "event_title": {"type": "string"},
                "event_date": {"type": "string", "description": "Date ISO 8601, ex: 2026-10-15"},
                "event_time": {"type": "string", "description": "HH:MM"},
                "event_location": {"type": "string"},
                "event_confidence": {"type": "number", "description": "0.0 à 1.0"},
            },
            "required": ["contains_event", "event_confidence"],
        }

        MAIL_SYS = (
            f"Tu es un assistant agenda. Date du jour : {today_iso}. "
            "Analyse cet email et détermine s'il mentionne un événement à inscrire "
            "sur un agenda (réunion, RDV, deadline, invitation…). "
            "Réponds UNIQUEMENT en JSON valide selon ce schéma, sans code markdown ni texte additionnel :\n"
            + json.dumps(MAIL_EVENT_SCHEMA)
        )
        user_prompt = f"Objet: {subject}\n\nCorps:\n{body[:1500]}"

        # 1. OpenRouter (prioritaire)
        if _openrouter_client and ai_settings.openrouter_api_key:
            try:
                raw = _call_openrouter(MAIL_SYS, user_prompt)
                return _clean_and_parse_json(raw)
            except Exception as e:
                logger.warning(f"[MailAnalyzer] OpenRouter en échec ({e}), bascule...")

        # 2. Claude
        if ai_settings.anthropic_api_key:
            try:
                raw = _call_claude_messages(
                    MAIL_SYS + "\nSchéma: " + json.dumps(MAIL_EVENT_SCHEMA),
                    user_prompt,
                )
                return _clean_and_parse_json(raw)
            except Exception:
                pass

        # 3. Gemini
        if _client and ai_settings.gemini_api_key:
            from google.genai import types
            response = _client.models.generate_content(
                model=ai_settings.gemini_model,
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=MAIL_SYS,
                    response_mime_type="application/json",
                    response_schema=MAIL_EVENT_SCHEMA,
                ),
            )
            return _clean_and_parse_json(response.text)

    except Exception as e:
        logger.warning(f"[MailAnalyzer] IA indisponible, repli heuristique ({e})")


    return detect_event_heuristic(subject, body)


# ---------------------------------------------------------------------------
# 2. Empreinte sémantique (topic fingerprint)
# ---------------------------------------------------------------------------

# Mots vides français courants et formules de politesse / remplissage de courriels
STOPWORDS_FR = {
    "le", "la", "les", "de", "du", "des", "un", "une", "et", "en", "au",
    "aux", "à", "a", "pour", "par", "sur", "sous", "dans", "avec", "sans",
    "est", "sont", "sera", "serait", "être", "avoir", "que", "qui", "quoi",
    "dont", "où", "ou", "si", "car", "donc", "mais", "or", "ni", "je",
    "tu", "il", "elle", "nous", "vous", "ils", "elles", "on", "se", "me",
    "te", "lui", "leur", "y", "en", "ce", "cet", "cette", "ces", "mon",
    "ton", "son", "ma", "ta", "sa", "nos", "vos", "leurs", "notre", "votre",
    "re", "bonjour", "bonsoir", "cordialement", "merci", "salut", "hello",
    "hi", "objet", "sujet", "fw", "fwd", "re", "tr", "réponse", "reponse",
    "suite", "point", "devons", "doit", "détails", "details", "concernant",
    "ainsi", "transfère", "transfere", "vers", "ici", "dici", "fin", "mois",
    "jour", "jours", "semaine", "heure", "heures", "fois", "comme", "aussi",
    "bien", "très", "plus", "tout", "tous", "toutes", "autre", "autres",
    "meme", "même", "faire", "fait",
}

def build_topic_fingerprint(subject: str, body: str) -> str:
    """
    Extrait les mots-clés significatifs du mail (objet + début du corps)
    et retourne une chaîne JSON de mots triés pour la comparaison.
    """
    text = f"{subject} {body[:800]}"
    # Tokenisation simple
    tokens = re.findall(r"\b[a-zA-ZÀ-ÖØ-öø-ÿ]{3,}\b", text.lower())
    # Filtrage stopwords + déduplication + tri
    keywords = sorted(set(t for t in tokens if t not in STOPWORDS_FR))
    return json.dumps(keywords[:60])  # Max 60 mots-clés


def compute_similarity(fp1: str, fp2: str) -> float:
    """
    Calcule un score de similarité (Jaccard) entre deux fingerprints JSON.
    Retourne un float entre 0.0 et 1.0.
    """
    try:
        set1 = set(json.loads(fp1))
        set2 = set(json.loads(fp2))
        if not set1 and not set2:
            return 0.0
        intersection = set1 & set2
        union = set1 | set2
        return round(len(intersection) / len(union), 3)
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# 3. Détection de doublons thématiques cross-canaux
# ---------------------------------------------------------------------------

DUPLICATE_THRESHOLD = 0.35  # Score Jaccard minimum pour signaler un doublon


def find_duplicates(
    new_message: dict[str, Any],
    existing_messages: list[dict[str, Any]],
    same_day_only: bool = True,
    threshold: float = DUPLICATE_THRESHOLD,
) -> list[dict[str, Any]]:
    """
    Compare `new_message` avec les messages existants et retourne la liste
    des doublons potentiels.

    Args:
        new_message: dict avec au moins {"id", "provider", "subject", "topic_fingerprint", "received_at"}
        existing_messages: idem
        same_day_only: si True, compare seulement les mails reçus le même jour calendaire

    Retourne:
        [{"message_id": UUID, "similarity_score": float, "summary": str}, ...]
    """
    duplicates = []
    new_fp = new_message.get("topic_fingerprint") or ""
    new_provider = new_message.get("provider", "")
    new_date = _get_date(new_message.get("received_at"))

    for existing in existing_messages:
        # Ne pas comparer un message avec lui-même
        if existing.get("id") == new_message.get("id"):
            continue

        # Option : même période (même jour ou moins de 24h d'écart)
        if same_day_only:
            existing_date = _get_date(existing.get("received_at"))
            dt1 = new_message.get("received_at")
            dt2 = existing.get("received_at")
            within_24h = False
            if isinstance(dt1, datetime) and isinstance(dt2, datetime):
                within_24h = abs((dt1 - dt2).total_seconds()) <= 86400
            elif isinstance(dt1, str) and isinstance(dt2, str):
                try:
                    d1_parsed = datetime.fromisoformat(dt1.replace("Z", "+00:00"))
                    d2_parsed = datetime.fromisoformat(dt2.replace("Z", "+00:00"))
                    within_24h = abs((d1_parsed - d2_parsed).total_seconds()) <= 86400
                except Exception:
                    pass

            if new_date and existing_date and new_date != existing_date and not within_24h:
                continue

        existing_fp = existing.get("topic_fingerprint") or ""
        score = compute_similarity(new_fp, existing_fp)

        if score >= threshold:
            summary = _build_duplicate_summary(new_message, existing, score)
            duplicates.append({
                "message_id": str(existing.get("id")),
                "similarity_score": score,
                "summary": summary,
                "provider_a": new_provider,
                "provider_b": existing.get("provider", ""),
                "subject_a": new_message.get("subject", ""),
                "subject_b": existing.get("subject", ""),
            })

    return duplicates


def _get_date(dt: Any) -> date | None:
    if isinstance(dt, datetime):
        return dt.date()
    if isinstance(dt, date):
        return dt
    if isinstance(dt, str):
        try:
            return datetime.fromisoformat(dt.replace("Z", "+00:00")).date()
        except Exception:
            pass
    return None


def _build_duplicate_summary(msg_a: dict, msg_b: dict, score: float) -> str:
    provider_labels = {"google": "Gmail", "microsoft": "Outlook"}
    pa = provider_labels.get(msg_a.get("provider", ""), msg_a.get("provider", "?"))
    pb = provider_labels.get(msg_b.get("provider", ""), msg_b.get("provider", "?"))
    sa = msg_a.get("subject", "?")
    sb = msg_b.get("subject", "?")
    pct = int(score * 100)
    return (
        f"⚠️ Doublon détecté ({pct}% de similarité) : "
        f"Un mail {pa} « {sa} » et un mail {pb} « {sb} » "
        f"semblent traiter du même sujet."
    )


# ---------------------------------------------------------------------------
# Helpers internes
# ---------------------------------------------------------------------------

def _clean_subject_as_title(subject: str) -> str:
    """Supprime les préfixes Re:/Fwd: et nettoie l'objet pour en faire un titre."""
    cleaned = re.sub(r"^(re|fwd?|tr|réf?|ref|rép?|rep)\s*:\s*", "", subject, flags=re.IGNORECASE).strip()
    return cleaned[:255] if cleaned else subject[:255]
