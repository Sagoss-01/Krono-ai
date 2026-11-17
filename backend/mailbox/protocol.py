"""
protocol.py (mailbox)
---------------------
Clients IMAP (lecture) et SMTP (envoi) avec la bibliothèque standard Python.
Fonctions SYNCHRONES et bloquantes : les routes les appellent via
asyncio.to_thread pour ne pas figer le serveur.

Garanties :
- la lecture utilise BODY.PEEK et un dossier en lecture seule : un message
  consulté n'est PAS marqué comme lu à l'insu de l'utilisateur ;
- les erreurs remontées à l'utilisateur sont génériques (pas de détail de
  protocole, pas de mot de passe dans les messages ni les journaux) ;
- la copie dans le dossier « Envoyés » est best-effort : un échec ne fait pas
  échouer un envoi déjà parti.

Limite v1 : recherche en ASCII uniquement, pas de pièces jointes, pas de
Bcc, pas de file d'attente d'envoi.
"""

import email
import imaplib
import re
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.policy import default as default_policy
from email.utils import formatdate, make_msgid

from backend.mailbox.policy import FOLDER_RE, PolicyError

TIMEOUT = 15
MAX_TEXT = 20_000
SENT_FOLDER_CANDIDATES = ["Sent", "Sent Items", "Sent Messages", "[Gmail]/Sent Mail", "INBOX.Sent"]
FLAGS_RE = re.compile(rb"FLAGS \(([^)]*)\)")


@dataclass(frozen=True)
class Creds:
    address: str
    password: str
    imap_host: str
    imap_port: int
    smtp_host: str
    smtp_port: int


class MailProtocolError(Exception):
    """Erreur présentable à l'utilisateur (message générique, sans détail technique)."""


def _tls_context() -> ssl.SSLContext:
    return ssl.create_default_context()  # vérifie le certificat du serveur


def _imap_connect(c: Creds) -> imaplib.IMAP4_SSL:
    try:
        conn = imaplib.IMAP4_SSL(c.imap_host, c.imap_port, ssl_context=_tls_context(), timeout=TIMEOUT)
    except (OSError, ssl.SSLError) as e:
        raise MailProtocolError(f"Serveur IMAP injoignable ({c.imap_host}:{c.imap_port}).") from e
    try:
        conn.login(c.address, c.password)
    except imaplib.IMAP4.error as e:
        raise MailProtocolError("Connexion IMAP refusée : vérifiez l'adresse et le mot de passe d'application.") from e
    return conn


def _smtp_connect(c: Creds) -> smtplib.SMTP:
    ctx = _tls_context()
    try:
        if c.smtp_port == 465:
            server = smtplib.SMTP_SSL(c.smtp_host, 465, context=ctx, timeout=TIMEOUT)
        else:
            server = smtplib.SMTP(c.smtp_host, c.smtp_port, timeout=TIMEOUT)
            server.ehlo()
            server.starttls(context=ctx)
            server.ehlo()
    except (smtplib.SMTPException, OSError, ssl.SSLError) as e:
        raise MailProtocolError(f"Serveur SMTP injoignable ({c.smtp_host}:{c.smtp_port}).") from e
    try:
        server.login(c.address, c.password)
    except smtplib.SMTPException as e:
        try:
            server.quit()
        except Exception:
            pass
        raise MailProtocolError("Connexion SMTP refusée : vérifiez l'adresse et le mot de passe d'application.") from e
    return server


def test_account(c: Creds) -> None:
    """Vérifie que IMAP ET SMTP acceptent les identifiants. Lève MailProtocolError sinon."""
    conn = _imap_connect(c)
    try:
        conn.logout()
    except Exception:
        pass
    server = _smtp_connect(c)
    try:
        server.quit()
    except Exception:
        pass


def _select_readonly(conn: imaplib.IMAP4_SSL, folder: str) -> None:
    if not FOLDER_RE.match(folder):
        raise MailProtocolError("Nom de dossier invalide.")
    typ, _ = conn.select(f'"{folder}"', readonly=True)
    if typ != "OK":
        raise MailProtocolError(f"Dossier introuvable : {folder}")


def _search_criteria(unread: bool, query: str) -> list[str]:
    parts = ["UNSEEN" if unread else "ALL"]
    if query:
        if not query.isascii():
            raise PolicyError("La recherche n'accepte que les caractères ASCII pour le moment.")
        # Les guillemets et antislashs casseraient la syntaxe IMAP : on les retire.
        safe = query.replace("\\", "").replace('"', "").strip()
        if safe:
            parts += ["TEXT", f'"{safe}"']
    return parts


