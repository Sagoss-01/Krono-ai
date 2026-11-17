"""
db_models.py
------------
Tables de base de données PostgreSQL avec SQLAlchemy ORM.
"""

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey, Enum, Text, Uuid, Boolean, Float, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


class ConstraintType(str, enum.Enum):
    HARD = "hard"
    SOFT = "soft"


class EventStatus(str, enum.Enum):
    CONFIRMED = "confirmed"
    CONFLICT = "conflict"
    TRANSPORT_BLOCK = "transport"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_suspended: Mapped[bool] = mapped_column(Boolean, default=False)
    two_factor_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    two_factor_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    recovery_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    recovery_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    recovery_expires: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())

    events: Mapped[list["Event"]] = relationship(back_populates="owner")
    calendar_links: Mapped[list["CalendarLink"]] = relationship(back_populates="user")
    contacts: Mapped[list["Contact"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    devices: Mapped[list["UserDevice"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class CalendarLink(Base):
    __tablename__ = "calendar_links"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    provider: Mapped[str] = mapped_column(String(50))  # "google" | "microsoft"
    encrypted_access_token: Mapped[str] = mapped_column(Text)
    encrypted_refresh_token: Mapped[str] = mapped_column(Text, nullable=True)
    token_expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    account_email: Mapped[str | None] = mapped_column(String(255), nullable=True)  # adresse du compte Google
    scopes: Mapped[str | None] = mapped_column(Text, nullable=True)                 # scopes accordés (espace-séparés)

    user: Mapped["User"] = relationship(back_populates="calendar_links")


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=True)
    phone_number: Mapped[str] = mapped_column(String(50), nullable=True)
    company: Mapped[str] = mapped_column(String(100), nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())

    user: Mapped["User"] = relationship(back_populates="contacts")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))

    title: Mapped[str] = mapped_column(String(255))
    start_time: Mapped[datetime] = mapped_column(DateTime)
    end_time: Mapped[datetime] = mapped_column(DateTime)
    location: Mapped[str] = mapped_column(String(255), nullable=True)
    # Coordonnées du lieu, calculées une fois par géocodage. geo_source garde le texte
    # du lieu utilisé : si le lieu change, les coordonnées sont recalculées.
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    geo_source: Mapped[str | None] = mapped_column(String(255), nullable=True)

    constraint_type: Mapped[ConstraintType] = mapped_column(
        Enum(ConstraintType), default=ConstraintType.SOFT
    )
    status: Mapped[EventStatus] = mapped_column(Enum(EventStatus), default=EventStatus.CONFIRMED)

    external_id: Mapped[str] = mapped_column(String(255), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(50), default="local")  # local | google | outlook

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())

    owner: Mapped["User"] = relationship(back_populates="events")


class InboxMessage(Base):
    """
    Représente un email lu depuis Gmail ou Outlook.
    Sert de base pour la détection d'événements et la déduplication.
    """
    __tablename__ = "inbox_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    # Identifiant externe (Gmail messageId ou Outlook id)
    external_id: Mapped[str] = mapped_column(String(255), nullable=True, index=True)
    # Fournisseur : "google" | "microsoft"
    provider: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # En-têtes du mail
    sender: Mapped[str] = mapped_column(String(255), nullable=True)
    subject: Mapped[str] = mapped_column(String(500), nullable=True)
    snippet: Mapped[str] = mapped_column(Text, nullable=True)   # Extrait du corps
    body_text: Mapped[str] = mapped_column(Text, nullable=True)  # Corps complet (tronqué)
    received_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)

    # Résultats d'analyse IA
    contains_event: Mapped[bool] = mapped_column(Boolean, default=False)
    event_title: Mapped[str] = mapped_column(String(255), nullable=True)
    event_date: Mapped[str] = mapped_column(String(50), nullable=True)   # ISO date
    event_time: Mapped[str] = mapped_column(String(10), nullable=True)   # HH:MM
    event_location: Mapped[str] = mapped_column(String(255), nullable=True)
    event_confidence: Mapped[float] = mapped_column(Float, default=0.0)

    # Empreinte sémantique simplifiée pour la déduplication (mots-clés extraits)
    topic_fingerprint: Mapped[str] = mapped_column(Text, nullable=True)

    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])


