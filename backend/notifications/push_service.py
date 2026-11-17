"""
push_service.py
-----------------
Notifications push via pywebpush avec mode simulation (MOCK) de developpement.
"""

import json
import logging
from enum import Enum
from pywebpush import webpush, WebPushException

from backend.config import settings

logger = logging.getLogger("krono-push")


class Urgency(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


_SOUND_MAP = {
    Urgency.LOW: "bip_discret.mp3",
    Urgency.NORMAL: "notif_standard.mp3",
    Urgency.HIGH: "alerte_haute.mp3",
    Urgency.CRITICAL: "alarme_critique.mp3",
}


def send_push_notification(
    subscription_info: dict,
    title: str,
    body: str,
    urgency: Urgency = Urgency.NORMAL,
    actions: list[dict] | None = None,
) -> bool:
    payload = {
        "title": title,
        "body": body,
        "urgency": urgency.value,
        "sound": _SOUND_MAP[urgency],
        "actions": actions or [],
    }

    if not settings.vapid_private_key or not settings.vapid_public_key:
        print(f"\n📢 [SIMULATION PUSH NOTIFICATION]")
        print(f"   Endpoint : {subscription_info.get('endpoint', '')[:50]}...")
        print(f"   Titre    : {title}")
        print(f"   Corps    : {body}")
        print(f"   Urgence  : {urgency.value} (Son : {_SOUND_MAP[urgency]})")
        if actions:
            print(f"   Actions  : {actions}")
        return True

    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_admin_email},
        )
        return True
    except WebPushException as e:
        logger.error(f"WebPushException : {str(e)}")
        return False
    except Exception as e:
        logger.error(f"WebPush inattendue : {str(e)}")
        return False
