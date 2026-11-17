"""
routes.py (mailbox)
-------------------
API du module messagerie, sous /mailbox :
- POST   /mailbox/accounts                       lier une adresse (test IMAP + SMTP avant enregistrement)
- GET    /mailbox/accounts                       lister les adresses liées (sans mot de passe)
- DELETE /mailbox/accounts/{id}                  délier une adresse et effacer ses identifiants
- GET    /mailbox/accounts/{id}/messages         lister (en-têtes, lecture seule)
- GET    /mailbox/accounts/{id}/messages/{uid}   lire un message (sans le marquer comme lu)
- POST   /mailbox/accounts/{id}/send             envoyer, après confirmation explicite de l'utilisateur
- POST   /mailbox/ai/assist                      assistance IA : renvoie un texte, n'envoie jamais rien

Chaque route vérifie que le compte demandé appartient à l'utilisateur connecté.
"""

import asyncio
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.routes import get_current_user
from backend.auth.security import decrypt_token, encrypt_token
from backend.database import get_db
from backend.mailbox import ai_assistant, protocol
from backend.mailbox.ai_assistant import AssistantUnavailable, MailContext
from backend.mailbox.policy import (
    IMAP_PORTS, MAX_ACCOUNTS_PER_USER, MAX_BODY, MAX_INSTRUCTION, SMTP_PORTS, PolicyError,
    check_folder, check_message_id, check_server, clean_recipients, clean_subject, clean_text,
    normalize_address, send_limiter,
)
from backend.mailbox.protocol import Creds, MailProtocolError
from backend.models.db_models import MailAccount, User

router = APIRouter(prefix="/mailbox", tags=["mailbox"])

# Réglages connus des fournisseurs : l'utilisateur n'a qu'à donner son adresse et son mot de passe d'application.
PROVIDER_PRESETS = {
    "gmail": {"imap": ("imap.gmail.com", 993), "smtp": ("smtp.gmail.com", 465)},
    "outlook": {"imap": ("outlook.office365.com", 993), "smtp": ("smtp.office365.com", 587)},
}


# ─── Schémas d'entrée / sortie ───────────────────────────────────────────────

class AccountCreate(BaseModel):
    address: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)
    provider: Literal["gmail", "outlook", "custom"] = "custom"
    imap_host: str | None = Field(default=None, max_length=253)
    imap_port: int | None = Field(default=None, ge=1, le=65535)
    smtp_host: str | None = Field(default=None, max_length=253)
    smtp_port: int | None = Field(default=None, ge=1, le=65535)


class AccountOut(BaseModel):
    id: uuid.UUID
    address: str
    provider: str
    imap_host: str
    imap_port: int
    smtp_host: str
    smtp_port: int


class SendIn(BaseModel):
    to: list[str] = Field(min_length=1, max_length=20)
    cc: list[str] = Field(default_factory=list, max_length=20)
    subject: str = Field(max_length=300)
    body: str = Field(max_length=MAX_BODY)
    in_reply_to: str | None = Field(default=None, max_length=255)
    references: str | None = Field(default=None, max_length=1000)
    confirmed: bool = False  # doit valoir true : l'interface affiche les destinataires avant l'envoi


class AssistIn(BaseModel):
    action: str = Field(max_length=20)
    account_id: uuid.UUID | None = None
    folder: str = Field(default="INBOX", max_length=100)
    uid: str | None = Field(default=None, max_length=20)   # message de référence (réponse, lecture)
    instruction: str = Field(default="", max_length=MAX_INSTRUCTION)
    tone: str = Field(default="formel", max_length=20)
    language: str = Field(default="fr", max_length=5)
    body: str = Field(default="", max_length=MAX_BODY)


# ─── Outils internes ─────────────────────────────────────────────────────────

def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PolicyError):
        return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    if isinstance(exc, MailProtocolError):
        return HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    if isinstance(exc, AssistantUnavailable):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    raise exc


async def _owned_account(db: AsyncSession, user: User, account_id: uuid.UUID) -> MailAccount:
    # Même réponse 404 si le compte n'existe pas ou appartient à quelqu'un d'autre.
    result = await db.execute(select(MailAccount).where(MailAccount.id == account_id, MailAccount.user_id == user.id))
    account = result.scalar_one_or_none()
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Adresse e-mail introuvable.")
    return account


def _creds(account: MailAccount) -> Creds:
    return Creds(
        address=account.address, password=decrypt_token(account.encrypted_password),
        imap_host=account.imap_host, imap_port=account.imap_port,
        smtp_host=account.smtp_host, smtp_port=account.smtp_port,
    )


def _to_out(a: MailAccount) -> AccountOut:
    return AccountOut(
        id=a.id, address=a.address, provider=a.provider,
        imap_host=a.imap_host, imap_port=a.imap_port, smtp_host=a.smtp_host, smtp_port=a.smtp_port,
    )


def _resolve_servers(p: AccountCreate) -> tuple[str, int, str, int]:
    if p.provider in PROVIDER_PRESETS:
        preset = PROVIDER_PRESETS[p.provider]
        return (*preset["imap"], *preset["smtp"])
    missing = [n for n, v in (("imap_host", p.imap_host), ("imap_port", p.imap_port),
                              ("smtp_host", p.smtp_host), ("smtp_port", p.smtp_port)) if v in (None, "")]
    if missing:
        raise PolicyError("Pour un serveur personnalisé, renseignez : " + ", ".join(missing) + ".")
    return p.imap_host, p.imap_port, p.smtp_host, p.smtp_port


# ─── Comptes ──────────────────────────────────────────────────────────────────

