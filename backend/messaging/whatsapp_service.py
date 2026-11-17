"""
whatsapp_service.py
-------------------
Service d'envoi de messages WhatsApp (Meta Cloud API ou Twilio)
avec mode simulation (MOCK) pour le développement.
"""

import os
import logging
import uuid
import httpx
from typing import Dict, Any

logger = logging.getLogger("krono-whatsapp")

WHATSAPP_TOKEN = os.getenv("WHATSAPP_TOKEN", "")
WHATSAPP_PHONE_NUMBER_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_WHATSAPP_FROM = os.getenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")


async def send_whatsapp_message(to_phone: str, body_text: str) -> Dict[str, Any]:
    """
    Envoie un message WhatsApp ou simule l'envoi en console si aucune clé n'est fournie.
    """
    clean_phone = to_phone.replace(" ", "").replace("-", "")

    # 1. Mode simulation si aucune configuration
    if not WHATSAPP_TOKEN and not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN):
        msg_id = f"mock-wa-{uuid.uuid4().hex[:8]}"
        print("\n" + "="*55)
        print("💬 [SIMULATION WHATSAPP ENVOYÉ]")
        print(f"   Destinataire : {clean_phone}")
        print(f"   ID Message   : {msg_id}")
        print("   Message :")
        for line in body_text.splitlines():
            print(f"     | {line}")
        print("="*55 + "\n")
        return {
            "status": "simulated",
            "channel": "whatsapp",
            "recipient": clean_phone,
            "message_id": msg_id,
            "detail": f"Message WhatsApp simulé en console vers {clean_phone}",
        }

    # 2. Envoi via Meta WhatsApp Cloud API
    if WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID:
        url = f"https://graph.facebook.com/v20.0/{WHATSAPP_PHONE_NUMBER_ID}/messages"
        headers = {
            "Authorization": f"Bearer {WHATSAPP_TOKEN}",
            "Content-Type": "application/json",
        }
        # Format international requis sans '+' pour Meta
        target_number = clean_phone.lstrip("+")
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": target_number,
            "type": "text",
            "text": {"preview_url": False, "body": body_text},
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(url, headers=headers, json=payload, timeout=15.0)
            if resp.status_code not in (200, 201):
                logger.error(f"Erreur WhatsApp Meta API ({resp.status_code}) : {resp.text}")
                raise RuntimeError(f"Erreur Meta WhatsApp : {resp.text}")
            data = resp.json()
            msg_id = data.get("messages", [{}])[0].get("id", uuid.uuid4().hex)
            return {
                "status": "sent",
                "channel": "whatsapp",
                "recipient": clean_phone,
                "message_id": msg_id,
                "detail": f"Message WhatsApp expédié via Meta Cloud API vers {clean_phone}",
            }

    # 3. Envoi via Twilio
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
        twilio_url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
        data = {
            "From": TWILIO_WHATSAPP_FROM,
            "To": f"whatsapp:{clean_phone}",
            "Body": body_text,
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                twilio_url,
                data=data,
                auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                timeout=15.0,
            )
            if resp.status_code not in (200, 201):
                logger.error(f"Erreur Twilio WhatsApp ({resp.status_code}) : {resp.text}")
                raise RuntimeError(f"Erreur Twilio : {resp.text}")
            resp_data = resp.json()
            return {
                "status": "sent",
                "channel": "whatsapp",
                "recipient": clean_phone,
                "message_id": resp_data.get("sid", uuid.uuid4().hex),
                "detail": f"Message WhatsApp expédié via Twilio vers {clean_phone}",
            }

    raise RuntimeError("Configuration WhatsApp invalide.")
