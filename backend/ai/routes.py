"""
routes.py (ai)
--------------
Routes pour les services d'IA (parsing direct, génération d'excuses).
"""

from datetime import datetime, timezone
import json
import asyncio
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.routes import get_current_user
from backend.database import get_db
from backend.models.db_models import User, Event, Contact, Meeting, AiFeedback
from backend.models.schemas import ExcuseRequest, ExcuseResponse, ParsedTaskIntent
from backend.ai.gemini_client import (
    parse_natural_language_task, generate_excuse_message,
    generate_meeting_summary_and_actions, generate_meeting_quiz, generate_chat_response
)
from backend.ai.nlp_service import clean_transcription
from backend.privacy.gateway import privacy_gateway

router = APIRouter(prefix="/ai", tags=["ai"])


# ─── SCHÉMAS ADDITIONNELS ───────────────────────────────────────────────────

class ChatMessageItem(BaseModel):
    role: str  # user, assistant, system
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessageItem]
    conversation_id: Optional[str] = None

class MeetingTextPayload(BaseModel):
    notes: str

class AgendaCheckRequest(BaseModel):
    proposed_title: str
    proposed_date: str
    proposed_time: str
    duration_minutes: int = 60

class AiFeedbackRequest(BaseModel):
    feedback_type: str  # positive, negative
    conversation_id: Optional[str] = None
    message_content: Optional[str] = None
    comment: Optional[str] = None


@router.post("/parse", response_model=ParsedTaskIntent)
async def parse_text(
    text: str,
    today_iso: str | None = None,
    current_user: User = Depends(get_current_user),
):
    if not today_iso:
        today_iso = datetime.now(timezone.utc).date().isoformat()

    try:
        # Nettoyage
        cleaned = clean_transcription(text)
        # Anonymisation
        anonymized = privacy_gateway.anonymize(cleaned)
        # Appel Gemini
        parsed_dict = parse_natural_language_task(anonymized.anonymized_text, today_iso)
        # Désanonymisation
        restored_title = privacy_gateway.restore(parsed_dict.get("title", ""), anonymized.token_map)
        parsed_dict["title"] = restored_title

        return ParsedTaskIntent(**parsed_dict)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur d'interpretation IA : {str(e)}"
        )


@router.post("/excuse", response_model=ExcuseResponse)
async def get_excuse(
    payload: ExcuseRequest,
    current_user: User = Depends(get_current_user),
):
    try:
        excuse = generate_excuse_message(
            delay_minutes=payload.delay_minutes,
            meeting_title=payload.meeting_title,
            formality=payload.formality,
        )
        return ExcuseResponse(excuse=excuse)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur de generation d'excuse : {str(e)}"
        )


# ─── NOUVEAUX ENDPOINTS TECHSPHERE ADAPTÉS À KRONO AI ──────────────────────

@router.post("/chat")
async def chat_with_aura(
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Dialogue interactif et persistant avec Aura (Assistant IA Krono).
    Supporte les propositions interactives et cartes dynamiques.
    """
    # Récupérer les événements récents pour le contexte
    stmt_ev = select(Event).where(Event.owner_id == current_user.id).order_by(Event.start_time.asc()).limit(5)
    res_ev = await db.execute(stmt_ev)
    events = res_ev.scalars().all()

    # Récupérer quelques contacts
    stmt_ct = select(Contact).where(Contact.user_id == current_user.id).limit(5)
    res_ct = await db.execute(stmt_ct)
    contacts = res_ct.scalars().all()

    ctx = {
        "events": [{"title": e.title, "start_time": e.start_time.strftime("%d/%m %H:%M")} for e in events],
        "contacts": [{"name": c.name} for c in contacts],
    }

    result = generate_chat_response([m.model_dump() for m in payload.messages], user_context=ctx)
    return {
        "reply": result.get("reply", ""),
        "card": result.get("card"),
        "conversation_id": payload.conversation_id or str(uuid.uuid4()),
    }


@router.post("/chat/stream")
async def chat_stream_with_aura(
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Réponse en streaming SSE (Server-Sent Events) adapté de TechSphere.
    Permet un affichage mot par mot ultra-fluide dans le client React.
    """
    # Obtenir la réponse complète
    result = generate_chat_response([m.model_dump() for m in payload.messages])
    full_text = result.get("reply", "")
    card = result.get("card")

    async def event_generator():
        # Découper par petits morceaux pour simuler le flux en continu
        words = full_text.split(" ")
        for i, word in enumerate(words):
            chunk = word + (" " if i < len(words) - 1 else "")
            data_json = json.dumps({"type": "chunk", "content": chunk}, ensure_ascii=False)
            yield f"data: {data_json}\n\n"
            await asyncio.sleep(0.02)  # simulation réaliste de frappe fluide

        if card:
            card_json = json.dumps({"type": "card", "card": card}, ensure_ascii=False)
            yield f"data: {card_json}\n\n"

        done_json = json.dumps({"type": "done"}, ensure_ascii=False)
        yield f"data: {done_json}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/meetings/{meeting_id}/summary")
