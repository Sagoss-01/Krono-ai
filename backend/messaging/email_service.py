"""
email_service.py
----------------
Service d'envoi d'emails transactionnels (Resend ou SMTP)
avec mode simulation (MOCK) pour le développement.
"""

import os
import logging
import uuid
from typing import Dict, Any

logger = logging.getLogger("krono-email")

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
EMAIL_FROM = os.getenv("EMAIL_FROM", "krono-ai@updates.com")


async def send_email(to_email: str, subject: str, body_text: str) -> Dict[str, Any]:
    """
    Envoie un email ou simule l'envoi en console si aucune clé n'est fournie.
    """
    # 1. Mode simulation si aucune configuration
    if not RESEND_API_KEY and not SMTP_HOST:
        msg_id = f"mock-email-{uuid.uuid4().hex[:8]}"
        print("\n" + "="*55)
        print("📧 [SIMULATION EMAIL ENVOYÉ]")
        print(f"   Destinataire : {to_email}")
        print(f"   Objet        : {subject}")
        print(f"   Expéditeur   : {EMAIL_FROM}")
        print(f"   ID Message   : {msg_id}")
        print("   Corps :")
        for line in body_text.splitlines():
            print(f"     | {line}")
        print("="*55 + "\n")
        return {
            "status": "simulated",
            "channel": "email",
            "recipient": to_email,
            "message_id": msg_id,
            "detail": f"Email simulé en console vers {to_email}",
        }

    # 2. Envoi via Resend si clé présente
    if RESEND_API_KEY:
        try:
            import resend
            resend.api_key = RESEND_API_KEY
            params = {
                "from": EMAIL_FROM,
                "to": [to_email],
                "subject": subject,
                "text": body_text,
            }
            res = resend.Emails.send(params)
            return {
                "status": "sent",
                "channel": "email",
                "recipient": to_email,
                "message_id": str(res.get("id", uuid.uuid4().hex)),
                "detail": f"Email expédié avec succès via Resend vers {to_email}",
            }
        except Exception as e:
            logger.error(f"Erreur Resend : {str(e)}")
            raise e

    # 3. Envoi via SMTP si configuré
    try:
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart

        msg = MIMEMultipart()
        msg["From"] = EMAIL_FROM
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.attach(MIMEText(body_text, "plain"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            if SMTP_USER and SMTP_PASS:
                server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(EMAIL_FROM, to_email, msg.as_string())

        msg_id = f"smtp-{uuid.uuid4().hex[:8]}"
        return {
            "status": "sent",
            "channel": "email",
            "recipient": to_email,
            "message_id": msg_id,
            "detail": f"Email expédié avec succès via SMTP vers {to_email}",
        }
    except Exception as e:
        logger.error(f"Erreur SMTP : {str(e)}")
        raise e
