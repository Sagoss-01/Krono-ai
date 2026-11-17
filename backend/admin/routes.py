"""
routes.py (admin)
-----------------
Panneau d'administration superviseur adapté de TechSphere pour Krono AI :
- Tableau de bord superviseur (métriques utilisateurs, événements, messagerie, IA)
- Gestion des utilisateurs (suspension, réactivation, attribution du rôle admin)
- Audit & Journaux d'activité (AuditLog)
- Configuration des modèles IA & feedback des utilisateurs
"""

import uuid
from datetime import datetime, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, desc, delete
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from backend.auth.routes import get_current_user
from backend.database import get_db
from backend.models.db_models import (
    User, Event, InboxMessage, DuplicateAlert, AuditLog,
    AiSetting, AiFeedback, UserDevice
)

router = APIRouter(prefix="/admin", tags=["admin"])


# ─── MIDDLEWARE / DÉPENDANCE ADMINISTRATEUR ──────────────────────────────────

async def require_admin(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Vérifie que l'utilisateur possède le statut administrateur.
    Si aucun administrateur n'est encore configuré en base, le premier utilisateur
    connecté est automatiquement promu administrateur pour l'initialisation.
    """
    if current_user.is_admin:
        return current_user

    # Vérification s'il existe déjà un admin
    stmt = select(func.count(User.id)).where(User.is_admin == True)
    res = await db.execute(stmt)
    admin_count = res.scalar() or 0

    if admin_count == 0:
        # Auto-promotion du premier utilisateur
        current_user.is_admin = True
        db.add(AuditLog(
            user_id=current_user.id,
            user_email=current_user.email,
            action="AUTO_ADMIN_PROMOTION",
            details="Premier utilisateur promu Administrateur Système"
        ))
        await db.commit()
        return current_user

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Accès réservé aux administrateurs de Krono AI."
    )


# ─── 1. VUE D'ENSEMBLE SUPERVISEUR ──────────────────────────────────────────

@router.get("/overview")
async def get_admin_overview(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Statistiques globales sur l'usage, les données et la charge système."""
    # Nombre d'utilisateurs
    stmt_u = select(func.count(User.id))
    total_users = (await db.execute(stmt_u)).scalar() or 0

    # Nombre d'événements
    stmt_e = select(func.count(Event.id))
    total_events = (await db.execute(stmt_e)).scalar() or 0

    # Nombre de mails analysés
    stmt_m = select(func.count(InboxMessage.id))
    total_messages = (await db.execute(stmt_m)).scalar() or 0

    # Nombre de conflits / doublons détectés
    stmt_d = select(func.count(DuplicateAlert.id))
    total_alerts = (await db.execute(stmt_d)).scalar() or 0

    # Nombre d'appareils actifs
    stmt_dev = select(func.count(UserDevice.id))
    total_devices = (await db.execute(stmt_dev)).scalar() or 0

    return {
        "kpis": {
            "total_users": total_users,
            "total_events": total_events,
            "total_messages_analyzed": total_messages,
            "total_duplicate_alerts": total_alerts,
            "active_devices": total_devices,
        },
        "system": {
            "status": "healthy",
            "version": "Krono AI 2.0 (TechSphere Edition)",
            "llm_engine": "Google Gemini 2.5 Flash / LangGraph Workflow",
            "db_type": "PostgreSQL Async (SQLAlchemy 2.0)",
        }
    }


# ─── 2. GESTION DES UTILISATEURS ────────────────────────────────────────────

@router.get("/users")
async def list_users(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Liste complète des utilisateurs et leurs rôles."""
    stmt = select(User).order_by(User.created_at.desc())
    res = await db.execute(stmt)
    users = res.scalars().all()

    return [
        {
            "id": str(u.id),
            "email": u.email,
            "full_name": u.full_name or "Non renseigné",
            "is_admin": u.is_admin,
            "is_suspended": u.is_suspended,
            "two_factor_enabled": u.two_factor_enabled,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.post("/users/{user_id}/suspend")
async def suspend_user(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Suspend un utilisateur (interdit de connexion)."""
    stmt = select(User).where(User.id == user_id)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas suspendre votre propre compte.")

    user.is_suspended = True
    db.add(AuditLog(
        user_id=admin.id,
        user_email=admin.email,
        action="USER_SUSPENDED",
        target=user.email,
        details="Compte suspendu par l'administrateur"
    ))
    await db.commit()
    return {"ok": True, "message": f"Utilisateur {user.email} suspendu."}


@router.post("/users/{user_id}/unsuspend")
async def unsuspend_user(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Réactive un utilisateur suspendu."""
    stmt = select(User).where(User.id == user_id)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    user.is_suspended = False
    db.add(AuditLog(
        user_id=admin.id,
        user_email=admin.email,
        action="USER_UNSUSPENDED",
        target=user.email,
        details="Compte réactivé par l'administrateur"
    ))
    await db.commit()
    return {"ok": True, "message": f"Utilisateur {user.email} réactivé."}


@router.post("/users/{user_id}/toggle-admin")
async def toggle_admin_role(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Alterne les privilèges administrateur d'un utilisateur."""
    stmt = select(User).where(User.id == user_id)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous retirer vous-même le rôle administrateur.")

    user.is_admin = not user.is_admin
    action_str = "ADMIN_PROMOTED" if user.is_admin else "ADMIN_DEMOTED"
    db.add(AuditLog(
        user_id=admin.id,
        user_email=admin.email,
        action=action_str,
        target=user.email,
        details=f"Rôle admin modifié à : {user.is_admin}"
    ))
    await db.commit()
    return {"ok": True, "is_admin": user.is_admin}


# ─── 3. AUDIT & JOURNAUX D'ACTIVITÉ ─────────────────────────────────────────

@router.get("/audit")
async def get_audit_logs(
    limit: int = 50,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Récupère les derniers journaux d'audit de sécurité."""
    stmt = select(AuditLog).order_by(desc(AuditLog.created_at)).limit(limit)
    res = await db.execute(stmt)
    logs = res.scalars().all()

    return [
        {
            "id": str(l.id),
            "user_email": l.user_email or "Système / Anonyme",
            "action": l.action,
            "target": l.target,
            "details": l.details,
            "ip_address": l.ip_address,
            "timestamp": l.created_at.isoformat() if l.created_at else None,
        }
        for l in logs
    ]


# ─── 4. PARAMÈTRES IA & FEEDBACKS ───────────────────────────────────────────

class AiSettingsUpdate(BaseModel):
    default_model: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None

@router.get("/ai/settings")
async def get_ai_settings(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Retourne la configuration actuelle de l'assistant IA."""
    stmt = select(AiSetting)
    res = await db.execute(stmt)
    settings_rows = res.scalars().all()

    defaults = {
        "default_model": "gemini-2.5-flash",
        "system_prompt": "Tu es Aura, l'assistant intelligent de Krono AI spécialisé dans la gestion de planning et l'arbitrage d'agenda.",
        "temperature": "0.2",
    }
    for row in settings_rows:
        defaults[row.key] = row.value

    return defaults


@router.post("/ai/settings")
async def update_ai_settings(
    payload: AiSettingsUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Met à jour les paramètres globaux de l'IA."""
    mapping = {
        "default_model": payload.default_model,
        "system_prompt": payload.system_prompt,
        "temperature": str(payload.temperature) if payload.temperature is not None else None,
    }

    for k, v in mapping.items():
        if v is not None:
            stmt = select(AiSetting).where(AiSetting.key == k)
            res = await db.execute(stmt)
            setting = res.scalar_one_or_none()
            if not setting:
                setting = AiSetting(key=k, value=str(v))
                db.add(setting)
            else:
                setting.value = str(v)
                setting.updated_at = datetime.utcnow()

    db.add(AuditLog(
        user_id=admin.id,
        user_email=admin.email,
        action="AI_SETTINGS_UPDATED",
        details="Mise à jour des paramètres du modèle IA"
    ))
    await db.commit()
    return {"ok": True, "message": "Paramètres IA enregistrés."}


@router.get("/ai/feedbacks")
async def get_ai_feedbacks(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Consulte les retours et notes des utilisateurs sur les réponses IA."""
    stmt = select(AiFeedback).order_by(desc(AiFeedback.created_at)).limit(50)
    res = await db.execute(stmt)
    feedbacks = res.scalars().all()

    return [
        {
            "id": str(f.id),
            "feedback_type": f.feedback_type,
            "comment": f.comment,
            "conversation_id": f.conversation_id,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        }
        for f in feedbacks
    ]

