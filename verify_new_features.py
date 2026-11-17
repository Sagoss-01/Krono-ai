"""
verify_new_features.py
-----------------------
Script de vérification automatisé pour :
1. L'import d'emploi du temps (Excel, Word, Image/Vision)
2. Le Briefing Matinal intelligent
"""

import asyncio
import io
import os
import sys
from datetime import datetime, date, timedelta

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


import openpyxl
import docx
from sqlalchemy import select

from backend.database import AsyncSessionLocal, engine, Base
from backend.models.db_models import User, Event, ConstraintType, EventStatus
from backend.schedule_import.document_parser import parse_document
from backend.schedule_import.ai_schedule_extractor import extract_schedule_from_document
from backend.briefing.service import generate_morning_briefing


def create_sample_excel() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "EmploiDuTemps"

    # En-têtes
    ws.append(["Heure", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"])
    ws.append(["08:30 - 10:30", "Mathématiques (Amphi A)", "Anglais (Salle 102)", "Algorithmique (Amphi B)", "Réseaux (Salle 204)", "Sport"])
    ws.append(["10:45 - 12:45", "Physique (Salle 201)", "Base de données (Labo 3)", "Projet Web", "Systèmes OS (Amphi A)", "Libre"])
    ws.append(["14:00 - 16:00", "TD Algorithmique", "TP Base de données", "Économie", "TD Mathématiques", "Libre"])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def create_sample_word() -> bytes:
    doc = docx.Document()
    doc.add_heading("Planning des cours de la semaine", level=1)
    doc.add_paragraph("Filière Informatique - Semestre 1")

    table = doc.add_table(rows=1, cols=4)
    hdr_cells = table.rows[0].cells
    hdr_cells[0].text = "Jour"
    hdr_cells[1].text = "Créneau"
    hdr_cells[2].text = "Matière"
    hdr_cells[3].text = "Salle"

    data = [
        ("Lundi", "09:00 - 11:00", "Intelligence Artificielle", "Amphi Turing"),
        ("Mardi", "14:00 - 16:00", "Sécurité des Systèmes", "Salle Cyber 1"),
        ("Jeudi", "10:00 - 12:00", "Développement Fullstack", "Labo 205"),
    ]
    for jour, horaire, matiere, salle in data:
        row_cells = table.add_row().cells
        row_cells[0].text = jour
        row_cells[1].text = horaire
        row_cells[2].text = matiere
        row_cells[3].text = salle

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


async def test_all_features():
    print("============================================================")
    print("🚀 TEST 1 : PARSING ET EXTRACTION DOCUMENTAIRE EXCEL & WORD")
    print("============================================================")

    # 1. Test Excel
    excel_bytes = create_sample_excel()
    parsed_excel = parse_document("edt_cours.xlsx", excel_bytes)
    print(f"📄 Type détecté : {parsed_excel['file_type']}")
    print(f"📝 Extrait texte :\n{parsed_excel['text_content'][:250]}...\n")

    res_excel = extract_schedule_from_document(parsed_excel, week_start_date_iso="2026-10-19", repeat_weeks=1)
    print(f"✅ Titre extrait : {res_excel['schedule_title']}")
    print(f"📊 Nombre de cours extraits : {res_excel['total_extracted']}")
    assert res_excel['total_extracted'] > 0, "L'extraction Excel doit identifier au moins un cours !"
    for ev in res_excel['events'][:3]:
        print(f"   👉 [{ev['day_of_week']} {ev['start_time_display']}-{ev['end_time_display']}] {ev['title']} ({ev['location']})")

    # 2. Test Word
    print("\n------------------------------------------------------------")
    word_bytes = create_sample_word()
    parsed_word = parse_document("cours_info.docx", word_bytes)
    print(f"📄 Type détecté : {parsed_word['file_type']}")

    res_word = extract_schedule_from_document(parsed_word, week_start_date_iso="2026-10-19", repeat_weeks=2)
    print(f"✅ Titre extrait : {res_word['schedule_title']}")
    print(f"📊 Nombre de cours extraits (sur 2 semaines) : {res_word['total_extracted']}")
    assert res_word['total_extracted'] >= 3, "L'extraction Word doit identifier les cours du tableau !"

    print("\n============================================================")
    print("🚀 TEST 2 : GÉNÉRATION DU BRIEFING MATINAL INTELLIGENT")
    print("============================================================")

    async with AsyncSessionLocal() as db:
        # Récupérer l'utilisateur de test
        result = await db.execute(select(User))
        user = result.scalars().first()
        if not user:
            print("[INFO] Création d'un utilisateur de test...")
            from backend.auth.security import hash_password
            import uuid
            user = User(
                id=uuid.uuid4(),
                email="test_briefing@krono.ai",
                hashed_password=hash_password("password123"),
                full_name="Alexandre Martin"
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)

        # Insérer quelques événements pour aujourd'hui
        today = date.today()
        # Nettoyer d'anciens événements tests du jour
        stmt_del = select(Event).where(Event.owner_id == user.id, Event.source == "briefing_test")
        res_del = await db.execute(stmt_del)
        for old_ev in res_del.scalars().all():
            await db.delete(old_ev)

        ev1 = Event(
            owner_id=user.id,
            title="Réunion de cadrage projet",
            start_time=datetime.combine(today, datetime.strptime("09:00", "%H:%M").time()),
            end_time=datetime.combine(today, datetime.strptime("10:30", "%H:%M").time()),
            location="Siège Krono, 10 Rue de la Paix, Paris",
            constraint_type=ConstraintType.HARD,
            status=EventStatus.CONFIRMED,
            source="briefing_test",
        )
        ev2 = Event(
            owner_id=user.id,
            title="Point équipe développement",
            start_time=datetime.combine(today, datetime.strptime("14:00", "%H:%M").time()),
            end_time=datetime.combine(today, datetime.strptime("15:00", "%H:%M").time()),
            location="Visioconférence Google Meet",
            constraint_type=ConstraintType.SOFT,
            status=EventStatus.CONFIRMED,
            source="briefing_test",
        )
        db.add(ev1)
        db.add(ev2)
        await db.commit()

        # Générer le Briefing Matinal
        briefing = await generate_morning_briefing(user, db, today.isoformat())

        print(f"👤 Salutation : {briefing['greeting']}")
        print(f"📅 Date       : {briefing['target_date']}")
        print(f"📊 Événements : {briefing['events_count']} ({briefing['total_hours']}h)")
        print(f"🗣️ Script Vocal :\n« {briefing['speech_text']} »\n")
        print("💡 Points forts :")
        for hl in briefing['highlights']:
            print(f"   • {hl}")

        if briefing.get('departure_alert'):
            dep = briefing['departure_alert']
            print(f"\n🚗 Alerte départ : Partir à {dep['recommended_departure']} pour {dep['event_title']} ({dep['location']})")

        print(f"\n🌟 Astuce du jour : {briefing['productivity_tip']}")

        assert briefing['events_count'] >= 2, "Le briefing doit contenir les événements du jour !"
        assert len(briefing['speech_text']) > 20, "Le script vocal doit être généré !"

    print("\n============================================================")
    print("🎉 TOUS LES TESTS D'IMPORT ET DE BRIEFING SONT VALIDÉS !")
    print("============================================================")


if __name__ == "__main__":
    asyncio.run(test_all_features())