class DuplicateAlert(Base):
    """
    Alerte générée lorsque deux mails de sources différentes traitent du même sujet.
    """
    __tablename__ = "duplicate_alerts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    message_id_1: Mapped[uuid.UUID] = mapped_column(ForeignKey("inbox_messages.id"), nullable=False)
    message_id_2: Mapped[uuid.UUID] = mapped_column(ForeignKey("inbox_messages.id"), nullable=False)

    similarity_score: Mapped[float] = mapped_column(Float, default=0.0)
    summary: Mapped[str] = mapped_column(Text, nullable=True)  # Explication générée par l'IA
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())

    message_1: Mapped["InboxMessage"] = relationship("InboxMessage", foreign_keys=[message_id_1])
    message_2: Mapped["InboxMessage"] = relationship("InboxMessage", foreign_keys=[message_id_2])


class UserDevice(Base):
    """
    Appareil / session connecté pour la gestion et la sécurité du compte.
    """
    __tablename__ = "user_devices"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    device_name: Mapped[str] = mapped_column(String(255), default="Navigateur Web")
    user_agent: Mapped[str] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str] = mapped_column(String(64), nullable=True)
    is_trusted: Mapped[bool] = mapped_column(Boolean, default=False)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    last_active: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())

    user: Mapped["User"] = relationship(back_populates="devices")


class QuickConnectSession(Base):
    """
    Session éphémère pour la connexion rapide par QR Code (sans mot de passe).
    """
    __tablename__ = "quick_connect_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    token: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    device_name: Mapped[str] = mapped_column(String(255), default="Nouvel appareil")
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending, approved, rejected, consumed
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_jwt: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class Meeting(Base):
    """
    Réunion ou visioconférence liée au calendrier avec outils IA (résumé, quiz, actions).
    """
    __tablename__ = "meetings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    host_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    meeting_code: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="scheduled")  # scheduled, live, ended

    scheduled_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_actions: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    ai_quiz: Mapped[str | None] = mapped_column(Text, nullable=True)     # JSON

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())


class MeetingAttendance(Base):
    """
    Feuille d'émargement et présence pour une réunion.
    """
    __tablename__ = "meeting_attendances"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meetings.id"), nullable=False, index=True)
    user_email: Mapped[str] = mapped_column(String(255), nullable=False)
    user_name: Mapped[str] = mapped_column(String(255), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())
    duration_minutes: Mapped[int] = mapped_column(Integer, default=0)


class AuditLog(Base):
    """
    Journal d'audit de sécurité et d'actions administratives.
    """
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    user_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    target: Mapped[str | None] = mapped_column(String(255), nullable=True)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())


class AiSetting(Base):
    """
    Paramètres et configuration des modèles IA pour l'administrateur.
    """
    __tablename__ = "ai_settings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())


class AiFeedback(Base):
    """
    Retours des utilisateurs sur la qualité des réponses de l'IA.
    """
    __tablename__ = "ai_feedbacks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    conversation_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    message_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    feedback_type: Mapped[str] = mapped_column(String(20), nullable=False)  # positive, negative
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())


class ScheduledMessage(Base):
    """
    Message programmé pour envoi différé (Email ou WhatsApp).
    """
    __tablename__ = "scheduled_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    recipient: Mapped[str] = mapped_column(String(255), nullable=False)
    channel: Mapped[str] = mapped_column(String(50), default="email")  # email, whatsapp
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    cc: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Compte expéditeur pour le canal "gmail" : identifiant de la liaison CalendarLink
    link_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending, sent, cancelled, failed

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())


class MailAccount(Base):
    """
    Adresse e-mail liée à l'application par identifiants IMAP/SMTP.
    Le mot de passe (de préférence un mot de passe d'application) est chiffré
    avec Fernet avant stockage, comme les jetons OAuth de CalendarLink.
    Aucun contenu de message n'est stocké ici.
    """
    __tablename__ = "mail_accounts"
    __table_args__ = (UniqueConstraint("user_id", "address", name="uq_mail_accounts_user_address"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    address: Mapped[str] = mapped_column(String(254), nullable=False)
    provider: Mapped[str] = mapped_column(String(20), nullable=False, default="custom")  # gmail | outlook | custom
    imap_host: Mapped[str] = mapped_column(String(255), nullable=False)
    imap_port: Mapped[int] = mapped_column(Integer, nullable=False)
    smtp_host: Mapped[str] = mapped_column(String(255), nullable=False)
    smtp_port: Mapped[int] = mapped_column(Integer, nullable=False)
    encrypted_password: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())


class FrequentPlace(Base):
    """
    Lieu fréquenté défini par l'utilisateur (Domicile, Bureau, École, QG...), placé
    sur la carte par clic, par coordonnées ou par adresse. Un libellé est unique par utilisateur.
    """
    __tablename__ = "frequent_places"
    __table_args__ = (UniqueConstraint("user_id", "label", name="uq_frequent_places_user_label"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="other")  # home | office | school | hq | other
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.utcnow())
