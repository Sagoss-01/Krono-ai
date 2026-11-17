"""
inbox_routes.py
---------------
Routes FastAPI pour :
  - GET  /inbox/fetch        → lire les mails Gmail/Outlook et les analyser
  - GET  /inbox/messages     → lister les mails déjà stockés
  - POST /inbox/check-duplicates → relancer la détection de doublons
  - POST /inbox/{alert_id}/acknowledge → acquitter une alerte doublon
  - GET  /inbox/alerts       → lister les alertes de doublons actives
"""

import uuid
from datetime import datetime, date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.routes import get_current_user
from backend.database import get_db
from backend.models.db_models import User, CalendarLink, InboxMessage, DuplicateAlert
from backend.models.schemas import (
    InboxFetchResponse,
    InboxMessageOut,
    DuplicateAlertOut,
    CheckDuplicatesResponse,
)
from backend.messaging.mail_reader import fetch_gmail_messages, fetch_outlook_messages
from backend.messaging.mail_analyzer import (
    detect_event_with_ai,
    build_topic_fingerprint,
    find_duplicates,
)
from backend.auth.security import decrypt_token

router = APIRouter(prefix="/inbox", tags=["inbox"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_decrypted_token(link: CalendarLink) -> str:
    """Déchiffre le token d'accès stocké."""
    return decrypt_token(link.encrypted_access_token)


def _to_message_dict(msg: InboxMessage) -> dict[str, Any]:
    return {
        "id": msg.id,
        "provider": msg.provider,
        "subject": msg.subject,
        "topic_fingerprint": msg.topic_fingerprint,
        "received_at": msg.received_at,
    }


# ---------------------------------------------------------------------------
# 1. Fetch & analyse des mails
# ---------------------------------------------------------------------------

@router.get("/fetch", response_model=InboxFetchResponse)
async def fetch_inbox(
    hours_back: int = Query(24, ge=1, le=168, description="Fenêtre temporelle (heures)"),
    use_ai: bool = Query(True, description="Utiliser l'IA pour analyser les événements"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Récupère les emails récents depuis tous les comptes OAuth2 liés
    (Google + Outlook), les analyse (détection d'événements + fingerprint),
    les persiste et renvoie un résumé avec les doublons détectés.
    """
    today_iso = date.today().isoformat()

    # Récupérer les liens calendrier de l'utilisateur
    result = await db.execute(
        select(CalendarLink).where(CalendarLink.user_id == current_user.id)
    )
    links: list[CalendarLink] = result.scalars().all()

    if not links:
        raise HTTPException(
            status_code=404,
            detail="Aucun compte de messagerie lié. Connectez d'abord Google ou Outlook via /calendar/auth/google ou /calendar/auth/microsoft."
        )

    all_raw_emails: list[dict[str, Any]] = []

    # Récupération des mails pour chaque provider lié
    for link in links:
        try:
            token = await _get_decrypted_token(link)
            if link.provider == "google":
                emails = await fetch_gmail_messages(token, hours_back=hours_back)
            elif link.provider == "microsoft":
                emails = await fetch_outlook_messages(token, hours_back=hours_back)
            else:
                continue
            all_raw_emails.extend(emails)
        except Exception as e:
            # Ne pas bloquer si un provider échoue
            import logging
            logging.getLogger("krono-inbox").warning(
                f"[Inbox] Erreur lecture {link.provider}: {e}"
            )
            continue

    if not all_raw_emails:
        return InboxFetchResponse(
            fetched_count=0,
            new_count=0,
            event_signals=[],
            duplicate_alerts=[],
            messages=[],
        )

    # Récupérer les IDs déjà stockés pour éviter les doublons de stockage
    existing_ext_ids_result = await db.execute(
        select(InboxMessage.external_id).where(InboxMessage.user_id == current_user.id)
    )
    existing_ext_ids: set[str] = set(existing_ext_ids_result.scalars().all())

    # Récupérer les messages récents déjà en base (pour déduplication)
    recent_msgs_result = await db.execute(
        select(InboxMessage).where(InboxMessage.user_id == current_user.id)
        .order_by(InboxMessage.received_at.desc())
        .limit(200)
    )
    existing_db_messages: list[InboxMessage] = recent_msgs_result.scalars().all()
    existing_dicts = [_to_message_dict(m) for m in existing_db_messages]

    new_messages: list[InboxMessage] = []
    event_signals: list[dict[str, Any]] = []
    duplicate_alerts_to_save: list[dict[str, Any]] = []

    for raw in all_raw_emails:
        # Ignorer si déjà en base
        if raw.get("external_id") in existing_ext_ids:
            continue

        # Analyse IA ou heuristique
        subject = raw.get("subject", "")
        body = raw.get("body_text") or raw.get("snippet", "")

        if use_ai:
            analysis = await detect_event_with_ai(subject, body, today_iso)
        else:
            from backend.messaging.mail_analyzer import detect_event_heuristic
            analysis = detect_event_heuristic(subject, body)

        # Empreinte sémantique
        fingerprint = build_topic_fingerprint(subject, body)

        # Création de l'objet InboxMessage
        msg = InboxMessage(
            user_id=current_user.id,
            external_id=raw.get("external_id"),
            provider=raw["provider"],
            sender=raw.get("sender"),
            subject=subject,
            snippet=raw.get("snippet"),
            body_text=body,
            received_at=raw.get("received_at"),
            contains_event=analysis.get("contains_event", False),
            event_title=analysis.get("event_title"),
            event_date=analysis.get("event_date"),
            event_time=analysis.get("event_time"),
            event_location=analysis.get("event_location"),
            event_confidence=analysis.get("event_confidence", 0.0),
            topic_fingerprint=fingerprint,
        )
        db.add(msg)
        new_messages.append(msg)

        # Signal événement si détecté
        if analysis.get("contains_event"):
            event_signals.append({
                "message_id": str(msg.id) if msg.id else None,
                "provider": msg.provider,
                "sender": msg.sender,
                "subject": msg.subject,
                "event_title": msg.event_title,
                "event_date": msg.event_date,
                "event_time": msg.event_time,
                "event_location": msg.event_location,
                "confidence": msg.event_confidence,
            })

        # Détection de doublons avec les messages existants
        new_dict = {
            "id": msg.id,
            "provider": msg.provider,
            "subject": msg.subject,
            "topic_fingerprint": fingerprint,
            "received_at": msg.received_at,
        }
        duplicates = find_duplicates(new_dict, existing_dicts)
        for dup in duplicates:
            # Vérifier qu'une alerte identique n'existe pas déjà
            duplicate_alerts_to_save.append({
                "msg_new": msg,
                "msg_id_existing": dup["message_id"],
                "score": dup["similarity_score"],
                "summary": dup["summary"],
            })

        # Ajouter le nouveau message aux existants pour déduplication intra-lot
        existing_dicts.append(new_dict)

    # Flush pour obtenir les IDs générés
    await db.flush()

    # Persister les alertes de doublons
    saved_alerts: list[DuplicateAlert] = []
    for alert_data in duplicate_alerts_to_save:
        # Récupérer l'UUID du message existant
        msg_id_existing = alert_data["msg_id_existing"]
        existing_msg_result = await db.execute(
            select(InboxMessage).where(
                and_(
                    InboxMessage.id == uuid.UUID(str(msg_id_existing)),
                    InboxMessage.user_id == current_user.id,
                )
            )
        )
        existing_msg = existing_msg_result.scalar_one_or_none()
        if not existing_msg:
            continue

        # Vérifier unicité de la paire
        pair_check = await db.execute(
            select(DuplicateAlert).where(
                and_(
                    DuplicateAlert.user_id == current_user.id,
                    DuplicateAlert.message_id_1 == alert_data["msg_new"].id,
                    DuplicateAlert.message_id_2 == existing_msg.id,
                )
            )
        )
        if pair_check.scalar_one_or_none():
            continue

        alert = DuplicateAlert(
            user_id=current_user.id,
            message_id_1=alert_data["msg_new"].id,
            message_id_2=existing_msg.id,
            similarity_score=alert_data["score"],
            summary=alert_data["summary"],
        )
        db.add(alert)
        saved_alerts.append(alert)

    await db.commit()

    return InboxFetchResponse(
        fetched_count=len(all_raw_emails),
        new_count=len(new_messages),
        event_signals=event_signals,
        duplicate_alerts=[
            {
                "summary": a.summary,
                "similarity_score": a.similarity_score,
            }
            for a in saved_alerts
        ],
        messages=[
            InboxMessageOut(
                id=m.id,
                provider=m.provider,
                sender=m.sender,
                subject=m.subject,
                snippet=m.snippet,
                received_at=m.received_at,
                contains_event=m.contains_event,
                event_title=m.event_title,
                event_date=m.event_date,
                event_time=m.event_time,
                event_location=m.event_location,
                event_confidence=m.event_confidence,
            )
            for m in new_messages
        ],
    )


# ---------------------------------------------------------------------------
# 2. Lister les messages stockés
# ---------------------------------------------------------------------------

@router.get("/messages", response_model=list[InboxMessageOut])
async def list_messages(
    provider: str | None = Query(None, description="Filtrer par provider : google | microsoft"),
    contains_event: bool | None = Query(None, description="Filtrer par détection d'événement"),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Liste les emails stockés avec filtres optionnels."""
    q = select(InboxMessage).where(InboxMessage.user_id == current_user.id)
    if provider:
        q = q.where(InboxMessage.provider == provider)
    if contains_event is not None:
        q = q.where(InboxMessage.contains_event == contains_event)
    q = q.order_by(InboxMessage.received_at.desc()).limit(limit)
    result = await db.execute(q)
    messages = result.scalars().all()
    return [
        InboxMessageOut(
            id=m.id,
            provider=m.provider,
            sender=m.sender,
            subject=m.subject,
            snippet=m.snippet,
            received_at=m.received_at,
            contains_event=m.contains_event,
            event_title=m.event_title,
            event_date=m.event_date,
            event_time=m.event_time,
            event_location=m.event_location,
            event_confidence=m.event_confidence,
        )
        for m in messages
    ]


# ---------------------------------------------------------------------------
# 3. Relancer la détection de doublons sur l'historique
# ---------------------------------------------------------------------------

@router.post("/check-duplicates", response_model=CheckDuplicatesResponse)
async def check_duplicates_manual(
    hours_back: int = Query(48, ge=1, le=720, description="Fenêtre temporelle (heures)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Relance une analyse de déduplication sur les messages récents.
    Utile si la fenêtre temporelle a changé ou si de nouveaux messages ont été ajoutés.
    """
    from datetime import timedelta
    since = datetime.utcnow() - timedelta(hours=hours_back)

    result = await db.execute(
        select(InboxMessage)
        .where(
            and_(
                InboxMessage.user_id == current_user.id,
                InboxMessage.fetched_at >= since,
            )
        )
        .order_by(InboxMessage.received_at.asc())
    )
    messages: list[InboxMessage] = result.scalars().all()

    new_alerts: list[DuplicateAlert] = []
    processed: list[dict] = []

    for i, msg in enumerate(messages):
        msg_dict = _to_message_dict(msg)
        duplicates = find_duplicates(msg_dict, processed)

        for dup in duplicates:
            # Vérifier unicité
            pair_check = await db.execute(
                select(DuplicateAlert).where(
                    and_(
                        DuplicateAlert.user_id == current_user.id,
                        DuplicateAlert.message_id_1 == msg.id,
                        DuplicateAlert.message_id_2 == uuid.UUID(str(dup["message_id"])),
                    )
                )
            )
            if pair_check.scalar_one_or_none():
                continue

            existing_msg_result = await db.execute(
                select(InboxMessage).where(
                    InboxMessage.id == uuid.UUID(str(dup["message_id"]))
                )
            )
            existing_msg = existing_msg_result.scalar_one_or_none()
            if not existing_msg:
                continue

            alert = DuplicateAlert(
                user_id=current_user.id,
                message_id_1=msg.id,
                message_id_2=existing_msg.id,
                similarity_score=dup["similarity_score"],
                summary=dup["summary"],
            )
            db.add(alert)
            new_alerts.append(alert)

        processed.append(msg_dict)

    await db.commit()

    return CheckDuplicatesResponse(
        analyzed_count=len(messages),
        new_alerts_count=len(new_alerts),
        alerts=[
            DuplicateAlertOut(
                id=a.id,
                summary=a.summary,
                similarity_score=a.similarity_score,
                acknowledged=a.acknowledged,
                created_at=a.created_at,
                message_id_1=a.message_id_1,
                message_id_2=a.message_id_2,
            )
            for a in new_alerts
        ],
    )


# ---------------------------------------------------------------------------
# 4. Lister les alertes actives
# ---------------------------------------------------------------------------

@router.get("/alerts", response_model=list[DuplicateAlertOut])
async def list_duplicate_alerts(
    acknowledged: bool = Query(False, description="Inclure les alertes acquittées"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Liste les alertes de doublons non acquittées (ou toutes)."""
    q = select(DuplicateAlert).where(DuplicateAlert.user_id == current_user.id)
    if not acknowledged:
        q = q.where(DuplicateAlert.acknowledged == False)
    q = q.order_by(DuplicateAlert.created_at.desc()).limit(100)
    result = await db.execute(q)
    alerts = result.scalars().all()
    return [
        DuplicateAlertOut(
            id=a.id,
            summary=a.summary,
            similarity_score=a.similarity_score,
            acknowledged=a.acknowledged,
            created_at=a.created_at,
            message_id_1=a.message_id_1,
            message_id_2=a.message_id_2,
        )
        for a in alerts
    ]


# ---------------------------------------------------------------------------
# 5. Acquitter une alerte
# ---------------------------------------------------------------------------

@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Marque une alerte de doublon comme acquittée."""
    result = await db.execute(
        select(DuplicateAlert).where(
            and_(
                DuplicateAlert.id == alert_id,
                DuplicateAlert.user_id == current_user.id,
            )
        )
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alerte introuvable.")
    alert.acknowledged = True
    await db.commit()
    return {"status": "acknowledged", "alert_id": str(alert_id)}
