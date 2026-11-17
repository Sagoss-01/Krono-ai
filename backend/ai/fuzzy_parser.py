"""
fuzzy_parser.py
---------------
Moteur d'inférence sémantique pour transformer des intentions textuelles floues
et des données hétérogènes (notes en vrac, to-do informelles, observations du quotidien)
en tâches concrètes dotées de préférences temporelles pour l'optimiseur d'agenda.
"""

import json
import re
from datetime import datetime, date
from typing import List, Dict, Any, Optional
from google import genai
from google.genai import types

from backend.config import settings

try:
    _client = genai.Client(api_key=settings.gemini_api_key) if settings.gemini_api_key else None
except Exception:
    _client = None

FUZZY_TASKS_SCHEMA = {

    "type": "object",
    "properties": {
        "is_fuzzy": {
            "type": "boolean",
            "description": "True si le texte contient une ou plusieurs intentions floues, observations ou notes indirectes."
        },
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "raw_thought": {"type": "string", "description": "L'expression ou extrait brut"},
                    "deduced_title": {"type": "string", "description": "Titre concret et actionnable de l'événement (ex: 'rdv chez le coiffeur')"},
                    "category": {
                        "type": "string",
                        "enum": ["personal_care", "groceries", "health", "work", "sport", "home_errands", "leisure"],
                        "description": "Catégorie de la tâche"
                    },
                    "duration_minutes": {"type": "integer", "description": "Durée estimée réaliste en minutes (ex: 45 pour coiffeur, 60 pour courses)"},
                    "preferred_day_type": {
                        "type": "string",
                        "enum": ["weekend", "weekday", "any"],
                        "description": "Type de jour le plus adapté"
                    },
                    "preferred_days": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Jours préférés en français (ex: ['dimanche', 'samedi'])"
                    },
                    "preferred_hour": {
                        "type": "integer",
                        "description": "Heure de début indicative la plus opportune (ex: 17 pour 17h, 10 pour 10h, etc.)"
                    },
                    "preferred_time_of_day": {
                        "type": "string",
                        "enum": ["morning", "afternoon", "late_afternoon", "evening", "any"],
                        "description": "Créneau de journée préféré"
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["low", "normal", "high", "critical"],
                        "description": "Degré d'urgence déduit"
                    },
                    "reasoning": {
                        "type": "string",
                        "description": "Courte justification logique du titre et du créneau proposé"
                    }
                },
                "required": ["raw_thought", "deduced_title", "category", "duration_minutes", "preferred_day_type", "reasoning"]
            }
        }
    },
    "required": ["is_fuzzy", "tasks"]
}

SYSTEM_PROMPT = """Tu es le moteur d'intelligence sémantique et comportementale de Krono AI.
Ta mission : analyser des pensées floues, observations du quotidien, états émotionnels ou physiques, notes pêle-mêle, to-do listes désorganisées ou données textuelles hétérogènes, et déduire avec finesse les intentions concrètes sous-jacentes à planifier dans l'agenda.

RÈGLES D'INFÉRENCE :
1. "mes cheveux sont devenus trop longs" ->
   - Action : "rdv chez le coiffeur"
   - Catégorie : personal_care
   - Durée : 45 minutes
   - Jour préféré : ["dimanche", "samedi"] (weekend)
   - Heure préférée : 17 (17:00 en fin d'après-midi, idéal pour la détente avant la reprise)
   - Justification : "Coupe de cheveux nécessaire suite à des cheveux trop longs. Créneau idéal le week-end en fin d'après-midi."

2. "le frigo est vide" ou "plus rien à manger" ->
   - Action : "Courses alimentaires"
   - Catégorie : groceries
   - Durée : 60 minutes
   - Moment préféré : weekday soir (18h-20h) ou samedi matin

3. "j'ai mal aux dents" / "rage de dents" ->
   - Action : "Rendez-vous dentiste"
   - Catégorie : health
   - Priorité : high
   - Durée : 45 minutes
   - Moment préféré : weekday matin ou après-midi (horaires d'ouverture médicale)

4. "la voiture fait un bruit bizarre" / "vidange à faire" ->
   - Action : "Révision voiture au garage"
   - Catégorie : home_errands
   - Durée : 60 minutes
   - Moment préféré : weekday matin (horaires d'ouverture garage)

5. Données hétérogènes multiples (ex: "Penser à : cheveux trop longs, rappeler maman, préparer slides") ->
   - Découpe et crée une tâche distincte pour chaque intention identifiable.

Réponds UNIQUEMENT selon le schéma JSON demandé."""


