"""
routes.py (briefing)
---------------------
Routes pour le Briefing Matinal intelligent.
"""

from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.auth.routes import get_current_user
from backend.models.db_models import User
from backend.briefing.service import generate_morning_briefing

router = APIRouter(prefix="/briefing", tags=["briefing"])


@router.get("/today")
async def get_morning_briefing(
    date: Optional[str] = Query(None, description="Date cible au format YYYY-MM-DD (par défaut aujourd'hui)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Retourne la synthèse quotidienne du Briefing Matinal pour l'utilisateur connecté :
    audio-ready text, indicateurs statistiques, alertes départ et timeline.
    """
    try:
        briefing = await generate_morning_briefing(
            user=current_user,
            db=db,
            target_date_iso=date,
        )
        return briefing
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors de la génération du briefing matinal : {str(e)}"
        )


@router.post("/regenerate")
async def regenerate_morning_briefing(
    date: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Force une nouvelle génération du briefing pour la date spécifiée."""
    try:
        briefing = await generate_morning_briefing(
            user=current_user,
            db=db,
            target_date_iso=date,
        )
        return briefing
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors de la régénération du briefing : {str(e)}"
        )
