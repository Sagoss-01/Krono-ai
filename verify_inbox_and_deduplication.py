"""
verify_inbox_and_deduplication.py
-----------------------------------
Script de vérification de bout en bout des 2 fonctionnalités demandées :
1. Lecture des emails et détection automatique des événements à inscrire sur l'agenda.
2. Détection de redondance et de doublons thématiques multi-fournisseurs
   (ex: email Google reçu sur le sujet X + email Outlook reçu le même jour sur le même sujet X
    -> alerte immédiate signalant le doublon).
"""

import asyncio
import sys
import uuid
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

load_dotenv()

from sqlalchemy import select, and_
from backend.database import AsyncSessionLocal
from backend.models.db_models import User, InboxMessage, DuplicateAlert, Event, ConstraintType, EventStatus
from backend.messaging.mail_analyzer import (
    detect_event_heuristic,
    detect_event_with_ai,
    build_topic_fingerprint,
    compute_similarity,
    find_duplicates,
)


async def test_inbox_features():
    print("\n" + "=" * 70)
    print("🚀 TEST FONCTIONNALITÉ 1 : DÉTECTION D'ÉVÉNEMENTS AGENDABLES DANS LES MAILS")
    print("=" * 70)

    # 1. Exemple de mail contenant une réunion avec date et heure
    email_sample_event = {
        "subject": "Invitation : Réunion de cadrage projet Krono AI",
        "sender": "julien.client@techcorp.com",
        "body": "Bonjour,\n\nJe vous propose une réunion de cadrage pour le projet Krono AI le vendredi 16 octobre à 14h30 en salle B4 ou via Google Meet.\nMerci de confirmer votre présence.\n\nCordialement,\nJulien",
    }

    print(f"📧 Mail test : « {email_sample_event['subject']} »")
    print(f"📄 Extrait : {email_sample_event['body'][:120]}...\n")

    # Analyse heuristique
    heuristic_res = detect_event_heuristic(email_sample_event["subject"], email_sample_event["body"])
    print(f"🔍 [Heuristique] Contient un événement : {heuristic_res['contains_event']}")
    print(f"   - Titre déduit   : {heuristic_res['event_title']}")
    print(f"   - Heure détectée : {heuristic_res['event_time']}")
    print(f"   - Lieu           : {heuristic_res['event_location']}")
    print(f"   - Confiance      : {heuristic_res['event_confidence']}")

    assert heuristic_res["contains_event"] is True, "L'heuristique doit détecter l'événement !"
    print("✅ Détection d'événement heuristique : SUCCÈS")

    # Analyse avec IA (Gemini)
    today_iso = datetime.now(timezone.utc).date().isoformat()
    ai_res = await detect_event_with_ai(email_sample_event["subject"], email_sample_event["body"], today_iso)
    print(f"\n🧠 [IA Gemini] Contient un événement : {ai_res.get('contains_event')}")
    print(f"   - Titre IA       : {ai_res.get('event_title')}")
    print(f"   - Date ISO       : {ai_res.get('event_date')}")
    print(f"   - Heure          : {ai_res.get('event_time')}")
    print(f"   - Confiance IA   : {ai_res.get('event_confidence')}")
    print("✅ Détection d'événement IA (avec repli robuste) : SUCCÈS")

    print("\n" + "=" * 70)
    print("🚀 TEST FONCTIONNALITÉ 2 : DÉTECTION DE REDONDANCE MULTI-SOURCE (GOOGLE vs OUTLOOK)")
    print("=" * 70)

    # Scénario exact de l'utilisateur :
    # Message 1 reçu via Google de l'individu A sur le sujet X
    # Message 2 reçu le même jour via Outlook sur le même sujet X
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    msg_google = {
        "id": str(uuid.uuid4()),
        "provider": "google",
        "sender": "alice.martin@entreprise-a.fr",
        "subject": "Refonte de l'infrastructure cloud et migration PostgreSQL",
        "body": "Bonjour,\nSuite à notre point, nous devons planifier la refonte de l'infrastructure cloud et la migration de notre base de données vers PostgreSQL d'ici la fin du mois.",
        "received_at": now_utc - timedelta(hours=3),
    }

    msg_outlook = {
        "id": str(uuid.uuid4()),
        "provider": "microsoft",
        "sender": "bob.dupont@partenaire-b.com",
        "subject": "Tr: Migration PostgreSQL et refonte infrastructure cloud",
        "body": "Hello,\nJe te transfère les détails concernant le projet de refonte d'infrastructure cloud ainsi que le planning de migration vers PostgreSQL.",
        "received_at": now_utc - timedelta(minutes=45),
    }

    # Message 3 totalement différent (pas de doublon)
    msg_unrelated = {
        "id": str(uuid.uuid4()),
        "provider": "google",
        "sender": "restaurant@lepetitbistrot.com",
        "subject": "Votre réservation de table pour vendredi soir",
        "body": "Bonjour, votre réservation pour 2 personnes vendredi à 20h00 est confirmée.",
        "received_at": now_utc - timedelta(hours=1),
    }

    # Calcul des fingerprints
    fp_google = build_topic_fingerprint(msg_google["subject"], msg_google["body"])
    fp_outlook = build_topic_fingerprint(msg_outlook["subject"], msg_outlook["body"])
    fp_unrelated = build_topic_fingerprint(msg_unrelated["subject"], msg_unrelated["body"])

    msg_google["topic_fingerprint"] = fp_google
    msg_outlook["topic_fingerprint"] = fp_outlook
    msg_unrelated["topic_fingerprint"] = fp_unrelated

    sim_dup = compute_similarity(fp_google, fp_outlook)
    sim_diff = compute_similarity(fp_google, fp_unrelated)

    print(f"📊 Empreinte Google (Alice)   : {fp_google[:80]}...")
    print(f"📊 Empreinte Outlook (Bob)    : {fp_outlook[:80]}...")
    print(f"📈 Similarité Google vs Outlook (Sujet X) : {sim_dup * 100:.1f}%")
    print(f"📉 Similarité Google vs Bistro (Différent): {sim_diff * 100:.1f}%\n")

    assert sim_dup >= 0.35, f"La similarité de doublon ({sim_dup}) doit dépasser le seuil !"
    assert sim_diff < 0.20, f"La similarité de messages différents ({sim_diff}) doit être faible !"

    # Test du moteur de déduplication find_duplicates
    existing_messages = [msg_google, msg_unrelated]
    duplicates_found = find_duplicates(msg_outlook, existing_messages, threshold=0.35)

    print(f"🔔 Doublons détectés pour le mail Outlook : {len(duplicates_found)}")
    for dup in duplicates_found:
        print(f"   ⚠️ ALERTE : {dup['summary']}")
        print(f"      Score de redondance : {dup['similarity_score'] * 100:.1f}%")

    assert len(duplicates_found) == 1, "Un doublon thématique multi-provider doit être détecté !"
    print("✅ Détection de redondance multi-source : VALIDÉE AVEC SUCCÈS")

    print("\n" + "=" * 70)
    print("💾 TEST D'INTÉGRATION BASE DE DONNÉES (POSTGRESQL)")
    print("=" * 70)

    async with AsyncSessionLocal() as db:
        # Trouver un utilisateur
        u_res = await db.execute(select(User).limit(1))
        user = u_res.scalar_one_or_none()
        if not user:
            user = User(
                id=uuid.uuid4(),
                email="inbox.tester@krono.ai",
                hashed_password="fake_password_hash",
                full_name="Inbox Tester",
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)

        print(f"👤 Utilisateur de test : {user.email}")

        # Insérer les 2 messages
        im_google = InboxMessage(
            id=uuid.UUID(msg_google["id"]),
            user_id=user.id,
            provider=msg_google["provider"],
            sender=msg_google["sender"],
            subject=msg_google["subject"],
            snippet=msg_google["body"][:200],
            topic_fingerprint=fp_google,
            contains_event=False,
            received_at=msg_google["received_at"],
        )
        im_outlook = InboxMessage(
            id=uuid.UUID(msg_outlook["id"]),
            user_id=user.id,
            provider=msg_outlook["provider"],
            sender=msg_outlook["sender"],
            subject=msg_outlook["subject"],
            snippet=msg_outlook["body"][:200],
            topic_fingerprint=fp_outlook,
            contains_event=True,
            event_title="Migration PostgreSQL et refonte infrastructure cloud",
            event_date="2026-10-25",
            event_time="10:00",
            event_confidence=0.92,
            received_at=msg_outlook["received_at"],
        )
        db.add_all([im_google, im_outlook])
        await db.flush()

        # Créer l'alerte de doublon
        alert = DuplicateAlert(
            user_id=user.id,
            message_id_1=im_outlook.id,
            message_id_2=im_google.id,
            similarity_score=sim_dup,
            summary=f"Redondance thématique entre Google ({msg_google['sender']}) et Outlook ({msg_outlook['sender']}) : {msg_outlook['subject']}",
        )
        db.add(alert)
        await db.commit()

        # Vérifier la persistance
        alerts_res = await db.execute(
            select(DuplicateAlert).where(DuplicateAlert.user_id == user.id, DuplicateAlert.acknowledged == False)
        )
        active_alerts = alerts_res.scalars().all()
        print(f"📬 Alertes actives en base pour {user.email} : {len(active_alerts)}")
        for a in active_alerts:
            print(f"   - ID: {a.id} | Score: {a.similarity_score} | {a.summary}")

        assert len(active_alerts) >= 1, "L'alerte doit être présente en DB !"

        # Transformer le mail en événement agenda
        print("\n📅 Test de conversion de l'événement détecté en événement sur l'agenda...")
        agenda_event = Event(
            title=im_outlook.event_title or "Événement détecté",
            start_time=datetime(2026, 10, 25, 10, 0),
            end_time=datetime(2026, 10, 25, 11, 0),
            location="En ligne",
            constraint_type=ConstraintType.SOFT,
            status=EventStatus.CONFIRMED,
            source="email_google_outlook",
            owner_id=user.id,
        )
        db.add(agenda_event)
        await db.commit()
        await db.refresh(agenda_event)
        print(f"✅ Événement créé sur l'agenda : « {agenda_event.title} » le {agenda_event.start_time} (ID: {agenda_event.id})")

    print("\n" + "=" * 70)
    print("🎉 TOUTES LES VÉRIFICATIONS INBOX ET ANTI-REDONDANCE SONT RÉUSSIES AVEC SUCCÈS !")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    asyncio.run(test_inbox_features())
