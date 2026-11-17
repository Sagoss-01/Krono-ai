"""
security.py
------------
Hachage Bcrypt, JWT et chiffrement symétrique Fernet.
"""

from datetime import datetime, timedelta, timezone
import jwt
from cryptography.fernet import Fernet
from passlib.context import CryptContext

from backend.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain_password: str) -> str:
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        return payload.get("sub")
    except jwt.PyJWTError as e:
        print(f"DEBUG JWT Error: {e}")
        return None


_fernet: Fernet | None = None


def get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        import base64
        import hashlib

        key = base64.urlsafe_b64encode(hashlib.sha256(settings.jwt_secret_key.encode()).digest())
        _fernet = Fernet(key)
    return _fernet


def encrypt_token(raw_token: str) -> str:
    return get_fernet().encrypt(raw_token.encode()).decode()


def decrypt_token(encrypted_token: str) -> str:
    return get_fernet().decrypt(encrypted_token.encode()).decode()
