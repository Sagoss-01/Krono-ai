"""
routes.py (messaging)
---------------------
Routes FastAPI pour l'envoi effectif d'emails et de messages WhatsApp
après confirmation utilisateur.
"""

from datetime import datetime
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.routes import get_current_user
from backend.database import get_db
from backend.models.db_models import User, ScheduledMessage
from backend.models.schemas import SendMessageRequest, SendMessageResponse
from backend.messaging.email_service import send_email
from backend.messaging.whatsapp_service import send_whatsapp_message

router = APIRouter(prefix="/messaging", tags=["messaging"])


class ScheduleMessagePayload(BaseModel):
    recipient: str
    channel: str = "email"
    subject: str | None = None
    body: str
    scheduled_at: datetime


@router.post("/send", response_model=SendMessageResponse)
async def send_message_endpoint(
    payload: SendMessageRequest,
    current_user: User = Depends(get_current_user),
):
    channel = payload.channel.lower()

    if channel not in ("whatsapp", "email"):
        raise HTTPException(
            status_code=400,
            detail=f"Canal inconnu '{payload.channel}'. Choisissez 'whatsapp' ou 'email'."
        )

    if not payload.recipient or not payload.body:
        raise HTTPException(
            status_code=400,
            detail="Le destinataire et le corps du message sont obligatoires."
        )

    try:
        if channel == "email":
            subject = payload.subject or "Message de Krono AI"
            res = await send_email(
                to_email=payload.recipient,
                subject=subject,
                body_text=payload.body,
            )
            return SendMessageResponse(
                status=res["status"],
                channel="email",
                recipient=payload.recipient,
                message_id=res.get("message_id"),
                detail=res.get("detail", "Email envoyé avec succès"),
            )
        else:
            res = await send_whatsapp_message(
                to_phone=payload.recipient,
                body_text=payload.body,
            )
            return SendMessageResponse(
                status=res["status"],
                channel="whatsapp",
                recipient=payload.recipient,
                message_id=res.get("message_id"),
                detail=res.get("detail", "WhatsApp envoyé avec succès"),
            )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Échec d'envoi du message : {str(e)}"
        )


# ─── ENVOI PROGRAMMÉ (SCHEDULED EMAILS & WHATSAPP) ──────────────────────────

@router.post("/schedule", status_code=status.HTTP_201_CREATED)
async def schedule_message(
    payload: ScheduleMessagePayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Programme l'envoi différé d'un email ou message WhatsApp."""
    msg = ScheduledMessage(
        user_id=current_user.id,
        recipient=payload.recipient.strip(),
        channel=payload.channel.lower().strip(),
        subject=payload.subject,
        body=payload.body,
        scheduled_at=payload.scheduled_at,
        status="pending",
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return {
        "ok": True,
        "id": str(msg.id),
        "scheduled_at": msg.scheduled_at.isoformat(),
        "status": msg.status,
        "message": f"Message programmé pour le {msg.scheduled_at.strftime('%d/%m/%Y à %H:%M')}."
    }


@router.get("/schedule")
async def list_scheduled_messages(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Liste tous les messages programmés en attente ou récents."""
    stmt = select(ScheduledMessage).where(ScheduledMessage.user_id == current_user.id).order_by(ScheduledMessage.scheduled_at.asc())
    res = await db.execute(stmt)
    items = res.scalars().all()
    return [
        {
            "id": str(m.id),
            "recipient": m.recipient,
            "channel": m.channel,
            "subject": m.subject,
            "body": m.body,
            "scheduled_at": m.scheduled_at.isoformat(),
            "status": m.status,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in items
    ]


@router.delete("/schedule/{message_id}")
async def cancel_scheduled_message(
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Annule un message programmé avant son expédition."""
    stmt = select(ScheduledMessage).where(ScheduledMessage.id == message_id, ScheduledMessage.user_id == current_user.id)
    res = await db.execute(stmt)
    msg = res.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message introuvable.")

    await db.delete(msg)
    await db.commit()
    return {"ok": True, "message": "Envoi programmé annulé avec succès."}
