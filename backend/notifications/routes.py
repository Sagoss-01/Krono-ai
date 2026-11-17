"""
routes.py (notifications)
-------------------------
Endpoints pour enregistrer les abonnements push et déclencher des notifications.
"""

from fastapi import APIRouter, Depends, HTTPException

from backend.auth.routes import get_current_user
from backend.models.db_models import User
from backend.notifications.push_service import send_push_notification, Urgency

router = APIRouter(prefix="/notifications", tags=["notifications"])

# Stockage en mémoire pour la démo
_subscriptions = {}  # user_id -> subscription_info (dict)


@router.post("/subscribe")
async def subscribe(
    subscription: dict,
    current_user: User = Depends(get_current_user),
):
    _subscriptions[str(current_user.id)] = subscription
    return {"status": "success", "message": "Abonnement enregistré avec succès."}


@router.post("/trigger")
async def trigger_notification(
    title: str,
    body: str,
    urgency: str = "normal",
    current_user: User = Depends(get_current_user),
):
    sub = _subscriptions.get(str(current_user.id))
    if not sub:
        # Fallback pour la simulation en mode dev
        sub = {"endpoint": "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA..."}

    try:
        urg = Urgency(urgency)
    except ValueError:
        urg = Urgency.NORMAL

    success = send_push_notification(sub, title, body, urg)
    if success:
        return {"status": "success", "message": "Notification envoyée."}
    else:
        raise HTTPException(status_code=500, detail="Échec de l'envoi de la notification.")
