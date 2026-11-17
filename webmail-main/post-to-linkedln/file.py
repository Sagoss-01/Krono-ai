#!/usr/bin/env python3
import argparse
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DOMAIN = "netiify.cloud"
VMAILBOX_FILE = "/etc/postfix/vmailbox"
DOVECOT_USERS_FILE = "/etc/dovecot/users"
MAIL_BASE = "/var/mail/vhosts"
LOCK_FILE = "/var/lock/netiify-mail-create.lock"

RESERVED_LOCALPARTS = {
    "admin", "administrator", "root", "support", "tech", "contact", "info",
    "postmaster", "abuse", "hostmaster", "webmaster", "mailer-daemon",
    "security", "noreply", "no-reply", "smtp", "imap", "pop", "pop3",
    "dmarc", "dkim", "spf", "bounce", "daemon"
}

LOCALPART_RE = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$")


class MailboxError(Exception):
    pass


def run(cmd, check=True, capture_output=True, text=True):
    return subprocess.run(
        cmd,
        check=check,
        capture_output=capture_output,
        text=text
    )


def fail(message, code=1, extra=None):
    payload = {"ok": False, "error": message}
    if extra is not None:
        payload["details"] = extra
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(code)


def ok(data):
    payload = {"ok": True}
    payload.update(data)
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(0)


def ensure_root():
    if os.geteuid() != 0:
        raise MailboxError("Ce script doit être exécuté en root.")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def normalize_localpart(localpart: str) -> str:
    return localpart.strip().lower()


def validate_localpart(localpart: str):
    if not LOCALPART_RE.match(localpart):
        raise MailboxError(
            "Localpart invalide. Autorisés: lettres minuscules, chiffres, point, underscore, tiret."
        )
    if localpart in RESERVED_LOCALPARTS:
        raise MailboxError(f"Adresse réservée/interdite: {localpart}@{DOMAIN}")


def validate_email(email: str):
    email = normalize_email(email)
    if "@" not in email:
        raise MailboxError("Adresse email invalide.")

    localpart, domain = email.split("@", 1)
    localpart = normalize_localpart(localpart)

    if domain != DOMAIN:
        raise MailboxError(f"Domaine non autorisé: {domain}")

    validate_localpart(localpart)
    return localpart, f"{localpart}@{domain}"


def parse_identity_from_line(line: str):
    raw = line.strip()
    if not raw or raw.startswith("#"):
        return None

    if ":" in raw:
        return raw.split(":", 1)[0].strip().lower()

    parts = raw.split()
    if not parts:
        return None

    return parts[0].strip().lower()


def file_contains_identity(path: str, identity: str) -> bool:
    p = Path(path)
    if not p.exists():
        return False

    identity = identity.strip().lower()

    with p.open("r", encoding="utf-8") as f:
        for line in f:
            parsed = parse_identity_from_line(line)
            if parsed == identity:
                return True

    return False


def check_existing(email: str, localpart: str):
    mailbox_root = Path(MAIL_BASE) / DOMAIN / localpart
    maildir_path = mailbox_root / "Maildir"

    if file_contains_identity(VMAILBOX_FILE, email):
        raise MailboxError(f"Adresse déjà présente dans {VMAILBOX_FILE}")

    if file_contains_identity(DOVECOT_USERS_FILE, email):
        raise MailboxError(f"Adresse déjà présente dans {DOVECOT_USERS_FILE}")

    if mailbox_root.exists() or maildir_path.exists():
        raise MailboxError(f"Le dossier mail existe déjà: {mailbox_root}")


def generate_password_hash(password: str):
    preferred = ["SHA512-CRYPT", "BLF-CRYPT", "SHA256-CRYPT", "CRYPT"]
    errors = {}

    for scheme in preferred:
        try:
            result = run(["doveadm", "pw", "-s", scheme, "-p", password])
            pwd_hash = (result.stdout or "").strip()

            if pwd_hash.startswith("{"):
                return scheme, pwd_hash

            errors[scheme] = f"Sortie invalide: {pwd_hash}"

        except subprocess.CalledProcessError as e:
            errors[scheme] = (e.stderr or e.stdout or "").strip()

    raise MailboxError(
        "Impossible de générer un hash avec les schémas testés: "
        + json.dumps(errors, ensure_ascii=False)
    )


