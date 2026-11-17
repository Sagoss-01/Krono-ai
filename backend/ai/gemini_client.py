"""
gemini_client.py
-----------------
Interconnexion avec le SDK Gemini (google-genai) et Anthropic Claude API (httpx),
avec bascule automatique et repli heuristique résilient.
"""

import json
import re
import httpx
from openai import OpenAI
from google import genai
from google.genai import types

from backend.config import settings

# Initialisation du client OpenRouter (OpenAI API standard)
try:
    _openrouter_client = (
        OpenAI(
            base_url=settings.openrouter_base_url,
            api_key=settings.openrouter_api_key,
        )
        if settings.openrouter_api_key
        else None
    )
except Exception:
    _openrouter_client = None

try:
    _client = genai.Client(api_key=settings.gemini_api_key) if settings.gemini_api_key else None
except Exception:
    _client = None

TASK_INTENT_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["create_event", "delete_event", "move_event", "send_message"],
        },
        # Champs calendrier
        "title": {"type": "string"},
        "date": {"type": "string", "description": "Date ISO 8601, ex: 2026-07-06"},
        "time": {"type": "string", "description": "Heure HH:MM, optionnelle"},
        "duration_minutes": {"type": "integer"},
        "priority": {"type": "string", "enum": ["low", "normal", "high", "critical"]},
        # Champs messagerie
        "channel": {"type": "string", "enum": ["whatsapp", "email"]},
        "recipient_name": {"type": "string", "description": "Nom ou prénom du contact à qui envoyer le message"},
        "subject": {"type": "string", "description": "Objet du message (si email)"},
        "message_body": {"type": "string", "description": "Contenu ou idée clé du message exprimé par l'utilisateur"},
        "delay_minutes": {"type": "integer", "description": "Nombre de minutes de retard mentionné"},
    },
    "required": ["action"],
}

SYSTEM_PROMPT = """Tu es le moteur d'interprétation sémantique de Krono AI, un assistant personnel et agenda intelligent.
Ta mission : extraire avec précision l'intention de l'utilisateur depuis un texte informel (écrit ou oral en français).

TYPES D'ACTIONS :
1. "create_event", "delete_event", "move_event" : gestion d'emploi du temps.
   Déduis les dates relatives ("demain", "vendredi prochain", "ce soir") par rapport à la date du jour fournie.
2. "send_message" : l'utilisateur souhaite envoyer un message (WhatsApp, email, texto, alerte de retard, mot d'excuse).
   Exemples :
   - "Envoie un WhatsApp à Thomas pour lui dire que j'ai 10 minutes de retard" -> action: "send_message", channel: "whatsapp", recipient_name: "Thomas", delay_minutes: 10, message_body: "J'ai 10 minutes de retard"
   - "Envoie un mail à Sophie pour le point de projet" -> action: "send_message", channel: "email", recipient_name: "Sophie", subject: "Point de projet", message_body: "Point de projet"
   - "Préviens Dr Bernard que je serai en retard d'un quart d'heure" -> action: "send_message", channel: "whatsapp", recipient_name: "Dr Bernard", delay_minutes: 15, message_body: "Retard de 15 minutes"

Ignore les tics de langage et hésitations. Réponds UNIQUEMENT selon le schéma JSON demandé, sans texte additionnel."""


