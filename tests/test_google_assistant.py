"""
test_google_assistant.py
------------------------
Tests HORS RÉSEAU : connexion Google (état signé), import d'agenda, Gmail (construction et
lecture des messages), et actions e-mail / contact / réunion / recherche de l'assistant.

Lancer depuis la racine du projet :  python -m pytest tests/test_google_assistant.py
"""

import asyncio
import base64
from datetime import datetime, timedelta
from email.policy import default as default_policy
import email as email_lib

import jwt
import pytest

from backend.assistant import brain
from backend.assistant.context import EventFact
from backend.config import settings
from backend.google_workspace import google_api as g

NOW = datetime(2026, 11, 17, 9, 0)


def ev(ref, title, start, end, hard=False):
    return EventFact(ref=ref, id=ref.lower(), title=title, start=datetime.fromisoformat(start),
                     end=datetime.fromisoformat(end), location="", hard=hard)


CONTACTS = [{"name": "Marie Martin", "email": "marie@ex.fr"}]


def run_respond(data, history_text="Écris à Marie", contacts=CONTACTS, search_fn=None, monkeypatch=None):
    async def fake_generate(system, conversation):
        return data
    monkeypatch.setattr(brain.llm, "generate", fake_generate)
    return asyncio.run(brain.respond(
        history=[{"role": "user", "content": history_text}], now=NOW, events=[], places=[],
        contacts=contacts, travel=None, search_fn=search_fn))


# ─── Connexion Google : état signé ───────────────────────────────────────────

def test_state_roundtrip_returns_user_id():
    state = g.make_state("user-123")
    assert g.read_state(state) == "user-123"