async def generate_meeting_summary_endpoint(
    meeting_id: str,
    payload: MeetingTextPayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Génère la synthèse et le compte-rendu exécutif d'une réunion."""
    res = generate_meeting_summary_and_actions(payload.notes)
    return {
        "ok": True,
        "meeting_id": meeting_id,
        "summary": res.get("summary", ""),
        "decisions": res.get("decisions", []),
        "actions": res.get("actions", []),
    }


@router.post("/meetings/{meeting_id}/actions")
async def generate_meeting_actions_endpoint(
    meeting_id: str,
    payload: MeetingTextPayload,
    current_user: User = Depends(get_current_user),
):
    """Extrait automatiquement le plan d'action (tâches, assignés, délais)."""
    res = generate_meeting_summary_and_actions(payload.notes)
    return {
        "ok": True,
        "meeting_id": meeting_id,
        "actions": res.get("actions", []),
    }


@router.post("/meetings/{meeting_id}/quiz")
async def generate_meeting_quiz_endpoint(
    meeting_id: str,
    payload: MeetingTextPayload,
    current_user: User = Depends(get_current_user),
):
    """Génère automatiquement un quiz QCM pour évaluer l'assimilation des points clés."""
    quiz_items = generate_meeting_quiz(payload.notes)
    return {
        "ok": True,
        "meeting_id": meeting_id,
        "quiz": quiz_items,
    }


@router.post("/agenda/check")
async def check_agenda_availability(
    payload: AgendaCheckRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Vérification d'agenda intelligente : analyse les disponibilités pour un créneau
    souhaité et détecte les éventuels conflits avec les contraintes dures et souples.
    """
    try:
        req_start = datetime.fromisoformat(f"{payload.proposed_date}T{payload.proposed_time}")
        req_end = req_start + asyncio.to_thread.__doc__ if False else None
        # simple parsing
    except Exception:
        pass

    # Récupérer les événements existants
    stmt = select(Event).where(Event.owner_id == current_user.id)
    res = await db.execute(stmt)
    events = res.scalars().all()

    # Détection basique de conflit sur le même jour
    conflicts = []
    for ev in events:
        if ev.start_time.strftime("%Y-%m-%d") == payload.proposed_date:
            ev_hour_str = ev.start_time.strftime("%H:%M")
            if abs(int(ev_hour_str.split(":")[0]) - int(payload.proposed_time.split(":")[0])) < 2:
                conflicts.append({
                    "title": ev.title,
                    "time": f"{ev.start_time.strftime('%H:%M')} - {ev.end_time.strftime('%H:%M')}",
                    "constraint": ev.constraint_type.value,
                })

    is_free = len(conflicts) == 0
    recommendation = (
        "Le créneau est entièrement libre ! Vous pouvez confirmer ce rendez-vous sans impact."
        if is_free
        else f"Attention, {len(conflicts)} événement(s) existant(s) chevauchent ou sont proches de cet horaire. "
        + ("Un arbitrage automatique est possible car les contraintes sont souples." if all(c['constraint'] == 'soft' for c in conflicts) else "Conflit avec une contrainte dure (HARD) indéplaçable.")
    )

    return {
        "proposed_slot": f"{payload.proposed_date} à {payload.proposed_time}",
        "is_available": is_free,
        "conflicts": conflicts,
        "recommendation": recommendation,
    }


@router.post("/feedback")
async def submit_ai_feedback(
    payload: AiFeedbackRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Enregistre un retour qualitatif de l'utilisateur sur une réponse IA."""
    fb = AiFeedback(
        user_id=current_user.id,
        conversation_id=payload.conversation_id,
        message_content=payload.message_content,
        feedback_type=payload.feedback_type,
        comment=payload.comment,
    )
    db.add(fb)
    await db.commit()
    return {"ok": True, "message": "Merci pour votre retour !"}