def _clean_and_parse_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        match = re.search(r"(\{.*\})", cleaned, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        raise


def _call_openrouter(system_prompt: str, user_prompt: str) -> str:
    """Appel direct à l'API OpenRouter via le client OpenAI."""
    if not _openrouter_client:
        raise ValueError("Client OpenRouter non initialisé ou OPENROUTER_API_KEY absente.")
    response = _openrouter_client.chat.completions.create(
        model=settings.openrouter_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    return response.choices[0].message.content.strip()



def _call_claude_messages(system_prompt: str, user_prompt: str) -> str:
    """Appel direct à l'API Anthropic Messages (Claude)."""
    if not settings.anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY absente.")

    headers = {
        "x-api-key": settings.anthropic_api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload = {
        "model": settings.anthropic_model,
        "max_tokens": 1024,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": user_prompt}
        ],
    }
    with httpx.Client(timeout=25.0) as client:
        resp = client.post("https://api.anthropic.com/v1/messages", headers=headers, json=payload)
        if resp.status_code != 200:
            raise RuntimeError(f"Erreur Claude API ({resp.status_code}): {resp.text}")
        data = resp.json()
        return data["content"][0]["text"].strip()


def heuristic_parse_task(user_text: str, today_iso: str) -> dict:
    """
    Parser déterministe résilient de repli si les clés API externes sont indisponibles.
    """
    text_lower = user_text.lower()

    # 1. Détection messagerie
    is_whatsapp = any(w in text_lower for w in ["whatsapp", "whats app", "watsapp", "message", "sms", "texto", "retard", "préviens", "previens"])
    is_email = any(w in text_lower for w in ["mail", "email", "courriel", "courrier"])

    if is_whatsapp or is_email:
        channel = "email" if is_email and not ("whatsapp" in text_lower) else "whatsapp"

        recipient = ""
        m_to = re.search(r"(?:à|a|au|aux|préviens|previens)\s+([A-Za-zÀ-ÖØ-öø-ÿ\.\-]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ\.\-]+)?)(?=\s+(?:pour|que|concernant|au\s+sujet|d'|de|retard|le|la|\.|\,)|$)", user_text, re.IGNORECASE)
        if m_to:
            matched = m_to.group(1).strip()
            if matched.lower() not in ("lui", "leur", "dire", "transmettre", "envoyer", "demain", "un", "une", "le", "la"):
                recipient = matched

        delay_minutes = None
        m_delay = re.search(r"(?:retard\s+de\s+|d'|de\s+)(\d+)\s*(?:min|minute|minutes)", text_lower)
        if m_delay:
            delay_minutes = int(m_delay.group(1))
        elif "quart d'heure" in text_lower:
            delay_minutes = 15
        elif "demi-heure" in text_lower or "demie heure" in text_lower:
            delay_minutes = 30

        m_body = re.search(r"(?:pour lui dire que|pour lui dire|pour lui transmettre|pour dire que|concernant|sujet|pour)\s+(.*)", user_text, re.IGNORECASE)
        message_body = m_body.group(1).strip() if m_body else user_text

        return {
            "action": "send_message",
            "channel": channel,
            "recipient_name": recipient or "Contact",
            "message_body": message_body,
            "subject": f"Message pour {recipient}" if recipient else "Message",
            "delay_minutes": delay_minutes,
        }

    # 2. Détection calendrier standard
    action = "create_event"
    if any(w in text_lower for w in ["supprime", "annule", "efface", "retire"]):
        action = "delete_event"
    elif any(w in text_lower for w in ["déplace", "deplace", "décale", "decale", "repousse", "change"]):
        action = "move_event"

    time_str = None
    m_time = re.search(r"(\d{1,2})[h:](\d{2})?", text_lower)
    if m_time:
        h = int(m_time.group(1))
        m = int(m_time.group(2)) if m_time.group(2) else 0
        time_str = f"{h:02d}:{m:02d}"

    cleaned_title = re.sub(r"^(ajoute|crée|cree|planifie|mets|supprime|annule|déplace|décale)\s+", "", user_text, flags=re.IGNORECASE)
    cleaned_title = re.sub(r"\s+(demain|aujourd'hui|ce soir|à\s+\d{1,2}h|\d{1,2}:\d{2}).*", "", cleaned_title, flags=re.IGNORECASE).strip()

    return {
        "action": action,
        "title": cleaned_title or "Événement",
        "date": today_iso,
        "time": time_str or "09:00",
        "duration_minutes": 30,
        "priority": "normal",
    }


def parse_natural_language_task(user_text: str, today_iso: str) -> dict:
    """
    Tente l'interprétation via OpenRouter (prioritaire), puis Claude (Anthropic),
    puis Gemini, puis repli heuristique garanti.
    """
    prompt = f"Date du jour : {today_iso}\nTexte utilisateur : \"{user_text}\""

    # 1. Tentative avec OpenRouter (prioritaire)
    if _openrouter_client and settings.openrouter_api_key:
        try:
            openrouter_sys = (
                SYSTEM_PROMPT
                + "\nIMPORTANT : Réponds UNIQUEMENT par un objet JSON valide conforme à ce schéma (aucun markdown, pas de ```json, pas de texte d'accompagnement) :\n"
                + json.dumps(TASK_INTENT_SCHEMA)
            )
            raw_text = _call_openrouter(openrouter_sys, prompt)
            return _clean_and_parse_json(raw_text)
        except Exception as e:
            print(f"[LLM] Avertissement OpenRouter ({str(e)}), bascule...")

    # 2. Tentative avec Claude (si clé configurée)
    if settings.anthropic_api_key:
        try:
            claude_sys = SYSTEM_PROMPT + "\nRéponds UNIQUEMENT en JSON valide conforme à ce schéma :\n" + json.dumps(TASK_INTENT_SCHEMA)
            raw_text = _call_claude_messages(claude_sys, prompt)
            return _clean_and_parse_json(raw_text)
        except Exception as e:
            print(f"[LLM] Avertissement Claude ({str(e)}), bascule...")

    # 3. Tentative avec Gemini
    if _client and settings.gemini_api_key:
        try:
            response = _client.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=TASK_INTENT_SCHEMA,
                ),
            )
            return _clean_and_parse_json(response.text)
        except Exception as e:
            print(f"[LLM] Avertissement Gemini ({str(e)}), repli heuristique...")

    # 4. Repli déterministe / heuristique
    return heuristic_parse_task(user_text, today_iso)