@router.post("/accounts", status_code=status.HTTP_201_CREATED, response_model=AccountOut)
async def link_account(payload: AccountCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        address = normalize_address(payload.address)
        imap_host, imap_port, smtp_host, smtp_port = _resolve_servers(payload)
        imap_host, smtp_host = imap_host.strip().lower(), smtp_host.strip().lower()
        await asyncio.to_thread(check_server, imap_host, imap_port, IMAP_PORTS)
        await asyncio.to_thread(check_server, smtp_host, smtp_port, SMTP_PORTS)
    except PolicyError as e:
        raise _http_error(e)

    count = (await db.execute(select(func.count(MailAccount.id)).where(MailAccount.user_id == user.id))).scalar() or 0
    if count >= MAX_ACCOUNTS_PER_USER:
        raise _http_error(PolicyError(f"Vous pouvez lier {MAX_ACCOUNTS_PER_USER} adresses au maximum."))
    duplicate = await db.execute(select(MailAccount.id).where(MailAccount.user_id == user.id, MailAccount.address == address))
    if duplicate.first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette adresse est déjà liée.")

    creds = Creds(address=address, password=payload.password, imap_host=imap_host, imap_port=imap_port,
                  smtp_host=smtp_host, smtp_port=smtp_port)
    try:
        await asyncio.to_thread(protocol.test_account, creds)
    except MailProtocolError as e:
        raise _http_error(e)

    account = MailAccount(
        user_id=user.id, address=address, provider=payload.provider,
        imap_host=imap_host, imap_port=imap_port, smtp_host=smtp_host, smtp_port=smtp_port,
        encrypted_password=encrypt_token(payload.password),
    )
    db.add(account)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette adresse est déjà liée.")
    await db.refresh(account)
    return _to_out(account)


@router.get("/accounts", response_model=list[AccountOut])
async def list_accounts(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MailAccount).where(MailAccount.user_id == user.id).order_by(MailAccount.created_at))
    return [_to_out(a) for a in result.scalars().all()]


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_account(account_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    account = await _owned_account(db, user, account_id)
    await db.delete(account)  # supprime aussi le mot de passe chiffré
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ─── Lecture (lecture seule) ─────────────────────────────────────────────────

@router.get("/accounts/{account_id}/messages")
async def list_messages(
    account_id: uuid.UUID,
    folder: str = Query("INBOX", max_length=100),
    limit: int = Query(20, ge=1, le=50),
    unread: bool = False,
    q: str = Query("", max_length=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account = await _owned_account(db, user, account_id)
    try:
        folder = check_folder(folder)
        items = await asyncio.to_thread(protocol.list_messages, _creds(account), folder, limit, unread, q.strip())
    except (PolicyError, MailProtocolError) as e:
        raise _http_error(e)
    return {"folder": folder, "messages": items}


@router.get("/accounts/{account_id}/messages/{uid}")
async def read_message(
    account_id: uuid.UUID,
    uid: str,
    folder: str = Query("INBOX", max_length=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account = await _owned_account(db, user, account_id)
    try:
        folder = check_folder(folder)
        return await asyncio.to_thread(protocol.fetch_message, _creds(account), folder, uid)
    except (PolicyError, MailProtocolError) as e:
        raise _http_error(e)


# ─── Envoi (après confirmation) ──────────────────────────────────────────────

@router.post("/accounts/{account_id}/send")
async def send(
    account_id: uuid.UUID,
    payload: SendIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account = await _owned_account(db, user, account_id)
    if not payload.confirmed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Confirmez l'envoi après avoir relu le message.")
    try:
        to = clean_recipients(payload.to, "Destinataires")
        cc = clean_recipients(payload.cc, "Copie (Cc)")
        if not to:
            raise PolicyError("Au moins un destinataire est obligatoire.")
        if len(set(to) | set(cc)) > 20:
            raise PolicyError("20 destinataires maximum par message.")
        subject = clean_subject(payload.subject)
        body = clean_text(payload.body, MAX_BODY, "Le corps du message", required=True)
        in_reply_to = check_message_id(payload.in_reply_to)
        references = None
        if payload.references:
            refs = payload.references.split()
            references = " ".join(check_message_id(r) for r in refs) if refs else None
    except PolicyError as e:
        raise _http_error(e)

    if not send_limiter.allow(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Limite d'envois atteinte (30 par heure). Réessayez plus tard.")

    try:
        result = await asyncio.to_thread(
            protocol.send_message, _creds(account), to=to, cc=cc, subject=subject, body=body,
            in_reply_to=in_reply_to, references=references,
        )
    except MailProtocolError as e:
        raise _http_error(e)
    return {"ok": True, **result}


# ─── Assistance IA ───────────────────────────────────────────────────────────

@router.post("/ai/assist")
async def assist(payload: AssistIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ctx = None
    if payload.account_id and payload.uid:
        # Le message de référence est lu par le SERVEUR, à partir du compte de l'utilisateur :
        # le navigateur ne peut pas injecter un texte arbitraire comme « message reçu ».
        account = await _owned_account(db, user, payload.account_id)
        try:
            folder = check_folder(payload.folder)
            m = await asyncio.to_thread(protocol.fetch_message, _creds(account), folder, payload.uid)
        except (PolicyError, MailProtocolError) as e:
            raise _http_error(e)
        ctx = MailContext(sender=m["from"], subject=m["subject"], body=m["text"])
    try:
        return await ai_assistant.assist(
            payload.action, instruction=payload.instruction, tone=payload.tone, language=payload.language,
            body=payload.body, ctx=ctx,
        )
    except (PolicyError, AssistantUnavailable) as e:
        raise _http_error(e)
