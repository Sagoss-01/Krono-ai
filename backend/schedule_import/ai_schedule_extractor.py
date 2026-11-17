"""
ai_schedule_extractor.py
-------------------------
Moteur d'extraction IA spécialisé dans l'analyse sémantique et la conversion
d'emplois du temps (académiques, professionnels, personnels) en événements d'agenda exploitables.
"""

import json
import re
from datetime import datetime, date, timedelta
from typing import Dict, Any, List, Optional

from backend.config import settings
from backend.ai.gemini_client import _openrouter_client, _call_openrouter, _clean_and_parse_json

DAYS_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
DAY_INDEX_MAP = {
    "lundi": 0, "lun": 0, "mon": 0, "monday": 0,
    "mardi": 1, "mar": 1, "tue": 1, "tuesday": 1,
    "mercredi": 2, "mer": 2, "wed": 2, "wednesday": 2,
    "jeudi": 3, "jeu": 3, "thu": 3, "thursday": 3,
    "vendredi": 4, "ven": 4, "fri": 4, "friday": 4,
    "samedi": 5, "sam": 5, "sat": 5, "saturday": 5,
    "dimanche": 6, "dim": 6, "sun": 6, "sunday": 6,
}

SCHEDULE_ITEMS_SCHEMA = {
    "type": "object",
    "properties": {
        "schedule_title": {
            "type": "string",
            "description": "Titre global ou filière de l'emploi du temps (ex: 'Emploi du temps - Licence Informatique')"
        },
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Intitulé du cours, matière, séance ou réunion"},
                    "day_of_week": {
                        "type": "string",
                        "enum": ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"],
                        "description": "Jour de la semaine"
                    },
                    "specific_date": {
                        "type": "string",
                        "description": "Date explicite YYYY-MM-DD si mentionnée dans le document, sinon null"
                    },
                    "start_time": {"type": "string", "description": "Heure de début au format strict HH:MM (ex: 08:30)"},
                    "end_time": {"type": "string", "description": "Heure de fin au format strict HH:MM (ex: 10:30)"},
                    "location": {"type": "string", "description": "Salle, amphithéâtre, bâtiment ou visio (ex: 'Amphi B', 'Salle 204')"},
                    "description": {"type": "string", "description": "Enseignant, intervenant, groupe ou type de séance (CM, TD, TP)"},
                    "constraint_type": {
                        "type": "string",
                        "enum": ["hard", "soft"],
                        "description": "hard pour cours/examen/réunion obligatoire, soft pour révisions/optionnel"
                    }
                },
                "required": ["title", "day_of_week", "start_time", "end_time"]
            }
        }
    },
    "required": ["items"]
}

SYSTEM_INSTRUCTION = """Tu es un expert en extraction et structuration d'emplois du temps (cours universitaires, lycées, plannings professionnels, programmes de formations).
Ta tâche : analyser rigoureusement le document fourni (texte, tableau ou image d'emploi du temps) et en extraire CHAQUE cours, séance, TD, TP ou réunion.

RÈGLES D'EXTRACTION :
1. Pour chaque créneau trouvé, identifie :
   - Le jour de la semaine (Lundi, Mardi, Mercredi, Jeudi, Vendredi, Samedi ou Dimanche).
   - L'heure de début et l'heure de fin au format HH:MM (ex: '08:00', '10:15', '14:00', '17:30'). Si seule l'heure de début est connue, prévois une durée standard de 1h30 (90 min).
   - Le titre exact de la matière ou du cours.
   - La salle de cours ou le lieu dans le champ 'location' (ex: 'Amphi A', 'Salle Info 2', 'Bâtiment C').
   - L'enseignant ou les informations complémentaires dans 'description'.
   - 'constraint_type' : mettre 'hard' par défaut pour les cours et réunions.
2. Si le document contient un tableau où les colonnes sont les jours et les lignes sont les heures (ou inversement), reconstitue fidèlement chaque bloc horaire.
3. Réponds UNIQUEMENT par un objet JSON valide conforme au schéma, sans syntaxe markdown (pas de ```json), sans texte avant ou après."""


def _get_monday_of_week(ref_date: date) -> date:
    """Retourne le lundi de la semaine contenant ref_date."""
    return ref_date - timedelta(days=ref_date.weekday())


def _normalize_time(t_str: str) -> str:
    """Normalise une chaîne d'heure en format strict HH:MM."""
    clean = t_str.strip().lower().replace("h", ":").replace(".", ":")
    m = re.match(r"^(\d{1,2}):?(\d{2})?$", clean)
    if m:
        h = int(m.group(1))
        mins = int(m.group(2)) if m.group(2) else 0
        return f"{h:02d}:{mins:02d}"
    return "09:00"


