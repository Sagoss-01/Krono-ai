"""
policy.py (mailbox)
-------------------
Règles de sécurité et LIMITES du module messagerie. Tout ce qui entre dans le
module (adresses, serveurs, textes, envois) passe par ici avant d'atteindre le
réseau ou la base.

Limites volontaires :
- 20 destinataires maximum par message, 200 caractères d'objet, 20 000 de corps ;
- 5 adresses liées par utilisateur ;
- 30 envois par heure et par utilisateur (compteur en mémoire : valable pour un
  seul processus serveur) ;
- serveurs de messagerie : TLS obligatoire (IMAP 993, SMTP 465 ou 587 STARTTLS),
  et interdiction des adresses privées, locales ou réservées : sans cela,
  l'application pourrait être détournée pour scanner le réseau interne (SSRF).
  La vérification résout le nom à la validation ; une résolution DNS différente
  au moment de la connexion ne peut pas être exclue (limite connue).

Ce module ne fait aucun appel IA et ne stocke aucun contenu de message.
"""

import ipaddress
import re
import socket
import threading
import time
from collections import defaultdict, deque

MAX_RECIPIENTS = 20
MAX_SUBJECT = 200
MAX_BODY = 20_000
MAX_INSTRUCTION = 1_000
MAX_ACCOUNTS_PER_USER = 5
SENDS_PER_HOUR = 30

# Ports acceptés : seulement des connexions chiffrées.
IMAP_PORTS = {993}
SMTP_PORTS = {465, 587}

EMAIL_RE = re.compile(r"^[^\s@<>()\[\]\\,;:\"]{1,64}@[^\s@<>()\[\]\\,;:\"]+\.[^\s@<>()\[\]\\,;:\"]{2,}$")
HOST_RE = re.compile(r"^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$")
# Caractères de contrôle interdits (on garde tab, LF et CR, traités à part).
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# Identifiant de message RFC 5322 : <partie@domaine>
MESSAGE_ID_RE = re.compile(r"^<[^<>\s@]+@[^<>\s]+>$")
# Dossier IMAP : lettres, chiffres et quelques séparateurs usuels.
FOLDER_RE = re.compile(r"^[A-Za-z0-9 _\-./&\[\]]{1,100}$")


class PolicyError(ValueError):
    """Requête refusée par une règle de sécurité ou une limite. Le message est destiné à l'utilisateur."""


def normalize_address(value) -> str:
    v = CONTROL_RE.sub("", str(value or "")).strip().lower()
    if len(v) > 254 or not EMAIL_RE.match(v):
        raise PolicyError(f"Adresse e-mail invalide : {v[:80] or '(vide)'}")
    return v


def clean_recipients(values, label: str) -> list[str]:
    out: list[str] = []
    for raw in values or []:
        addr = normalize_address(raw)
        if addr not in out:
            out.append(addr)
    if len(out) > MAX_RECIPIENTS:
        raise PolicyError(f"{label} : {MAX_RECIPIENTS} destinataires maximum par message.")
    return out


def clean_text(value, max_len: int, label: str, *, required: bool = False) -> str:
    """Retire les caractères de contrôle et borne la longueur. Les retours à la ligne sont conservés."""
    v = CONTROL_RE.sub("", str(value or "")).replace("\r\n", "\n").replace("\r", "\n").strip()
    if required and not v:
        raise PolicyError(f"{label} est obligatoire.")
    if len(v) > max_len:
        raise PolicyError(f"{label} : {max_len} caractères maximum ({len(v)} reçus).")
    return v


def clean_subject(value) -> str:
    """Un objet tient sur une seule ligne : pas de retour à la ligne (injection d'en-têtes)."""
    v = clean_text(value, MAX_SUBJECT, "L'objet", required=True)
    return " ".join(v.split())


def check_message_id(value) -> str | None:
    if not value:
        return None
    v = str(value).strip()
    if not MESSAGE_ID_RE.match(v) or len(v) > 255:
        raise PolicyError("Identifiant de message invalide (en-tête In-Reply-To).")
    return v


def check_folder(value) -> str:
    v = str(value or "INBOX").strip()
    if not FOLDER_RE.match(v):
        raise PolicyError("Nom de dossier invalide.")
    return v


def check_server(host: str, port: int, allowed_ports: set[int]) -> None:
    """Valide un serveur IMAP/SMTP. Bloquant (résolution DNS) : à appeler hors boucle événementielle."""
    h = str(host or "").strip().lower().rstrip(".")
    if not HOST_RE.match(h):
        raise PolicyError("Nom de serveur invalide.")
    if int(port) not in allowed_ports:
        raise PolicyError(f"Port non autorisé. Ports acceptés : {', '.join(str(p) for p in sorted(allowed_ports))} (connexion chiffrée uniquement).")
    try:
        infos = socket.getaddrinfo(h, int(port), proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise PolicyError(f"Serveur introuvable : {h}")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if not ip.is_global:
            raise PolicyError("Ce serveur pointe vers un réseau privé ou local : refusé.")


class SendLimiter:
    """Fenêtre glissante : au plus `limit` envois par `window` secondes et par clé (utilisateur)."""

    def __init__(self, limit: int, window: float):
        self.limit, self.window = limit, window
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True


send_limiter = SendLimiter(SENDS_PER_HOUR, 3600)
