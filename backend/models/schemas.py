"""
schemas.py
----------
Contrats de données Pydantic de validation d'API.
"""

from datetime import datetime
from typing import Any
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field, field_validator


# --- Auth ---
class UserCreate(BaseModel):
    """
    Données d'inscription. Règles de mot de passe :
    - 8 caractères minimum ;
    - 72 octets maximum : limite imposée par l'algorithme bcrypt, au-delà
      le reste du mot de passe serait silencieusement ignoré ;
    - au moins une lettre et un chiffre.
    """
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    full_name: str | None = Field(default=None, max_length=255)

    @field_validator("password")
    @classmethod
    def password_has_letter_and_digit(cls, value: str) -> str:
        if not any(c.isalpha() for c in value) or not any(c.isdigit() for c in value):
            raise ValueError("Le mot de passe doit contenir au moins une lettre et un chiffre.")
        return value


class UserLogin(BaseModel):
    email: EmailStr
    # Pas de règle de format à la connexion : on vérifie seulement le hash.
    password: str = Field(min_length=1, max_length=72)


class UserOut(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str | None
    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# --- Événements ---
class EventCreate(BaseModel):
    title: str
    start_time: datetime
    end_time: datetime
    location: str | None = None
    description: str | None = None
    constraint_type: str = "soft"  # "hard" | "soft"


class EventUpdate(BaseModel):
    """Tous les champs sont optionnels pour permettre les mises à jour partielles."""
    title: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    location: str | None = None
    description: str | None = None
    constraint_type: str | None = None  # "hard" | "soft"


class EventOut(BaseModel):
    id: UUID
    title: str
    start_time: datetime
    end_time: datetime
    location: str | None
    constraint_type: str
    status: str
    source: str
    external_id: str | None = None
    model_config = {"from_attributes": True}


# --- Parsing & Intent IA ---
class ParsedTaskIntent(BaseModel):
    action: str  # ex: "create_event", "delete_event", "move_event", "geo_query", "send_message", "schedule_proposal"
    title: str | None = None      # None pour les requetes geo ou message
    date: str | None = None       # None pour les requetes geo ou message
    time: str | None = None       # HH:MM
    duration_minutes: int = 30
    priority: str = "normal"      # "low" | "normal" | "high" | "critical"
    geo_data: dict | None = None  # Donnees geo structurees (geocode, places, route)
    
    # Champs pour l'action send_message
    channel: str | None = None           # "whatsapp" | "email"
    recipient_name: str | None = None    # Nom extrait du destinataire (ex: "Thomas")
    message_body: str | None = None      # Corps ou intention du message
    subject: str | None = None           # Objet (pour email)
    delay_minutes: int | None = None     # Minutage du retard si excuse


# --- Messages & Brouillons IA ---
class MessageDraftOut(BaseModel):
    channel: str                         # "whatsapp" | "email"
    recipient_name: str
    recipient_target: str                # Téléphone (+33...) ou email
    subject: str | None = None
    body: str
    delay_minutes: int | None = None


# --- Intentions Floues & Optimisation Dynamique ---
class FuzzyTaskItem(BaseModel):
    raw_thought: str
    deduced_title: str
    category: str = "personal_care"  # personal_care, groceries, health, work, sport, home_errands, leisure
    duration_minutes: int = 45
    preferred_day_type: str = "any"  # weekend, weekday, any
    preferred_days: list[str] = []   # ex: ["dimanche", "samedi"]
    preferred_hour: int | None = None  # ex: 17
    preferred_time_of_day: str = "any"  # morning, afternoon, late_afternoon, evening
    deadline_iso: str | None = None
    priority: str = "normal"  # low, normal, high, critical
    reasoning: str | None = None


class ScheduleProposalItem(BaseModel):
    id: str
    title: str
    start_time: datetime
    end_time: datetime
    formatted_slot: str  # ex: "Dimanche à 17h00"
    duration_minutes: int
    category: str = "personal_care"
    constraint_type: str = "soft"
    reasoning: str
    proposal_text: str  # ex: "Proposition : ajouter un événement « rdv chez le coiffeur » Dimanche à 17h"


class ScheduleProposal(BaseModel):
    items: list[ScheduleProposalItem]
    summary_message: str


class OptimizeFuzzyRequest(BaseModel):
    text: str
    today_iso: str | None = None


class OptimizeFuzzyResponse(BaseModel):
    status: str
    summary: str
    tasks: list[FuzzyTaskItem]
    proposals: list[ScheduleProposalItem]


class BatchCreateEventsRequest(BaseModel):
    events: list[EventCreate]


class BatchCreateEventsResponse(BaseModel):
    created_count: int
    events: list[EventOut]


# --- Agent Langgraph ---
class AgentProcessRequest(BaseModel):
    text: str
    today_iso: str | None = None


class AgentProcessResponse(BaseModel):
    status: str
    message: str
    intent: ParsedTaskIntent | None = None
    conflicts_detected: list[str] = []
    relocations: dict[str, Any] = {}  # nom_evenement -> creneau (calendrier) ou geo_data (geo)
    proposal: ScheduleProposal | None = None
    message_draft: MessageDraftOut | None = None


# --- Contacts ---
class ContactCreate(BaseModel):
    name: str
    email: str | None = None
    phone_number: str | None = None
    company: str | None = None
    notes: str | None = None
    is_favorite: bool = False


class ContactUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone_number: str | None = None
    company: str | None = None
    notes: str | None = None
    is_favorite: bool | None = None


class ContactOut(BaseModel):
    id: UUID
    user_id: UUID
    name: str
    email: str | None = None
    phone_number: str | None = None
    company: str | None = None
    notes: str | None = None
    is_favorite: bool = False
    created_at: datetime
    model_config = {"from_attributes": True}


class BatchImportContactsRequest(BaseModel):
    contacts: list[ContactCreate]


class BatchImportContactsResponse(BaseModel):
    imported_count: int
    contacts: list[ContactOut]


# --- Envoi Réel de Messages (Email & WhatsApp) ---
class SendMessageRequest(BaseModel):
    channel: str              # "whatsapp" | "email"
    recipient: str            # Téléphone (+33...) ou adresse email
    subject: str | None = None
    body: str


class SendMessageResponse(BaseModel):
    status: str               # "sent" | "simulated" | "error"
    channel: str
    recipient: str
    message_id: str | None = None
    detail: str


# --- Excuses ---
class ExcuseRequest(BaseModel):
    delay_minutes: int
    meeting_title: str
    formality: str = "entreprise"


class ExcuseResponse(BaseModel):
    excuse: str


# --- ETA ---
class ETARequest(BaseModel):
    current_lat: float
    current_lng: float
    meeting_lat: float
    meeting_lng: float
    meeting_time: datetime


class ETAResponse(BaseModel):
    estimated_arrival: datetime
    delay_minutes: int
    is_late: bool


# --- Calendar ---
class CalendarLinkCreate(BaseModel):
    provider: str
    access_token: str
    refresh_token: str | None = None
    expires_in_seconds: int | None = 3600


class CalendarLinkOut(BaseModel):
    id: UUID
    provider: str
    token_expires_at: datetime | None
    model_config = {"from_attributes": True}


# --- Notifications ---
class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionInfo(BaseModel):
    endpoint: str
    keys: PushKeys


class PushTestRequest(BaseModel):
    title: str
    body: str
    urgency: str = "normal"


# --- Inbox / Lecture de mails ---

class InboxMessageOut(BaseModel):
    id: UUID
    provider: str                       # "google" | "microsoft"
    sender: str | None = None
    subject: str | None = None
    snippet: str | None = None
    received_at: datetime | None = None
    contains_event: bool
    event_title: str | None = None
    event_date: str | None = None       # ISO date ou None
    event_time: str | None = None       # HH:MM ou None
    event_location: str | None = None
    event_confidence: float = 0.0
    model_config = {"from_attributes": True}


class DuplicateAlertOut(BaseModel):
    id: UUID
    summary: str | None = None
    similarity_score: float
    acknowledged: bool
    created_at: datetime
    message_id_1: UUID
    message_id_2: UUID
    model_config = {"from_attributes": True}


class EventSignal(BaseModel):
    """Signalement d'un événement potentiel détecté dans un mail."""
    message_id: str | None = None
    provider: str
    sender: str | None = None
    subject: str | None = None
    event_title: str | None = None
    event_date: str | None = None
    event_time: str | None = None
    event_location: str | None = None
    confidence: float = 0.0


class DuplicateAlertSummary(BaseModel):
    summary: str
    similarity_score: float


class InboxFetchResponse(BaseModel):
    """Résultat d'une récupération de mails."""
    fetched_count: int                          # Nombre total de mails trouvés
    new_count: int                              # Mails réellement nouveaux (non encore stockés)
    event_signals: list[EventSignal]            # Événements détectés à inscrire sur l'agenda
    duplicate_alerts: list[DuplicateAlertSummary]  # Alertes de doublons thématiques
    messages: list[InboxMessageOut]             # Détail des nouveaux messages


class CheckDuplicatesResponse(BaseModel):
    """Résultat d'une analyse manuelle de déduplication."""
    analyzed_count: int
    new_alerts_count: int
    alerts: list[DuplicateAlertOut]