def _heuristic_fuzzy_fallback(text: str) -> Optional[List[Dict[str, Any]]]:
    """
    Détection heuristique et déterministe pour les motifs usuels du quotidien.
    Garantit une réponse ultra-rapide et infaillible même en cas de latence réseau.
    """
    lowered = text.lower()
    tasks = []

    # Motif : Cheveux longs / coiffeur
    if any(kw in lowered for kw in ["cheveu", "cheveux", "coiff", "coupe de cheveu", "tignasse"]):
        tasks.append({
            "raw_thought": text.strip(),
            "deduced_title": "rdv chez le coiffeur",
            "category": "personal_care",
            "duration_minutes": 45,
            "preferred_day_type": "weekend",
            "preferred_days": ["dimanche", "samedi"],
            "preferred_hour": 17,
            "preferred_time_of_day": "late_afternoon",
            "priority": "normal",
            "reasoning": "Coupe de cheveux déduite d'une longueur excessive. Créneau idéalement positionné le week-end en fin d'après-midi."
        })

    # Motif : Frigo vide / courses
    if any(kw in lowered for kw in ["frigo", "courses", "supermarch", "manger", "courses alim"]):
        tasks.append({
            "raw_thought": "frigo vide / courses à faire",
            "deduced_title": "Courses alimentaires",
            "category": "groceries",
            "duration_minutes": 60,
            "preferred_day_type": "weekday",
            "preferred_days": ["vendredi", "samedi"],
            "preferred_hour": 18,
            "preferred_time_of_day": "evening",
            "priority": "normal",
            "reasoning": "Courses pour réapprovisionner les vivres, créneau pratique en fin de journée."
        })

    # Motif : Douleur dentaire / santé
    if any(kw in lowered for kw in ["dent", "dents", "dentiste", "molaire"]):
        tasks.append({
            "raw_thought": "problème dentaire",
            "deduced_title": "Rendez-vous dentiste",
            "category": "health",
            "duration_minutes": 45,
            "preferred_day_type": "weekday",
            "preferred_days": ["lundi", "mardi", "mercredi", "jeudi", "vendredi"],
            "preferred_hour": 10,
            "preferred_time_of_day": "morning",
            "priority": "high",
            "reasoning": "Soin dentaire prioritaire en semaine pendant les heures de consultation."
        })

    # Motif : Voiture / Garage
    if any(kw in lowered for kw in ["voiture", "vidange", "garage", "pneu", "moteur"]):
        tasks.append({
            "raw_thought": "entretien voiture",
            "deduced_title": "Révision véhicule / Garage",
            "category": "home_errands",
            "duration_minutes": 60,
            "preferred_day_type": "weekday",
            "preferred_days": ["vendredi", "samedi"],
            "preferred_hour": 9,
            "preferred_time_of_day": "morning",
            "priority": "normal",
            "reasoning": "Entretien mécanique pendant les heures d'ouverture d'un garage."
        })

    return tasks if tasks else None


def parse_fuzzy_intentions(text: str, today_iso: Optional[str] = None) -> Dict[str, Any]:
    """
    Analyse un texte contenant une ou plusieurs intentions floues ou des données
    hétérogènes et retourne une liste de tâches déduites structurées.
    """
    if not today_iso:
        today_iso = date.today().isoformat()

    # 1. Tentative d'analyse via OpenRouter (prioritaire)
    try:
        from backend.ai.gemini_client import _openrouter_client, _call_openrouter, _clean_and_parse_json
        if _openrouter_client and settings.openrouter_api_key:
            prompt = f"Date de référence : {today_iso}\nDonnées / Pensées utilisateur :\n\"\"\"{text}\"\"\""
            openrouter_sys = (
                SYSTEM_PROMPT
                + "\nIMPORTANT : Réponds UNIQUEMENT par un objet JSON valide conforme à ce schéma (aucun bloc de code markdown, pas de texte additionnel) :\n"
                + json.dumps(FUZZY_TASKS_SCHEMA)
            )
            raw = _call_openrouter(openrouter_sys, prompt)
            data = _clean_and_parse_json(raw)
            tasks = data.get("tasks", [])
            if tasks:
                return {
                    "is_fuzzy": True,
                    "tasks": tasks
                }
    except Exception as e:
        print(f"[fuzzy_parser] Avertissement: appel OpenRouter en échec ({e}), bascule...")

    # 2. Tentative d'analyse via Gemini
    if _client and settings.gemini_api_key:
        try:
            prompt = f"Date de référence : {today_iso}\nDonnées / Pensées utilisateur :\n\"\"\"{text}\"\"\""
            response = _client.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=FUZZY_TASKS_SCHEMA,
                    temperature=0.2,
                ),
            )
            cleaned_text = response.text.strip()
            if cleaned_text.startswith("```"):
                cleaned_text = cleaned_text.strip("`").strip()
                if cleaned_text.lower().startswith("json"):
                    cleaned_text = cleaned_text[4:].strip()

            data = json.loads(cleaned_text)
            tasks = data.get("tasks", [])
            if tasks:
                return {
                    "is_fuzzy": True,
                    "tasks": tasks
                }
        except Exception as e:
            print(f"[fuzzy_parser] Avertissement: appel Gemini en échec ({e}), repli heuristique.")


    # Repli heuristique
    heuristic_tasks = _heuristic_fuzzy_fallback(text)
    if heuristic_tasks:
        return {
            "is_fuzzy": True,
            "tasks": heuristic_tasks
        }

    # Si rien n'est reconnu comme intention floue
    return {
        "is_fuzzy": False,
        "tasks": []
    }
