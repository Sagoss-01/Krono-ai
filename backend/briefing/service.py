"""
service.py (briefing)
---------------------
Génération du Briefing Matinal intelligent :
Analyse des événements du jour, calcul des alertes de départ et synthèse vocale IA.
"""

from datetime import datetime, date, time, timedelta, timezone
from typing import Dict, Any, List, Optional
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.models.db_models import User, Event, ConstraintType
from backend.ai.gemini_client import _openrouter_client, _call_openrouter, _client, _clean_and_parse_json
from google.genai import types


async def get_day_events(user_id, target_date: date, db: AsyncSession) -> List[Event]:
    """Récupère les événements de l'utilisateur pour une journée donnée, triés par heure."""
    start_of_day = datetime.combine(target_date, time.min)
    end_of_day = datetime.combine(target_date, time.max)

    stmt = (
        select(Event)
        .where(
            Event.owner_id == user_id,
            Event.start_time >= start_of_day,
            Event.start_time <= end_of_day,
        )
        .order_by(Event.start_time.asc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


def _build_heuristic_briefing(user_name: str, target_date: date, events: List[Event]) -> Dict[str, Any]:
    """Synthèse déterministe de repli sans dépendance externe."""
    date_str_fr = target_date.strftime("%d/%m/%Y")
    count = len(events)

    if count == 0:
        speech = f"Bonjour {user_name} ! Vous n'avez aucun événement prévu dans votre agenda aujourd'hui. Profitez-en pour vous détendre ou avancer sur vos projets personnels !"
        return {
            "greeting": f"Bonjour {user_name} !",
            "target_date": target_date.isoformat(),
            "speech_text": speech,
            "events_count": 0,
            "total_hours": 0.0,
            "highlights": ["Aucun événement au planning", "Journée totalement libre"],
            "departure_alert": None,
            "productivity_tip": "Une journée dégagée est idéale pour le travail de fond et la récupération.",
            "timeline": [],
        }

    total_mins = sum((e.end_time - e.start_time).total_seconds() / 60 for e in events)
    total_hours = round(total_mins / 60, 1)

    first = events[0]
    first_time = first.start_time.strftime("%H:%M")

    # Détection transport premier événement avec lieu
    departure_alert = None
    if first.location:
        dep_time = (first.start_time - timedelta(minutes=25)).strftime("%H:%M")
        departure_alert = {
            "event_title": first.title,
            "location": first.location,
            "start_time": first_time,
            "recommended_departure": dep_time,
            "estimated_travel_minutes": 25,
        }

    speech_parts = [
        f"Bonjour {user_name} ! Voici votre briefing pour aujourd'hui, le {date_str_fr}.",
        f"Vous avez {count} événement{'s' if count > 1 else ''} au programme, représentant environ {total_hours} heure{'s' if total_hours > 1 else ''} d'activité.",
        f"Votre première séance est « {first.title} » à {first_time}{' à ' + first.location if first.location else ''}.",
    ]
    if departure_alert:
        speech_parts.append(f"Prévoyez de partir vers {departure_alert['recommended_departure']} pour arriver sereinement.")

    speech_parts.append("Passez une excellente et productive journée !")
    speech = " ".join(speech_parts)

    timeline = []
    for e in events:
        timeline.append({
            "id": str(e.id),
            "title": e.title,
            "start_time": e.start_time.strftime("%H:%M"),
            "end_time": e.end_time.strftime("%H:%M"),
            "location": e.location or "",
            "constraint_type": e.constraint_type.value if hasattr(e.constraint_type, "value") else str(e.constraint_type),
            "type": "event",
        })

    return {
        "greeting": f"Bonjour {user_name} !",
        "target_date": target_date.isoformat(),
        "speech_text": speech,
        "events_count": count,
        "total_hours": total_hours,
        "highlights": [
            f"{count} événement{'s' if count > 1 else ''} planifié{'s' if count > 1 else ''} ({total_hours}h au total)",
            f"Premier rendez-vous à {first_time} : {first.title}",
        ],
        "departure_alert": departure_alert,
        "productivity_tip": "Commencez par la tâche la plus exigeante pendant votre pic d'énergie matinal.",
        "timeline": timeline,
    }


async def generate_morning_briefing(
    user: User,
    db: AsyncSession,
    target_date_iso: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Construit le Briefing Matinal complet avec analyse des événements et texte fluide pour synthèse vocale.
    """
    if target_date_iso:
        try:
            target_date = datetime.fromisoformat(target_date_iso).date()
        except ValueError:
            target_date = date.today()
    else:
        target_date = date.today()

    user_name = user.full_name or user.email.split("@")[0].capitalize()

    # 1. Événements en base
    events = await get_day_events(user.id, target_date, db)

    # Base heuristique garantie
    base_briefing = _build_heuristic_briefing(user_name, target_date, events)

    # 2. Enrichissement via IA (OpenRouter ou Gemini Flash)
    if events and (settings.openrouter_api_key or settings.gemini_api_key):
        events_summary = []
        for e in events:
            events_summary.append({
                "title": e.title,
                "start": e.start_time.strftime("%H:%M"),
                "end": e.end_time.strftime("%H:%M"),
                "location": e.location or "Non précisé",
                "constraint": e.constraint_type.value if hasattr(e.constraint_type, "value") else str(e.constraint_type),
            })

        prompt_sys = (
            "Tu es Krono AI, un assistant personnel et agenda intelligent chaleureux, concis et proactif. "
            "Génère un briefing matinal dynamique en français pour l'utilisateur. "
            "Le champ 'speech_text' doit être rédigé pour une lecture orale naturelle et motivante (style animateur ou coach bienveillant, 3 à 5 phrases percutantes). "
            "Réponds UNIQUEMENT par un objet JSON avec exactement ces clés :\n"
            "- 'greeting': salutation (ex: 'Bonjour Jean !')\n"
            "- 'speech_text': texte complet à vocaliser\n"
            "- 'highlights': liste de 3 points clés concis\n"
            "- 'productivity_tip': une courte pensée positive ou conseil d'organisation\n"
        )

        user_prompt = (
            f"Utilisateur : {user_name}\n"
            f"Date : {target_date.strftime('%A %d %B %Y')}\n"
            f"Événements du jour ({len(events)}) :\n{json.dumps(events_summary, ensure_ascii=False)}"
        )

        data = None
        # Essai OpenRouter
        if _openrouter_client and settings.openrouter_api_key:
            try:
                raw = _call_openrouter(prompt_sys, user_prompt)
                data = _clean_and_parse_json(raw)
            except Exception as e:
                print(f"[briefing] OpenRouter indisponible ({e}), bascule vers Gemini...")

        # Essai Gemini
        if not data and _client and settings.gemini_api_key:
            try:
                briefing_schema = {
                    "type": "object",
                    "properties": {
                        "greeting": {"type": "string"},
                        "speech_text": {"type": "string"},
                        "highlights": {"type": "array", "items": {"type": "string"}},
                        "productivity_tip": {"type": "string"},
                    },
                    "required": ["greeting", "speech_text", "highlights", "productivity_tip"]
                }
                resp = _client.models.generate_content(
                    model=settings.gemini_model,
                    contents=user_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=prompt_sys,
                        response_mime_type="application/json",
                        response_schema=briefing_schema,
                    ),
                )
                data = json.loads(resp.text)
            except Exception as e:
                print(f"[briefing] Gemini indisponible ({e}), maintien du briefing heuristique...")

        if data:
            if data.get("speech_text"):
                base_briefing["speech_text"] = data["speech_text"]
            if data.get("greeting"):
                base_briefing["greeting"] = data["greeting"]
            if data.get("highlights"):
                base_briefing["highlights"] = data["highlights"]
            if data.get("productivity_tip"):
                base_briefing["productivity_tip"] = data["productivity_tip"]

    return base_briefing
