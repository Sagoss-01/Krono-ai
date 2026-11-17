"""
nodes.py
--------
Nœuds de traitement pour l'agent Langgraph.
"""

from datetime import datetime, timezone, timedelta
import asyncio
from typing import Dict, Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from langchain_core.runnables import RunnableConfig

from backend.agent.state import AgentState
import re
from backend.privacy.gateway import privacy_gateway
from backend.ai.nlp_service import clean_transcription
from backend.models.db_models import Event, ConstraintType, EventStatus, Contact
from backend.ai.gemini_client import parse_natural_language_task, generate_draft_message
from backend.ai.fuzzy_parser import parse_fuzzy_intentions
from backend.scheduler.conflict_engine import ScheduleEvent, detect_conflicts, resolve_conflicts
from backend.scheduler.dynamic_optimizer import optimize_schedule_for_tasks


def anonymize_node(state: AgentState) -> Dict[str, Any]:
    raw = state.get("raw_input", "")
    res = privacy_gateway.anonymize(raw)
    return {
        "cleaned_input": res.anonymized_text,
        "token_map": res.token_map
    }


def clean_node(state: AgentState) -> Dict[str, Any]:
    current_input = state.get("cleaned_input", "")
    cleaned = clean_transcription(current_input)
    return {
        "cleaned_input": cleaned
    }


def _is_direct_message_command(text: str) -> bool:
    t = text.lower()
    has_msg_verb = any(v in t for v in [
        "envoie", "envoyer", "écris", "ecris", "préviens", "previens",
        "alerte", "notifier", "transmets", "transmettre", "dis à", "dis a"
    ])
    has_msg_medium = any(m in t for m in [
        "whatsapp", "whats app", "watsapp", "mail", "email", "courriel",
        "message", "sms", "texto"
    ])
    return has_msg_verb and has_msg_medium


