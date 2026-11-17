"""
routes.py (auth)
-----------------
Authentification locale par email et mot de passe.

Exigence du cahier des charges : chaque utilisateur doit pouvoir créer un
compte puis se connecter, et l'accès aux données reste protégé par un jeton
JWT signé. Ce module expose :
- POST /auth/register : création de compte (mot de passe haché en Bcrypt) ;
- POST /auth/login    : échange email + mot de passe contre un jeton JWT ;
- GET  /auth/me       : profil de l'utilisateur identifié par le jeton ;
- get_current_user    : dépendance FastAPI réutilisée par toutes les autres
                        routes protégées du backend.

Principes de sécurité appliqués :
- on ne révèle jamais si un email existe à la connexion (même message d'erreur
  et même temps de réponse que le mot de passe soit faux ou l'email inconnu) ;
- les emails sont normalisés (espaces et casse) pour éviter les doublons ;
- un compte suspendu ne peut plus ni se connecter, ni utiliser un jeton existant.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.security import create_access_token, decode_access_token, hash_password, verify_password
from backend.database import get_db
from backend.models.db_models import User
from backend.models.schemas import Token, UserCreate, UserLogin, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

INVALID_CREDENTIALS = "Email ou mot de passe incorrect."
INVALID_TOKEN = "Session invalide ou expirée. Reconnectez-vous."

# Hachage factice utilisé quand l'email n'existe pas : on exécute quand même
# une vérification Bcrypt (coûteuse) pour que la réponse prenne le même temps
# qu'un vrai essai. Sans cela, un attaquant mesurerait la différence et
# découvrirait quels emails sont inscrits.
_DUMMY_HASH = hash_password("verification-factice-jamais-utilisee")


def normalize_email(email: str) -> str:
    """Supprime les espaces et met en minuscules : 'Ariel@Mail.com ' == 'ariel@mail.com'."""
    return email.strip().lower()


async def _find_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    return result.scalars().first()


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    email = normalize_email(payload.email)

    if await _find_user_by_email(db, email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cet email est déjà utilisé.")

    user = User(
        email=email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name.strip() if payload.full_name else None,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # Deux inscriptions simultanées avec le même email : la contrainte UNIQUE
        # de la base gagne, on répond proprement au lieu de planter.
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cet email est déjà utilisé.")

    await db.refresh(user)
    return user


@router.post("/login", response_model=Token)
async def login(payload: UserLogin, db: AsyncSession = Depends(get_db)):
    email = normalize_email(payload.email)
    user = await _find_user_by_email(db, email)

    if user is None:
        verify_password(payload.password, _DUMMY_HASH)  # temps de réponse uniforme
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)

    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)

    if user.is_suspended:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ce compte est suspendu. Contactez l'administrateur.",
        )

    return Token(access_token=create_access_token(user_id=str(user.id)))


async def get_current_user(
    token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)
) -> User:
    """
    Dépendance FastAPI : renvoie l'utilisateur authentifié par le jeton Bearer.
    Lève 401 si le jeton est invalide, expiré, si le compte n'existe plus
    ou s'il est suspendu. Le frontend se déconnecte alors automatiquement.
    """
    user_id = decode_access_token(token)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_TOKEN)

    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_TOKEN)

    user = await db.get(User, user_uuid)
    if user is None or user.is_suspended:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_TOKEN)
    return user


@router.get("/me", response_model=UserOut)
async def read_current_user(current_user: User = Depends(get_current_user)):
    return current_user