def generate_excuse_message(delay_minutes: int, meeting_title: str, formality: str) -> str:
    """
    Module D — "Ingénierie de prompt pour les excuses contextuelles".
    formality: "entreprise" | "administration" | "medecin"
    """
    prompt = (
        f"Rédige un court message d'excuse en français pour un retard de "
        f"{delay_minutes} minutes au rendez-vous \"{meeting_title}\". "
        f"Le ton doit être adapté à un contexte de type : {formality}. "
        f"Le message doit être poli, bref (2-3 phrases max), et mentionner "
        f"le minutage exact du retard."
    )
    # 1. OpenRouter
    if _openrouter_client and settings.openrouter_api_key:
        try:
            sys_prompt = "Tu es un assistant de communication personnelle et agenda. Rédige un court message d'excuse poli sans markdown."
            return _call_openrouter(sys_prompt, prompt)
        except Exception as e:
            print(f"[LLM] Avertissement OpenRouter excuse ({str(e)}), bascule...")

    # 2. Gemini
    if _client and settings.gemini_api_key:
        try:
            response = _client.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
            )
            return response.text.strip()
        except Exception:
            pass

    return f"Bonjour, je vous prie de bien vouloir m'excuser, j'aurai environ {delay_minutes} minutes de retard pour notre rendez-vous {meeting_title}."