async def parse_node(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    cleaned = state.get("cleaned_input", "")
    today_iso = config.get("configurable", {}).get("today_iso")
    if not today_iso:
        today_iso = datetime.now(timezone.utc).date().isoformat()

    # 1. Détection des intentions floues ou données hétérogènes (sauf si commande directe de messagerie)
    if not _is_direct_message_command(cleaned):
        parsed_fuzzy = parse_fuzzy_intentions(cleaned, today_iso)
        if parsed_fuzzy.get("is_fuzzy") and parsed_fuzzy.get("tasks"):
            db: AsyncSession = config.get("configurable", {}).get("db")
            user_id = state.get("user_id")
            if isinstance(user_id, str):
                import uuid
                try:
                    user_id = uuid.UUID(user_id)
                except ValueError:
                    pass

            db_events = []
            if db and user_id:
                res = await db.execute(select(Event).where(Event.owner_id == user_id))
                db_events = res.scalars().all()

            from datetime import date
            try:
                ref_date = date.fromisoformat(today_iso)
            except Exception:
                ref_date = date.today()

            proposal = optimize_schedule_for_tasks(parsed_fuzzy["tasks"], db_events, reference_date=ref_date)
            first_item = {}
            if proposal.items:
                it = proposal.items[0]
                first_item = {
                    "title": it.title,
                    "date": it.start_time.date().isoformat(),
                    "time": it.start_time.strftime("%H:%M"),
                    "duration_minutes": it.duration_minutes,
                    "priority": "normal",
                }

            return {
                "intent": {
                    "action": "schedule_proposal",
                    "first_item": first_item,
                },
                "proposal": proposal.model_dump(),
                "response_message": proposal.summary_message,
                "status": "proposal",
            }

    # 2. Parsing standard de commande explicite
    intent = parse_natural_language_task(cleaned, today_iso)
    return {
        "intent": intent
    }


async def conflict_node(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    import uuid
    db: AsyncSession = config.get("configurable", {}).get("db")
    user_id = state.get("user_id")
    if isinstance(user_id, str):
        try:
            user_id = uuid.UUID(user_id)
        except ValueError:
            pass
            
    intent = state.get("intent")
    
    if not db or not user_id or not intent:
        return {
            "status": "error",
            "response_message": "Erreur d'initialisation du graphe (db ou user_id manquant)."
        }
        
    action = intent.get("action")
    if action == "schedule_proposal" or state.get("status") == "proposal":
        return {
            "status": "proposal",
            "conflicts": [],
            "resolved_moves": {}
        }

    if action == "send_message":
        recipient_raw = (intent.get("recipient_name") or "").strip()
        recipient_name = privacy_gateway.restore(recipient_raw, state.get("token_map", {}))
        channel = (intent.get("channel") or "whatsapp").lower()
        delay_minutes = intent.get("delay_minutes")
        msg_body = intent.get("message_body") or intent.get("subject") or "Message"

        # Recherche des contacts
        stmt = select(Contact).where(
            Contact.user_id == user_id,
            Contact.name.ilike(f"%{recipient_name}%")
        )
        res = await db.execute(stmt)
        matched_contacts = res.scalars().all()

        if len(matched_contacts) > 1:
            names = [f"{c.name} ({c.phone_number or c.email or 'sans coordonnées'})" for c in matched_contacts]
            return {
                "status": "disambiguation_needed",
                "response_message": f"Plusieurs contacts correspondent à '{recipient_name}' : {', '.join(names)}. Précisez le nom complet.",
                "conflicts": [],
                "resolved_moves": {},
            }
        elif len(matched_contacts) == 1:
            contact = matched_contacts[0]
            target = contact.phone_number if channel == "whatsapp" else contact.email
            if channel == "whatsapp" and not target and contact.email:
                channel = "email"
                target = contact.email
            elif channel == "email" and not target and contact.phone_number:
                channel = "whatsapp"
                target = contact.phone_number

            if not target:
                return {
                    "status": "error",
                    "response_message": f"{contact.name} est dans votre carnet d'adresses mais ne possède ni téléphone ni adresse email.",
                    "conflicts": [],
                    "resolved_moves": {},
                }

            draft = generate_draft_message(
                channel=channel,
                recipient_name=contact.name,
                message_intent=msg_body,
                delay_minutes=delay_minutes,
            )

            message_draft = {
                "channel": channel,
                "recipient_name": contact.name,
                "recipient_target": target,
                "subject": draft.get("subject"),
                "body": draft.get("body"),
                "delay_minutes": delay_minutes,
            }

            canal_lib = "WhatsApp" if channel == "whatsapp" else "Email"
            return {
                "status": "message_draft",
                "message_draft": message_draft,
                "response_message": f"J'ai rédigé le message {canal_lib} pour {contact.name} ({target}). Confirmez l'envoi ci-dessous.",
                "conflicts": [],
                "resolved_moves": {},
            }
        else:
            # Contact non trouvé en base
            target = ""
            if "@" in recipient_name:
                channel = "email"
                target = recipient_name
            elif re.search(r"\+?\d{8,15}", recipient_name):
                channel = "whatsapp"
                target = recipient_name

            if target:
                draft = generate_draft_message(
                    channel=channel,
                    recipient_name=recipient_name,
                    message_intent=msg_body,
                    delay_minutes=delay_minutes,
                )
                message_draft = {
                    "channel": channel,
                    "recipient_name": recipient_name,
                    "recipient_target": target,
                    "subject": draft.get("subject"),
                    "body": draft.get("body"),
                    "delay_minutes": delay_minutes,
                }
                canal_lib = "WhatsApp" if channel == "whatsapp" else "Email"
                return {
                    "status": "message_draft",
                    "message_draft": message_draft,
                    "response_message": f"J'ai rédigé le message {canal_lib} pour {target}. Confirmez l'envoi ci-dessous.",
                    "conflicts": [],
                    "resolved_moves": {},
                }

            return {
                "status": "contact_not_found",
                "response_message": f"Le contact '{recipient_name}' est introuvable dans votre carnet d'adresses. Ajoutez-le dans l'onglet Contacts ou précisez ses coordonnées.",
                "conflicts": [],
                "resolved_moves": {},
            }

    title = intent.get("title", "")
    date_str = intent.get("date")
    time_str = intent.get("time")
    duration = intent.get("duration_minutes", 30)
    priority = intent.get("priority", "normal")
    
    constraint_type = ConstraintType.HARD if priority in ("critical", "high") else ConstraintType.SOFT
    
    try:
        if time_str:
            match = re.search(r"(\d{1,2}:\d{2})", str(time_str))
            clean_time = match.group(1) if match else time_str
            start_time = datetime.fromisoformat(f"{date_str}T{clean_time}")
        else:
            start_time = datetime.fromisoformat(f"{date_str}T09:00:00")
        end_time = start_time + timedelta(minutes=duration)
    except Exception as e:
        return {
            "status": "error",
            "response_message": f"Format de date/heure invalide dans l'intention : {str(e)}"
        }
        
    if action == "create_event":
        result = await db.execute(select(Event).where(Event.owner_id == user_id))
        db_events = result.scalars().all()
        
        new_event_temp_id = "NEW_EVENT_TEMP"
        
        calc_events = [
            ScheduleEvent(
                id=str(e.id),
                title=e.title,
                start=e.start_time,
                end=e.end_time,
                constraint_type=e.constraint_type
            )
            for e in db_events
        ]
        
        new_calc_event = ScheduleEvent(
            id=new_event_temp_id,
            title=title,
            start=start_time,
            end=end_time,
            constraint_type=constraint_type
        )
        
        all_calc_events = calc_events + [new_calc_event]
        
        conflicts_before = detect_conflicts(all_calc_events)
        hard_conflict_ids = set()
        
        for a, b in conflicts_before:
            if a.constraint_type == ConstraintType.HARD and b.constraint_type == ConstraintType.HARD:
                hard_conflict_ids.add(a.id)
                hard_conflict_ids.add(b.id)
        
        moves = resolve_conflicts(all_calc_events)
        
        final_start, final_end = start_time, end_time
        if new_event_temp_id in moves:
            final_start, final_end = moves[new_event_temp_id]
            
        is_hard_conflict = new_event_temp_id in hard_conflict_ids
        event_status = EventStatus.CONFLICT if is_hard_conflict else EventStatus.CONFIRMED
        
        relocated_events_info = {}
        for e in db_events:
            event_id_str = str(e.id)
            if event_id_str in moves:
                new_start, new_end = moves[event_id_str]
                e.start_time = new_start
                e.end_time = new_end
                relocated_events_info[e.title] = new_start.strftime("%H:%M")
            elif event_id_str in hard_conflict_ids:
                e.status = EventStatus.CONFLICT
                
        restored_title = privacy_gateway.restore(title, state.get("token_map", {}))
        new_event = Event(
            owner_id=user_id,
            title=restored_title,
            start_time=final_start,
            end_time=final_end,
            constraint_type=constraint_type,
            status=event_status,
            source="local"
        )
        db.add(new_event)
        await db.commit()
        
        conflicts_detected = [f"{a.title} et {b.title}" for a, b in conflicts_before]
        
        return {
            "status": "conflict" if is_hard_conflict or relocated_events_info else "success",
            "conflicts": conflicts_detected,
            "resolved_moves": relocated_events_info
        }
        
    elif action == "delete_event":
        day_start = datetime.fromisoformat(f"{date_str}T00:00:00")
        day_end = datetime.fromisoformat(f"{date_str}T23:59:59")
        
        stmt = select(Event).where(
            Event.owner_id == user_id,
            Event.title.ilike(f"%{title}%"),
            Event.start_time >= day_start,
            Event.start_time <= day_end
        )
        res = await db.execute(stmt)
        evt = res.scalar_one_or_none()
        
        if evt:
            await db.delete(evt)
            await db.commit()
            return {
                "status": "success",
                "conflicts": [],
                "resolved_moves": {}
            }
        else:
            return {
                "status": "error",
                "response_message": f"Aucun événement nommé '{title}' trouvé pour le {date_str}.",
                "conflicts": [],
                "resolved_moves": {}
            }
            
    elif action == "move_event":
        day_start = datetime.fromisoformat(f"{date_str}T00:00:00")
        day_end = datetime.fromisoformat(f"{date_str}T23:59:59")
        
        stmt = select(Event).where(
            Event.owner_id == user_id,
            Event.title.ilike(f"%{title}%"),
            Event.start_time >= day_start,
            Event.start_time <= day_end
        )
        res = await db.execute(stmt)
        evt = res.scalar_one_or_none()
        
        if not evt:
            return {
                "status": "error",
                "response_message": f"Aucun événement nommé '{title}' trouvé le {date_str} à déplacer.",
                "conflicts": [],
                "resolved_moves": {}
            }
            
        if not time_str:
            return {
                "status": "error",
                "response_message": f"Veuillez spécifier une heure pour déplacer '{title}'.",
                "conflicts": [],
                "resolved_moves": {}
            }
            
        new_start = datetime.fromisoformat(f"{date_str}T{time_str}")
        new_end = new_start + (evt.end_time - evt.start_time)
        
        result = await db.execute(select(Event).where(Event.owner_id == user_id, Event.id != evt.id))
        db_events = result.scalars().all()
        
        calc_events = [
            ScheduleEvent(
                id=str(e.id),
                title=e.title,
                start=e.start_time,
                end=e.end_time,
                constraint_type=e.constraint_type
            )
            for e in db_events
        ]
        
        moved_calc_event = ScheduleEvent(
            id=str(evt.id),
            title=evt.title,
            start=new_start,
            end=new_end,
            constraint_type=evt.constraint_type
        )
        
        all_calc_events = calc_events + [moved_calc_event]
        
        conflicts_before = detect_conflicts(all_calc_events)
        hard_conflict_ids = set()
        
        for a, b in conflicts_before:
            if a.constraint_type == ConstraintType.HARD and b.constraint_type == ConstraintType.HARD:
                hard_conflict_ids.add(a.id)
                hard_conflict_ids.add(b.id)
                
        moves = resolve_conflicts(all_calc_events)
        
        final_start, final_end = new_start, new_end
        if str(evt.id) in moves:
            final_start, final_end = moves[str(evt.id)]
            
        is_hard_conflict = str(evt.id) in hard_conflict_ids
        event_status = EventStatus.CONFLICT if is_hard_conflict else EventStatus.CONFIRMED
        
        evt.start_time = final_start
        evt.end_time = final_end
        evt.status = event_status
        
        relocated_events_info = {}
        for e in db_events:
            event_id_str = str(e.id)
            if event_id_str in moves:
                new_s, new_e = moves[event_id_str]
                e.start_time = new_s
                e.end_time = new_e
                relocated_events_info[e.title] = new_s.strftime("%H:%M")
            elif event_id_str in hard_conflict_ids:
                e.status = EventStatus.CONFLICT
                
        await db.commit()
        return {
            "status": "conflict" if is_hard_conflict or relocated_events_info else "success",
            "conflicts": [f"{a.title} et {b.title}" for a, b in conflicts_before],
            "resolved_moves": relocated_events_info
        }
        
    return {"status": "success", "conflicts": [], "resolved_moves": {}}


def finalize_node(state: AgentState) -> Dict[str, Any]:
    status = state.get("status")
    intent = state.get("intent")
    conflicts = state.get("conflicts", [])
    resolved_moves = state.get("resolved_moves", {})
    token_map = state.get("token_map", {})
    
    if status == "error":
        return {}

    if status == "message_draft":
        resp_msg = state.get("response_message", "")
        msg_restored = privacy_gateway.restore(resp_msg, token_map)
        return {
            "response_message": msg_restored,
            "status": "message_draft",
            "message_draft": state.get("message_draft"),
        }

    if status in ("disambiguation_needed", "contact_not_found"):
        resp_msg = state.get("response_message", "")
        msg_restored = privacy_gateway.restore(resp_msg, token_map)
        return {
            "response_message": msg_restored,
            "status": status,
        }

    if status == "proposal" or (intent and intent.get("action") == "schedule_proposal"):
        resp_msg = state.get("response_message", "")
        msg_restored = privacy_gateway.restore(resp_msg, token_map)
        return {
            "response_message": msg_restored,
            "status": "proposal",
            "proposal": state.get("proposal")
        }

    if not intent:
        return {
            "response_message": "Impossible de determiner l'intention de la requete.",
            "status": "error"
        }
        
    action = intent.get("action")
    title = intent.get("title")
    date_str = intent.get("date")
    time_str = intent.get("time")
    
    msg = ""
    if action == "create_event":
        msg = f"L'événement '{title}' a été créé pour le {date_str}"
        if time_str:
            msg += f" à {time_str}."
        else:
            msg += " (heure par défaut : 09:00)."
            
        if resolved_moves:
            msg += " Pour éviter des conflits, j'ai déplacé les événements suivants : "
            msg += ", ".join([f"'{k}' à {v}" for k, v in resolved_moves.items()]) + "."
        elif conflicts:
            msg += " Attention, un conflit insoluble a été détecté, l'événement est marqué en conflit."
            
    elif action == "delete_event":
        msg = f"L'événement '{title}' prévu le {date_str} a été supprimé avec succès."
        
    elif action == "move_event":
        msg = f"L'événement '{title}' a été déplacé au {date_str}"
        if time_str:
            msg += f" à {time_str}."
        else:
            msg += "."
        if resolved_moves:
            msg += " Suite à cela, d'autres événements ont été décalés : "
            msg += ", ".join([f"'{k}' à {v}" for k, v in resolved_moves.items()]) + "."
            
    msg_restored = privacy_gateway.restore(msg, token_map)
    
    return {
        "response_message": msg_restored,
        "status": "success" if status != "error" else "error"
    }


# ---------- Mots-cles geo pour detection rapide ----------
_GEO_KEYWORDS = (
    "geocode", "geolocalise", "localise", "ou est", "ou se trouve",
    "trouver", "trouve", "cherche", "recherche", "autour", "pres de", "proche",
    "itineraire", "route", "chemin", "trajet", "comment aller", "aller a",
    "distance", "duree", "temps de trajet", "combien de temps",
    "hopital", "universite", "restaurant", "cafe", "pharmacie", "ecole",
    "marche", "velo", "voiture", "a pied",
)


def _is_geo_intent(text: str) -> bool:
    """Detection rapide d'une intention geographique dans le texte brut."""
    lowered = text.lower()
    return any(kw in lowered for kw in _GEO_KEYWORDS)


async def geo_node(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    """
    Noeud geographique : intercepte les requetes de type geo et appelle
    Geoapify via les outils LangGraph (geocode, places, route).
    Utilise raw_input (avant anonymisation) pour preserver les noms de lieux.
    """
    # IMPORTANT : utiliser raw_input (avant le Privacy Gateway) pour que
    # les noms de lieux ne soient pas anonymises avant d'etre envoyes a Geoapify.
    raw = state.get("raw_input", "")

    from backend.geo.service import geocode_place, search_places, calculate_route
    import re

    text = raw.lower()  # texte brut original (non anonymise)
    response_parts = []
    geo_data = {}  # donnees structurees retournees au frontend

    # --- Geocodage simple ---
    # Patterns : "ou est X", "localise X", "geolocalise X"
    geocode_match = re.search(
        r"(?:ou est|ou se trouve|localise|geolocalise|geocode)\s+(.+?)(?:\s*\?|$)",
        text
    )
    if geocode_match:
        query = geocode_match.group(1).strip()
        try:
            result = await geocode_place(query)
            response_parts.append(
                f"J'ai localise '{query}' : {result['formatted']} "
                f"(lat: {result['lat']:.4f}, lon: {result['lon']:.4f})."
            )
            geo_data["geocode"] = result
        except Exception as e:
            response_parts.append(f"Impossible de geocoder '{query}' : {e}")

    # --- Recherche de lieux ---
    # Patterns : "trouver X pres de Y", "X autour de Y"
    places_match = re.search(
        r"(?:trouver?|cherche|recherche)\s+(?:un |des |une )?(.+?)\s+(?:pres de|autour de|a proximite de|proche de)\s+(.+?)(?:\s*\?|$)",
        text
    )
    if places_match:
        category_raw = places_match.group(1).strip()
        location_raw = places_match.group(2).strip()

        # Mapping categorie simple -> Geoapify
        CATEGORY_MAP = {
            "hopital": "healthcare.hospital",
            "hopitaux": "healthcare.hospital",
            "pharmacie": "healthcare.pharmacy",
            "medecin": "healthcare",
            "restaurant": "catering.restaurant",
            "cafe": "catering.cafe",
            "universite": "education.university",
            "ecole": "education.school",
            "supermarche": "commercial.supermarket",
            "banque": "service.financial.bank",
            "sport": "sport",
            "hotel": "accommodation.hotel",
            "transport": "public_transport",
        }
        category = next(
            (v for k, v in CATEGORY_MAP.items() if k in category_raw),
            category_raw  # fallback au texte brut
        )

        try:
            loc = await geocode_place(location_raw)
            places = await search_places(loc["lat"], loc["lon"], category, radius=3000, limit=5)
            if places:
                names = ", ".join(p["name"] for p in places[:5])
                response_parts.append(
                    f"J'ai trouve {len(places)} {category_raw}(s) pres de {loc['formatted']} : {names}."
                )
                geo_data["location"] = loc
                geo_data["places"] = places
            else:
                response_parts.append(f"Aucun {category_raw} trouve dans un rayon de 3 km autour de {loc['formatted']}.")
        except Exception as e:
            response_parts.append(f"Erreur lors de la recherche de {category_raw} : {e}")

    # --- Calcul de route ---
    # Patterns : "itineraire de X a Y", "aller de X a Y", "trajet de X a Y"
    route_match = re.search(
        r"(?:itineraire|route|trajet|chemin|comment aller|aller)\s+(?:de |depuis )?(.+?)\s+(?:a|jusqu.a|vers)\s+(.+?)(?:\s+en\s+(voiture|velo|a pied))?(?:\s*\?|$)",
        text
    )
    if route_match:
        origin_raw = route_match.group(1).strip()
        dest_raw   = route_match.group(2).strip()
        mode_raw   = (route_match.group(3) or "voiture").strip()
        MODE_MAP   = {"voiture": "drive", "velo": "bicycle", "a pied": "walk", "pied": "walk"}
        mode       = MODE_MAP.get(mode_raw, "drive")

        try:
            orig = await geocode_place(origin_raw)
            dest = await geocode_place(dest_raw)
            route = await calculate_route(orig["lat"], orig["lon"], dest["lat"], dest["lon"], mode)
            response_parts.append(
                f"Itineraire {mode_raw} de {orig['formatted']} vers {dest['formatted']} : "
                f"{route['distance_km']} km, environ {route['duration_min']} min."
            )
            geo_data["origin"]      = orig
            geo_data["destination"] = dest
            geo_data["route"]       = route
        except Exception as e:
            response_parts.append(f"Erreur calcul d'itineraire : {e}")

    if not response_parts:
        response_parts.append(
            "Je n'ai pas pu identifier de requete geographique precise. "
            "Essayez : 'Trouver un hopital pres de l\'Universite de Lome' "
            "ou 'Itineraire de Paris a Lyon en voiture'."
        )

    return {
        "status": "success",
        "response_message": " ".join(response_parts),
        "conflicts": [],
        "resolved_moves": geo_data,  # reuse du champ pour passer les donnees geo au frontend
        "intent": {"action": "geo_query", "geo_data": geo_data},
    }