def list_messages(c: Creds, folder: str, limit: int, unread: bool = False, query: str = "") -> list[dict]:
    """Liste les derniers messages (en-têtes seulement). Les plus récents d'abord."""
    conn = _imap_connect(c)
    try:
        _select_readonly(conn, folder)
        typ, data = conn.uid("SEARCH", None, *_search_criteria(unread, query))
        if typ != "OK":
            raise MailProtocolError("Recherche impossible sur ce dossier.")
        uids = data[0].split() if data and data[0] else []
        items = []
        for uid in uids[-limit:][::-1]:
            typ, msg = conn.uid("FETCH", uid, "(FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])")
            if typ != "OK" or not msg:
                continue
            meta = msg[0][0] if isinstance(msg[0], tuple) else b""
            raw_headers = next((p[1] for p in msg if isinstance(p, tuple)), b"")
            flags = FLAGS_RE.search(meta)
            h = email.message_from_bytes(raw_headers, policy=default_policy)
            items.append({
                "uid": uid.decode(),
                "from": str(h.get("From", "")),
                "to": str(h.get("To", "")),
                "subject": str(h.get("Subject", "")),
                "date": str(h.get("Date", "")),
                "message_id": str(h.get("Message-ID", "")),
                "unread": not (flags and b"\\Seen" in flags.group(1)),
            })
        return items
    finally:
        _logout(conn)


def fetch_message(c: Creds, folder: str, uid: str) -> dict:
    """Lit un message complet (texte seul, pièces jointes listées par nom). Ne le marque pas comme lu."""
    if not str(uid).isdigit():
        raise PolicyError("Identifiant de message invalide.")
    conn = _imap_connect(c)
    try:
        _select_readonly(conn, folder)
        typ, msg = conn.uid("FETCH", uid, "(BODY.PEEK[])")
        if typ != "OK" or not msg or not isinstance(msg[0], tuple):
            raise MailProtocolError("Message introuvable.")
        m = email.message_from_bytes(msg[0][1], policy=default_policy)
        return {
            "uid": uid,
            "from": str(m.get("From", "")),
            "to": str(m.get("To", "")),
            "cc": str(m.get("Cc", "")),
            "subject": str(m.get("Subject", "")),
            "date": str(m.get("Date", "")),
            "message_id": str(m.get("Message-ID", "")),
            "references": str(m.get("References", "")),
            "text": _body_text(m)[:MAX_TEXT],
            "attachments": [p.get_filename() or "piece-jointe" for p in m.iter_attachments()][:10],
        }
    finally:
        _logout(conn)


def _body_text(m) -> str:
    part = m.get_body(preferencelist=("plain", "html"))
    if part is None:
        return ""
    content = part.get_content()
    if part.get_content_type() == "text/html":
        content = html_to_text(content)
    return content.strip()


def html_to_text(html: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", html or "")
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'")):
        text = text.replace(a, b)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


def _logout(conn) -> None:
    try:
        conn.logout()
    except Exception:
        pass


def send_message(c: Creds, *, to: list[str], cc: list[str], subject: str, body: str,
                 in_reply_to: str | None = None, references: str | None = None) -> dict:
    """Envoie un message en texte brut, puis tente une copie dans « Envoyés »."""
    msg = EmailMessage()
    msg["From"] = c.address
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    message_id = make_msgid(domain=c.address.split("@", 1)[1])
    msg["Message-ID"] = message_id
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = f"{references} {in_reply_to}".strip() if references else in_reply_to
    msg.set_content(body)

    server = _smtp_connect(c)
    try:
        server.send_message(msg, from_addr=c.address, to_addrs=to + cc)
    except smtplib.SMTPRecipientsRefused as e:
        raise MailProtocolError("Le serveur a refusé un ou plusieurs destinataires.") from e
    except smtplib.SMTPException as e:
        raise MailProtocolError("Le serveur SMTP a refusé l'envoi.") from e
    finally:
        try:
            server.quit()
        except Exception:
            pass

    return {"message_id": message_id, "saved_to_sent": _save_to_sent(c, msg.as_bytes())}


def _save_to_sent(c: Creds, raw: bytes) -> bool:
    try:
        conn = _imap_connect(c)
    except MailProtocolError:
        return False
    try:
        for folder in SENT_FOLDER_CANDIDATES:
            try:
                typ, _ = conn.append(f'"{folder}"', "(\\Seen)", None, raw)
            except imaplib.IMAP4.error:
                continue
            if typ == "OK":
                return True
        return False
    finally:
        _logout(conn)