def generate_draft_message(
    channel: str,
    recipient_name: str,
    message_intent: str,
    delay_minutes: int | None = None,
    formality: str = "normal",
) -> dict:
    """
    Génère un message optimisé et prêt à l'envoi pour WhatsApp ou Email.
    Retourne {"subject": str, "body": str}.
    """
    if delay_minutes:
        prompt = (
            f"Rédige un message poli d'excuse pour un retard de {delay_minutes} minutes "
            f"destiné à {recipient_name} via {channel}. "
            f"Contexte : \"{message_intent}\". "
            f"Si c'est WhatsApp : format concis, chaleureux ou professionnel selon le contexte, "
            f"avec éventuellement 1 emoji discret. "
            f"Si c'est email : donne un objet clair et un corps de mail courtois."
        )
    else:
        prompt = (
            f"Rédige un message en français destiné à {recipient_name} via {channel}. "
            f"Contenu / Intention demandée par l'expéditeur : \"{message_intent}\". "
            f"Si c'est un email : propose un objet clair et un corps d'email bien rédigé avec formule de politesse. "
            f"Si c'est WhatsApp : rédige un message direct, bienveillant et fluide."
        )

    prompt += "\nRéponds au format JSON avec exactement les clés : 'subject' (chaîne ou vide pour whatsapp) et 'body' (chaîne)."

    # 1. Tentative avec OpenRouter (prioritaire)
    if _openrouter_client and settings.openrouter_api_key:
        try:
            openrouter_sys = (
                "Tu es un assistant de messagerie. Rédige un message poli et clair selon la demande. "
                "Réponds UNIQUEMENT en JSON valide avec exactement les clés 'subject' et 'body' sans code block ni texte additionnel."
            )
            raw_text = _call_openrouter(openrouter_sys, prompt)
            data = _clean_and_parse_json(raw_text)
            return {
                "subject": data.get("subject", f"Message pour {recipient_name}"),
                "body": data.get("body", message_intent),
            }
        except Exception as e:
            print(f"[LLM] Avertissement OpenRouter draft ({str(e)}), bascule...")

    # 2. Tentative avec Claude
    if settings.anthropic_api_key:
        try:
            claude_sys = "Tu es un assistant de messagerie. Rédige un message poli et clair selon la demande. Réponds UNIQUEMENT en JSON valide avec exactement les clés 'subject' et 'body'."
            raw_text = _call_claude_messages(claude_sys, prompt)
            return _clean_and_parse_json(raw_text)
        except Exception:
            pass

    # 3. Tentative avec Gemini
    if _client and settings.gemini_api_key:
        try:
            response = _client.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                ),
            )
            text = response.text.strip()
            if text.startswith("```"):
                text = text.strip("`").strip()
                if text.lower().startswith("json"):
                    text = text[4:].strip()
            data = json.loads(text)
            return {
                "subject": data.get("subject", f"Message pour {recipient_name}"),
                "body": data.get("body", message_intent),
            }
        except Exception:
            pass

    # 4. Fallback statique
    if delay_minutes:
        body = f"Bonjour {recipient_name}, je te préviens que j'ai un imprévu et que j'aurai environ {delay_minutes} minutes de retard. Toutes mes excuses !"
    else:
        body = f"Bonjour {recipient_name},\n\n{message_intent}"
    return {
        "subject": f"Message pour {recipient_name}",
        "body": body,
    }


def generate_meeting_summary_and_actions(notes: str) -> dict:
    """
    Génère une synthèse structurée et une liste de plans d'action à partir de notes de réunion.
    """
    prompt = f"""Tu es le secrétaire exécutif IA de Krono AI.
Analyse les notes ou transcriptions de réunion ci-dessous et fournis un compte-rendu clair et des plans d'action.

NOTES DE RÉUNION :
\"\"\"{notes}\"\"\"

Réponds STRICTEMENT en format JSON avec les clés suivantes :
{{
  "summary": "Résumé exécutif en 2 à 4 paragraphes bien rédigés",
  "decisions": ["Décision majeure 1", "Décision majeure 2"],
  "actions": [
    {{"task": "Intitulé de la tâche", "assignee": "Nom du responsable ou 'Équipe'", "due_date": "Délai suggéré"}}
  ]
}}
"""
    # 1. Tentative OpenRouter
    if _openrouter_client and settings.openrouter_api_key:
        try:
            res = _openrouter_client.chat.completions.create(
                model=settings.openrouter_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                response_format={"type": "json_object"},
            )
            raw = res.choices[0].message.content or "{}"
            return _clean_and_parse_json(raw)
        except Exception:
            pass

    # 2. Tentative Gemini
    if _client and settings.gemini_api_key:
        try:
            res = _client.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
            return _clean_and_parse_json(res.text)
        except Exception:
            pass

    # Fallback heuristique
    return {
        "summary": f"Compte-rendu synthétique : Réunion portant sur {notes[:80]}...",
        "decisions": ["Validation des orientations stratégiques et du calendrier prévisionnel."],
        "actions": [
            {"task": "Finaliser les livrables convenus", "assignee": "Équipe projet", "due_date": "Prochaine réunion"}
        ]
    }