def test_forged_or_foreign_state_is_rejected():
    forged = jwt.encode({"sub": "victime", "purpose": g.STATE_PURPOSE,
                         "exp": datetime.utcnow() + timedelta(minutes=5)}, "mauvaise-cle", algorithm="HS256")
    with pytest.raises(g.GoogleError):
        g.read_state(forged)
    other_purpose = jwt.encode({"sub": "u", "purpose": "autre", "exp": datetime.utcnow() + timedelta(minutes=5)},
                               settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    with pytest.raises(g.GoogleError):
        g.read_state(other_purpose)


def test_expired_state_is_rejected():
    expired = jwt.encode({"sub": "u", "purpose": g.STATE_PURPOSE, "exp": datetime.utcnow() - timedelta(minutes=1)},
                         settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    with pytest.raises(g.GoogleError):
        g.read_state(expired)


def test_auth_url_requests_gmail_and_calendar_scopes(monkeypatch):
    monkeypatch.setattr(g.settings, "google_client_id", "client-test")
    monkeypatch.setattr(g.settings, "google_client_secret", "secret-test")
    url = g.build_auth_url("u1")
    assert "gmail.send" in url and "gmail.readonly" in url and "calendar.events" in url
    assert "prompt=consent" in url and "access_type=offline" in url


# ─── Agenda Google ───────────────────────────────────────────────────────────

def test_google_event_parsing_handles_timezone_all_day_and_cancelled():
    timed = g.parse_google_event({"id": "a", "summary": "Cours", "location": "Campus",
                                  "start": {"dateTime": "2026-11-17T10:00:00+01:00"},
                                  "end": {"dateTime": "2026-11-17T11:30:00+01:00"}})
    assert timed["start"] == datetime(2026, 11, 17, 9, 0)  # converti en heure naïve UTC
    assert timed["location"] == "Campus"
    allday = g.parse_google_event({"id": "b", "summary": "Congé",
                                   "start": {"date": "2026-11-18"}, "end": {"date": "2026-11-19"}})
    assert allday["start"] == datetime(2026, 11, 18)
    assert g.parse_google_event({"id": "c", "status": "cancelled", "start": {"date": "2026-11-18"},
                                 "end": {"date": "2026-11-19"}}) is None


# ─── Gmail : construction et lecture ─────────────────────────────────────────

def test_mime_is_threaded_and_rejects_header_injection_upstream():
    mime = g.build_mime(sender="moi@gmail.com", to=["toi@ex.fr"], cc=["c@ex.fr"], subject="Réunion",
                        body="Bonjour", in_reply_to="<a@ex.fr>", references="<root@ex.fr>")
    parsed = email_lib.message_from_bytes(mime.as_bytes(), policy=default_policy)
    assert parsed["From"] == "moi@gmail.com" and parsed["Cc"] == "c@ex.fr"
    assert parsed["In-Reply-To"] == "<a@ex.fr>"
    assert parsed["References"] == "<root@ex.fr> <a@ex.fr>"
    with pytest.raises(ValueError):
        g.build_mime(sender="moi@gmail.com", to=["x@ex.fr"], cc=[], subject="A\r\nBcc: y@ex.fr", body="x")


def test_gmail_text_extraction_prefers_plain_and_decodes_base64():
    plain = base64.urlsafe_b64encode("Bonjour, à demain.".encode()).decode().rstrip("=")
    html = base64.urlsafe_b64encode("<p>Version HTML</p>".encode()).decode().rstrip("=")
    payload = {"mimeType": "multipart/alternative", "parts": [
        {"mimeType": "text/html", "body": {"data": html}},
        {"mimeType": "text/plain", "body": {"data": plain}},
    ]}
    assert g._extract_text(payload) == "Bonjour, à demain."
    html_only = {"mimeType": "text/html", "body": {"data": html}}
    assert g._extract_text(html_only) == "Version HTML"


def test_message_id_must_look_like_gmail_id():
    with pytest.raises(g.GoogleError):
        asyncio.run(g.gmail_get("token", "../../etc"))


# ─── Assistant : e-mails et destinataires ────────────────────────────────────

def test_email_to_known_contact_name_resolves_to_real_address(monkeypatch):
    out = run_respond({"reply": "Voici.", "suggestions": [], "actions": [
        {"type": "send_email", "ref": "", "title": "", "date": "", "start_time": "", "end_time": "",
         "location": "", "reason": "", "to": "Marie Martin", "cc": "", "subject": "Réunion jeudi",
         "body": "Bonjour Marie,\n\nJeudi 10h ?\n\nCordialement", "query": "", "name": "", "email": "",
         "phone": "", "company": ""}]}, monkeypatch=monkeypatch)
    act = out["actions"][0]
    assert act["type"] == "send_email"
    assert act["params"]["to"] == ["marie@ex.fr"]
    assert "Réunion jeudi" in act["label"]


def test_unknown_recipient_is_never_invented(monkeypatch):
    out = run_respond({"reply": "", "suggestions": [], "actions": [
        {"type": "send_email", "ref": "", "title": "", "date": "", "start_time": "", "end_time": "",
         "location": "", "reason": "", "to": "inconnu@evil.com", "cc": "", "subject": "Hello",
         "body": "Texte", "query": "", "name": "", "email": "", "phone": "", "company": ""}]}, monkeypatch=monkeypatch)
    assert out["actions"] == []
    assert "ne figure ni dans vos contacts" in out["reply"]


def test_address_typed_by_user_is_accepted(monkeypatch):
    out = run_respond({"reply": "", "suggestions": [], "actions": [
        {"type": "send_email", "ref": "", "title": "", "date": "", "start_time": "", "end_time": "",
         "location": "", "reason": "", "to": "paul@ex.fr", "cc": "", "subject": "Salut", "body": "Coucou",
         "query": "", "name": "", "email": "", "phone": "", "company": ""}]},
        history_text="Envoie un mail à paul@ex.fr", monkeypatch=monkeypatch)
    assert out["actions"][0]["params"]["to"] == ["paul@ex.fr"]


def test_scheduled_email_needs_future_date(monkeypatch):
    base = {"reply": "", "suggestions": [], "actions": [
        {"type": "schedule_email", "ref": "", "title": "", "date": "2026-11-16", "start_time": "10:00",
         "end_time": "", "location": "", "reason": "", "to": "Marie Martin", "cc": "", "subject": "Rappel",
         "body": "Texte", "query": "", "name": "", "email": "", "phone": "", "company": ""}]}
    past = run_respond(base, monkeypatch=monkeypatch)
    assert past["actions"] == []
    base["actions"][0]["date"] = "2026-11-18"
    base["actions"][0]["start_time"] = "08:30"
    future = run_respond(base, monkeypatch=monkeypatch)
    assert future["actions"][0]["params"]["send_at"] == "2026-11-18T08:30"


def test_contact_email_must_come_from_conversation(monkeypatch):
    out = run_respond({"reply": "", "suggestions": [], "actions": [
        {"type": "create_contact", "ref": "", "title": "", "date": "", "start_time": "", "end_time": "",
         "location": "", "reason": "", "to": "", "cc": "", "subject": "", "body": "",
         "query": "", "name": "Jean Kouassi", "email": "jean@invente.com", "phone": "", "company": ""}]},
        history_text="Ajoute Jean Kouassi", monkeypatch=monkeypatch)
    act = out["actions"][0]
    assert act["type"] == "create_contact" and act["params"]["name"] == "Jean Kouassi"
    assert act["params"]["email"] is None


def test_meeting_action_has_invitees_and_clash_warning(monkeypatch):
    async def fake_generate(system, conversation):
        return {"reply": "", "suggestions": [], "actions": [
            {"type": "create_meeting", "ref": "", "title": "Point projet", "date": "2026-11-17",
             "start_time": "09:30", "end_time": "10:30", "location": "", "reason": "", "to": "Marie Martin",
             "cc": "", "subject": "", "body": "", "query": "", "name": "", "email": "", "phone": "", "company": ""}]}
    monkeypatch.setattr(brain.llm, "generate", fake_generate)
    events = [ev("E1", "Cours", "2026-11-17T09:00", "2026-11-17T10:00")]
    out = asyncio.run(brain.respond(history=[{"role": "user", "content": "Planifie une réunion"}], now=NOW,
                                    events=events, places=[], contacts=CONTACTS, travel=None))
    act = out["actions"][0]
    assert act["type"] == "create_meeting"
    assert act["params"]["invitees"] == ["marie@ex.fr"]
    assert any("Cours" in w for w in act["warnings"])


# ─── Recherche Gmail : lecture seule, exécutée immédiatement ─────────────────

def test_search_runs_when_gmail_connected(monkeypatch):
    async def search(query):
        assert query == "from:marie is:unread"
        return [{"id": "m1", "subject": "Réunion", "from": "marie@ex.fr"}]
    out = run_respond({"reply": "Voici vos e-mails.", "suggestions": [], "actions": [
        {"type": "search_emails", "ref": "", "title": "", "date": "", "start_time": "", "end_time": "",
         "location": "", "reason": "", "to": "", "cc": "", "subject": "", "body": "",
         "query": "from:marie is:unread", "name": "", "email": "", "phone": "", "company": ""}]},
        search_fn=search, monkeypatch=monkeypatch)
    assert out["mail_results"] == [{"id": "m1", "subject": "Réunion", "from": "marie@ex.fr"}]
    assert out["actions"] == []


def test_search_without_google_explains_how_to_connect(monkeypatch):
    out = run_respond({"reply": "", "suggestions": [], "actions": [
        {"type": "search_emails", "ref": "", "title": "", "date": "", "start_time": "", "end_time": "",
         "location": "", "reason": "", "to": "", "cc": "", "subject": "", "body": "",
         "query": "is:unread", "name": "", "email": "", "phone": "", "company": ""}]}, monkeypatch=monkeypatch)
    assert out["mail_results"] is None
    assert "Connectez votre compte Google" in out["reply"]


# ─── Alias stables des contacts (le modèle relie « Marie » au contact sans voir son nom) ─────

def test_same_contact_gets_same_token_in_message_and_list():
    tokens = {}
    pairs = brain.contact_aliases([{"name": "Marie Martin", "email": "m@ex.fr"}], tokens)
    message = brain.apply_aliases("Écris à Marie pour jeudi", pairs)
    listed = brain._alias_for("Marie Martin", tokens)
    assert listed in message                       # même jeton dans le message et dans la liste
    assert brain._restore(listed, tokens) == "Marie Martin"


def test_ambiguous_first_name_is_not_aliased():
    tokens = {}
    contacts = [{"name": "Marie Martin", "email": "a@ex.fr"}, {"name": "Marie Dupont", "email": "b@ex.fr"}]
    pairs = brain.contact_aliases(contacts, tokens)
    assert brain.apply_aliases("Écris à Marie", pairs) == "Écris à Marie"  # deux Marie : on ne devine pas


def test_recipient_by_first_name_resolves_to_contact_address(monkeypatch):
    contacts = [{"name": "Marie Martin", "email": "marie@ex.fr"}]
    out = run_respond({"reply": "", "suggestions": [], "actions": [
        {"type": "send_email", "ref": "", "title": "", "date": "", "start_time": "", "end_time": "",
         "location": "", "reason": "", "to": "Marie", "cc": "", "subject": "Jeudi", "body": "Bonjour",
         "query": "", "name": "", "email": "", "phone": "", "company": ""}]},
        history_text="Écris à Marie pour jeudi", contacts=contacts, monkeypatch=monkeypatch)
    assert out["actions"][0]["params"]["to"] == ["marie@ex.fr"]


def test_first_name_inside_email_address_is_not_aliased():
    tokens = {}
    pairs = brain.contact_aliases([{"name": "TEST Marie Dupont", "email": "m@x.fr"}], tokens)
    text = brain.apply_aliases("Retrouve les mails de marie.test@example.com", pairs)
    assert "marie.test@example.com" in text


def test_search_intent_is_executed_even_if_model_forgets_the_action(monkeypatch):
    seen = {}

    async def search(query):
        seen["q"] = query
        return []

    out = run_respond({"reply": "Je lance la recherche.", "suggestions": [], "actions": []},
                      history_text="Retrouve les mails de marie.test@example.com non lus",
                      search_fn=search, monkeypatch=monkeypatch)
    assert seen["q"] == "from:marie.test@example.com is:unread"
    assert out["mail_results"] == []


def test_appointment_with_hour_gets_default_title_and_one_hour():
    from backend.assistant.brain import appointment_from_text
    act = appointment_from_text("ajoute un rendez vous a 16 h", NOW)
    assert act["type"] == "create_event" and act["start_time"] == "16:00" and act["end_time"] == "17:00"
    assert act["title"] == "Rendez-vous" and act["date"] == "2026-11-17"


def test_appointment_tomorrow_and_meeting_title():
    from backend.assistant.brain import appointment_from_text
    act = appointment_from_text("planifie une réunion demain à 10:30", NOW)
    assert act["date"] == "2026-11-18" and act["start_time"] == "10:30" and act["title"] == "Réunion"


def test_no_time_means_no_fallback_appointment():
    from backend.assistant.brain import appointment_from_text
    assert appointment_from_text("ajoute un rendez-vous", NOW) is None
    assert appointment_from_text("j'ai faim", NOW) is None


def test_fallback_creates_proposal_when_model_forgot_it(monkeypatch):
    out = run_respond({"reply": "Je vous propose un rendez-vous.", "suggestions": [], "actions": []},
                      history_text="ajoute un rendez vous a 16 h", monkeypatch=monkeypatch)
    assert out["actions"] and out["actions"][0]["type"] == "create_event"