def atomic_write(path: str, content: str):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)

    fd, temp_path = tempfile.mkstemp(prefix=p.name + ".", dir=str(p.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp:
            tmp.write(content)
            tmp.flush()
            os.fsync(tmp.fileno())

        if p.exists():
            shutil.copymode(path, temp_path)

        os.replace(temp_path, path)

    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def append_line_atomic(path: str, line: str):
    p = Path(path)

    if p.exists():
        content = p.read_text(encoding="utf-8")
    else:
        content = ""

    if content and not content.endswith("\n"):
        content += "\n"

    content += line + "\n"
    atomic_write(path, content)


def remove_line_for_identity(path: str, identity: str):
    p = Path(path)
    if not p.exists():
        return

    identity = identity.strip().lower()
    lines = p.read_text(encoding="utf-8").splitlines()
    kept = []

    for line in lines:
        parsed = parse_identity_from_line(line)
        if parsed is None:
            kept.append(line)
            continue

        if parsed != identity:
            kept.append(line)

    new_content = "\n".join(kept)
    if new_content:
        new_content += "\n"

    atomic_write(path, new_content)


def create_maildir(localpart: str):
    user_root = Path(MAIL_BASE) / DOMAIN / localpart
    maildir = user_root / "Maildir"

    for child in ["cur", "new", "tmp"]:
        (maildir / child).mkdir(parents=True, exist_ok=True)

    run(["chown", "-R", "vmail:vmail", str(user_root)])
    run(["chmod", "700", str(user_root)])
    run(["chmod", "700", str(maildir)])
    run(["chmod", "700", str(maildir / "cur")])
    run(["chmod", "700", str(maildir / "new")])
    run(["chmod", "700", str(maildir / "tmp")])


def create_special_mailboxes(email: str):
    for box in ["Sent", "Drafts", "Junk", "Trash"]:
        run(["doveadm", "mailbox", "create", "-u", email, "-s", box])


def verify_auth(email: str, password: str):
    try:
        result = run(["doveadm", "auth", "test", email, password])
        out = (result.stdout or "").strip()
        err = (result.stderr or "").strip()
        return out if out else err
    except subprocess.CalledProcessError as e:
        raise MailboxError(f"Échec du test d'authentification: {e.stderr or e.stdout}")


def list_mailboxes(email: str):
    result = run(["doveadm", "mailbox", "list", "-u", email])
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def rebuild_postfix_map():
    run(["postmap", VMAILBOX_FILE])
    run(["systemctl", "reload", "postfix"])


def reload_dovecot():
    run(["systemctl", "reload", "dovecot"])


def safe_delete_mail_root(localpart: str):
    user_root = Path(MAIL_BASE) / DOMAIN / localpart
    if user_root.exists():
        shutil.rmtree(user_root, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description="Créer une boîte mail virtuelle Netiify.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--firstname", required=False, default="")
    parser.add_argument("--lastname", required=False, default="")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        ensure_root()
        localpart, email = validate_email(args.email)
        check_existing(email, localpart)

        os.makedirs(os.path.dirname(LOCK_FILE), exist_ok=True)

        with open(LOCK_FILE, "w") as lockf:
            fcntl.flock(lockf, fcntl.LOCK_EX)

            # Re-vérification sous verrou
            check_existing(email, localpart)

            scheme, pwd_hash = generate_password_hash(args.password)

            vmailbox_line = f"{email} {DOMAIN}/{localpart}/Maildir/"
            VMAIL_UID = "5000"
            VMAIL_GID = "5000"

            home_dir = f"{MAIL_BASE}/{DOMAIN}/{localpart}"
            maildir_path = f"{home_dir}/Maildir"

            dovecot_user_line = (
                f"{email}:{pwd_hash}:{VMAIL_UID}:{VMAIL_GID}::"
                f"{home_dir}::userdb_mail=maildir:{maildir_path}"
            )

            if args.dry_run:
                ok({
                    "dry_run": True,
                    "email": email,
                    "localpart": localpart,
                    "scheme": scheme,
                    "vmailbox_line": vmailbox_line,
                    "dovecot_user_line_preview": f"{email}:{{HASH_MASQUÉ}}"
                })

            postfix_done = False
            dovecot_done = False
            maildir_done = False

            try:
                append_line_atomic(VMAILBOX_FILE, vmailbox_line)
                rebuild_postfix_map()
                postfix_done = True

                append_line_atomic(DOVECOT_USERS_FILE, dovecot_user_line)
                reload_dovecot()
                dovecot_done = True

                create_maildir(localpart)
                create_special_mailboxes(email)
                maildir_done = True

                auth_output = verify_auth(email, args.password)
                mailboxes = list_mailboxes(email)

                ok({
                    "email": email,
                    "localpart": localpart,
                    "scheme": scheme,
                    "auth_test": auth_output,
                    "mailboxes": mailboxes
                })

            except Exception as inner:
                rollback_errors = []

                try:
                    if postfix_done:
                        remove_line_for_identity(VMAILBOX_FILE, email)
                        rebuild_postfix_map()
                except Exception as e:
                    rollback_errors.append(f"rollback postfix: {e}")

                try:
                    if dovecot_done:
                        remove_line_for_identity(DOVECOT_USERS_FILE, email)
                        reload_dovecot()
                except Exception as e:
                    rollback_errors.append(f"rollback dovecot: {e}")

                try:
                    if maildir_done:
                        safe_delete_mail_root(localpart)
                except Exception as e:
                    rollback_errors.append(f"rollback maildir: {e}")

                if rollback_errors:
                    raise MailboxError(
                        f"{inner} | erreurs rollback: {' ; '.join(rollback_errors)}"
                    )

                raise MailboxError(str(inner))

    except MailboxError as e:
        fail(str(e))
    except Exception as e:
        fail(f"Erreur inattendue: {e}")


if __name__ == "__main__":
    main()