def generate_meeting_quiz(notes: str) -> list[dict]:
    """
    Génère automatiquement un quiz à choix multiples (QCM) pour évaluer la rétention de la réunion.
    """
    prompt = f"""Tu es le générateur d'évaluations de Krono AI.
À partir des informations suivantes de la réunion, génère un quiz de 3 questions à choix multiples pour tester les participants.

CONTENU :
\"\"\"{notes}\"\"\"

Réponds STRICTEMENT en JSON sous forme d'une liste :
[
  {{
    "question": "Texte de la question ?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_index": 0,
    "explanation": "Explication brève"
  }}
]
"""
    if _openrouter_client and settings.openrouter_api_key:
        try:
            res = _openrouter_client.chat.completions.create(
                model=settings.openrouter_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
            )
            data = _clean_and_parse_json(res.choices[0].message.content or "[]")
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and "quiz" in data:
                return data["quiz"]
        except Exception:
            pass

    if _client and settings.gemini_api_key:
        try:
            res = _client.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
            data = _clean_and_parse_json(res.text)
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and "quiz" in data:
                return data["quiz"]
        except Exception:
            pass

    return [
        {
            "question": "Quel était l'objectif principal abordé lors de la session ?",
            "options": ["Alignement sur les objectifs et tâches", "Annulation de projet", "Session informelle", "Autre"],
            "correct_index": 0,
            "explanation": "La réunion visait l'organisation du planning et l'avancement des livrables."
        }
    ]


def generate_chat_response(messages: list[dict], user_context: dict | None = None) -> dict:
    """
    Génère une réponse conversationnelle avec Aura (support des cartes d'action interactives).
    """
    ctx_str = ""
    if user_context:
        events_str = ", ".join([f"{e.get('title')} ({e.get('start_time')})" for e in user_context.get("events", [])[:5]])
        contacts_str = ", ".join([c.get("name", "") for c in user_context.get("contacts", [])[:5]])
        ctx_str = f"\nContexte utilisateur actuel :\n- Prochains événements : {events_str or 'Aucun'}\n- Contacts fréquents : {contacts_str or 'Aucun'}"

    system_instruction = f"""Tu es Aura, l'assistant intelligent de Krono AI (héritant de l'ergonomie moderne de TechSphere).
Tu gères le planning, la détection de conflits, les messages et les réunions de l'utilisateur.{ctx_str}
Sois chaleureux, concis, proactif et très structuré.

Si ta réponse implique une action claire (ex: planifier un rdv, envoyer un message, vérifier un retard), génère une carte d'action interactive 'card'.
Réponds au format JSON avec :
{{
  "reply": "Ton message d'explication textuel clair en français",
  "card": {{
    "type": "event_proposal" | "message_draft" | "conflict_alert" | null,
    "title": "Titre",
    "details": "Détails clés",
    "action_payload": {{"action": "create_event", "title": "...", "date": "...", "time": "..."}}
  }}
}}
"""
    user_prompt = messages[-1].get("content", "") if messages else "Bonjour"

    if _openrouter_client and settings.openrouter_api_key:
        try:
            res = _openrouter_client.chat.completions.create(
                model=settings.openrouter_model,
                messages=[
                    {"role": "system", "content": system_instruction},
                    *[{"role": m.get("role", "user"), "content": m.get("content", "")} for m in messages[-4:]]
                ],
                temperature=0.4,
                response_format={"type": "json_object"},
            )
            raw = res.choices[0].message.content or "{}"
            return _clean_and_parse_json(raw)
        except Exception:
            pass

    if _client and settings.gemini_api_key:
        try:
            res = _client.models.generate_content(
                model=settings.gemini_model,
                contents=f"{system_instruction}\n\nUtilisateur : {user_prompt}",
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
            return _clean_and_parse_json(res.text)
        except Exception:
            pass

    return {
        "reply": f"J'ai bien pris en compte votre demande : \"{user_prompt}\". Votre agenda Krono AI est à jour et optimisé.",
        "card": None
    }


# Exporter également le parser d'intentions floues et données hétérogènes
from backend.ai.fuzzy_parser import parse_fuzzy_intentions