def _heuristic_schedule_fallback(text: str) -> List[Dict[str, Any]]:
    """
    Détecteur heuristique de repli par expressions régulières
    si l'appel au modèle d'IA est inaccessible.
    """
    items = []
    lines = text.split("\n")
    current_day = "Lundi"

    for line in lines:
        line_clean = line.strip()
        if not line_clean:
            continue

        # Détection d'un nom de jour
        for d in ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]:
            if re.search(rf"\b{d}\b", line_clean, re.IGNORECASE):
                current_day = d.capitalize()
                break

        # Détection d'un créneau horaire ex: "08:30 - 10:30" ou "8h - 10h" ou "14h00-16h00"
        m_slot = re.search(r"(\d{1,2}[h:]\d{0,2})\s*[-–àa]\s*(\d{1,2}[h:]\d{0,2})", line_clean, re.IGNORECASE)
        if m_slot:
            start_t = _normalize_time(m_slot.group(1))
            end_t = _normalize_time(m_slot.group(2))

            # Titre : le reste de la ligne
            title_part = line_clean.replace(m_slot.group(0), "").replace("|", " ").strip(" -:,")
            if len(title_part) > 2:
                items.append({
                    "title": title_part,
                    "day_of_week": current_day,
                    "specific_date": None,
                    "start_time": start_t,
                    "end_time": end_t,
                    "location": "",
                    "description": "Importé depuis le document",
                    "constraint_type": "hard",
                })

    return items


def extract_schedule_from_document(
    document_info: Dict[str, Any],
    week_start_date_iso: Optional[str] = None,
    repeat_weeks: int = 1,
) -> Dict[str, Any]:
    """
    Analyse le document téléversé (texte extrait ou image visuelle)
    et génère la liste des événements projetés avec dates ISO concrètes.
    """
    # 1. Calcul de la date de référence (Lundi de la semaine de départ)
    if week_start_date_iso:
        try:
            ref_date = datetime.fromisoformat(week_start_date_iso).date()
        except ValueError:
            ref_date = date.today()
    else:
        ref_date = date.today()

    monday = _get_monday_of_week(ref_date)

    extracted_title = "Emploi du temps importé"
    raw_items: List[Dict[str, Any]] = []

    # 2. Appel IA OpenRouter
    if _openrouter_client and settings.openrouter_api_key:
        try:
            schema_json = json.dumps(SCHEDULE_ITEMS_SCHEMA)
            sys_prompt = f"{SYSTEM_INSTRUCTION}\n\nSchéma JSON obligatoire :\n{schema_json}"

            if document_info.get("is_image") and document_info.get("image_data_url"):
                # Analyse multimodale par Vision
                messages = [
                    {"role": "system", "content": sys_prompt},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": "Voici l'image de mon emploi du temps. Extrais tous les cours et plages horaires avec précision."
                            },
                            {
                                "type": "image_url",
                                "image_url": {"url": document_info["image_data_url"]}
                            }
                        ]
                    }
                ]
                resp = _openrouter_client.chat.completions.create(
                    model=settings.openrouter_model,
                    messages=messages,
                )
                raw_text = resp.choices[0].message.content.strip()
            else:
                # Analyse du texte extrait (PDF, Excel, Word)
                doc_text = document_info.get("text_content", "")
                if len(doc_text) > 12000:
                    doc_text = doc_text[:12000] + "\n[... Document tronqué pour analyse ...]"

                user_prompt = f"Voici le contenu extrait du document d'emploi du temps :\n\n{doc_text}\n\nExtrais tous les créneaux et cours selon le schéma JSON."
                raw_text = _call_openrouter(sys_prompt, user_prompt)

            data = _clean_and_parse_json(raw_text)
            extracted_title = data.get("schedule_title", extracted_title)
            raw_items = data.get("items", [])

        except Exception as e:
            print(f"[ai_schedule_extractor] Avertissement OpenRouter ({e}), bascule heuristique...")

    # 3. Repli heuristique si aucun item extrait via l'IA
    if not raw_items and document_info.get("text_content"):
        raw_items = _heuristic_schedule_fallback(document_info["text_content"])

    # 4. Projection des créneaux horaires sur le calendrier
    projected_events: List[Dict[str, Any]] = []
    repeat_count = max(1, min(repeat_weeks, 16))  # Borne de 1 à 16 semaines

    for w_idx in range(repeat_count):
        week_monday = monday + timedelta(weeks=w_idx)

        for item in raw_items:
            day_str = str(item.get("day_of_week", "Lundi")).lower().strip()
            day_offset = DAY_INDEX_MAP.get(day_str, 0)

            # Date concrète du jour
            event_day = week_monday + timedelta(days=day_offset)

            start_t = _normalize_time(item.get("start_time", "09:00"))
            end_t = _normalize_time(item.get("end_time", "10:30"))

            start_iso = f"{event_day.isoformat()}T{start_t}:00"
            end_iso = f"{event_day.isoformat()}T{end_t}:00"

            # Sécurité si end <= start
            if end_t <= start_t:
                sh, sm = map(int, start_t.split(":"))
                end_iso = f"{event_day.isoformat()}T{(sh + 1) % 24:02d}:{sm:02d}:00"

            projected_events.append({
                "temp_id": f"import_{w_idx}_{len(projected_events)}",
                "title": item.get("title", "Cours"),
                "day_of_week": item.get("day_of_week", "Lundi"),
                "date": event_day.isoformat(),
                "start_time": start_iso,
                "end_time": end_iso,
                "start_time_display": start_t,
                "end_time_display": end_t,
                "location": item.get("location") or "",
                "description": item.get("description") or "",
                "constraint_type": item.get("constraint_type", "hard"),
                "week_number": w_idx + 1,
            })

    return {
        "schedule_title": extracted_title,
        "reference_week_monday": monday.isoformat(),
        "repeat_weeks": repeat_count,
        "total_extracted": len(projected_events),
        "events": projected_events,
    }
