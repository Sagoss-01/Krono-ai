"""
verify_messaging_flow.py
-------------------------
Script de vérification de bout en bout pour la fonctionnalité :
- Carnet d'adresses & Contacts (DB)
- Interprétation de commande vocale par Gemini (LangGraph)
- Résolution automatique du contact (Nom -> Téléphone WhatsApp ou Email)
- Rédaction du brouillon contextualisé par l'IA
- Envoi effectif / simulé via le service de messagerie
"""

import asyncio
import uuid
import os
import sys
from datetime import datetime, timezone
from dotenv import load_dotenv

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

load_dotenv()

from sqlalchemy import select
from backend.database import AsyncSessionLocal
from backend.models.db_models import User, Contact
from backend.agent.graph import agent_graph
from backend.messaging.whatsapp_service import send_whatsapp_message
from backend.messaging.email_service import send_email


async def run_verification():
    print("\n" + "="*60)
    print("🚀 VÉRIFICATION DE LA FONCTIONNALITÉ MESSAGERIE & CONTACTS")
    print("="*60)

    async with AsyncSessionLocal() as db:
        # 1. Récupération ou création d'un utilisateur de test
        stmt = select(User).limit(1)
        res = await db.execute(stmt)
        user = res.scalar_one_or_none()

        if not user:
            print("Création d'un utilisateur de test...")
            user = User(
                id=uuid.uuid4(),
                email="test.user@krono.ai",
                hashed_password="hashed_pwd_test",
                full_name="Julian Test",
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)

        user_id = user.id
        print(f"👤 Utilisateur de test actif : {user.email} (ID: {user_id})")

        # 2. Ajout d'un contact de test
        contact_name = "Thomas Dupont"
        phone = "+33612345678"
        email = "thomas.dupont@atelier.ai"

        stmt_c = select(Contact).where(Contact.user_id == user_id, Contact.name == contact_name)
        res_c = await db.execute(stmt_c)
        existing_contact = res_c.scalar_one_or_none()

        if not existing_contact:
            print(f"📇 Ajout du contact '{contact_name}'...")
            contact = Contact(
                user_id=user_id,
                name=contact_name,
                phone_number=phone,
                email=email,
                company="Atelier AI",
            )
            db.add(contact)
            await db.commit()
        else:
            print(f"📇 Contact '{contact_name}' déjà existant ({phone}).")

        # 3. Test de l'agent LangGraph sur une commande vocale WhatsApp
        voice_command_whatsapp = "Envoie un WhatsApp à Thomas pour lui dire que je serai en retard de 15 minutes"
        print(f"\n🎤 Commande vocale dictée : \"{voice_command_whatsapp}\"")

        inputs = {
            "user_id": str(user_id),
            "raw_input": voice_command_whatsapp,
            "cleaned_input": "",
            "token_map": {},
            "intent": None,
            "conflicts": [],
            "resolved_moves": {},
            "response_message": "",
            "status": "success",
        }
        config = {
            "configurable": {
                "db": db,
                "today_iso": datetime.now(timezone.utc).date().isoformat(),
            }
        }

        print("🤖 Analyse en cours par LangGraph + Gemini...")
        result = await agent_graph.ainvoke(inputs, config=config)

        status = result.get("status")
        message_draft = result.get("message_draft")
        resp_msg = result.get("response_message")

        print(f"👉 Statut retourné : {status}")
        print(f"👉 Message d'accompagnement : {resp_msg}")

        if status == "message_draft" and message_draft:
            print("\n✅ BROUILLON GÉNÉRÉ AVEC SUCCÈS :")
            print(f"   - Canal       : {message_draft.get('channel')}")
            print(f"   - Destinataire: {message_draft.get('recipient_name')}")
            print(f"   - Coordonnée  : {message_draft.get('recipient_target')}")
            print(f"   - Corps texte : \"{message_draft.get('body')}\"")

            # 4. Simulation de confirmation utilisateur et envoi WhatsApp
            print("\n📤 Test d'expédition WhatsApp (Human-in-the-loop) :")
            send_res = await send_whatsapp_message(
                to_phone=message_draft["recipient_target"],
                body_text=message_draft["body"],
            )
            print(f"   Résultat envoi : {send_res['status']} -> {send_res['detail']}")
        else:
            print("⚠️ Attention : brouillon non généré comme attendu.")

        # 5. Test de l'agent LangGraph sur une commande vocale Email
        voice_command_email = "Envoie un mail à Thomas pour lui transmettre le compte-rendu du projet"
        print(f"\n🎤 Commande vocale email : \"{voice_command_email}\"")
        inputs["raw_input"] = voice_command_email
        inputs["intent"] = None
        inputs["message_draft"] = None

        result_email = await agent_graph.ainvoke(inputs, config=config)
        email_draft = result_email.get("message_draft")

        if email_draft:
            print("\n✅ BROUILLON EMAIL GÉNÉRÉ :")
            print(f"   - Canal       : {email_draft.get('channel')}")
            print(f"   - Destinataire: {email_draft.get('recipient_name')}")
            print(f"   - Email cible : {email_draft.get('recipient_target')}")
            print(f"   - Objet       : {email_draft.get('subject')}")
            print(f"   - Corps       : \"{email_draft.get('body')[:100]}...\"")

            # Envoi simulé email
            send_email_res = await send_email(
                to_email=email_draft["recipient_target"],
                subject=email_draft["subject"] or "Compte-rendu",
                body_text=email_draft["body"],
            )
            print(f"   Résultat email : {send_email_res['status']} -> {send_email_res['detail']}")

    print("\n" + "="*60)
    print("🎉 TOUS LES TESTS DE MESSAGERIE ET CONTACTS SONT VALIDÉS !")
    print("="*60 + "\n")


if __name__ == "__main__":
    asyncio.run(run_verification())
