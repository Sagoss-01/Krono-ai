"""
routes.py (contacts)
--------------------
Routes CRUD pour la gestion du carnet d'adresses et la synchronisation
de contacts (mobile / PWA / import par lot).
"""

import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.routes import get_current_user
from backend.database import get_db
from backend.models.db_models import User, Contact
from backend.models.schemas import (
    ContactCreate, ContactUpdate, ContactOut,
    BatchImportContactsRequest, BatchImportContactsResponse,
)

router = APIRouter(prefix="/contacts", tags=["contacts"])


@router.get("", response_model=List[ContactOut])
async def list_contacts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Contact).where(Contact.user_id == current_user.id).order_by(Contact.name.asc())
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
async def create_contact(
    payload: ContactCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    new_contact = Contact(
        user_id=current_user.id,
        name=payload.name.strip(),
        email=payload.email.strip() if payload.email else None,
        phone_number=payload.phone_number.strip() if payload.phone_number else None,
        company=payload.company.strip() if payload.company else None,
        notes=payload.notes,
    )
    db.add(new_contact)
    await db.commit()
    await db.refresh(new_contact)
    return new_contact


@router.post("/batch", response_model=BatchImportContactsResponse)
async def batch_import_contacts(
    payload: BatchImportContactsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    created_list = []
    for item in payload.contacts:
        if not item.name or not item.name.strip():
            continue
        c = Contact(
            user_id=current_user.id,
            name=item.name.strip(),
            email=item.email.strip() if item.email else None,
            phone_number=item.phone_number.strip() if item.phone_number else None,
            company=item.company.strip() if item.company else None,
            notes=item.notes,
        )
        db.add(c)
        created_list.append(c)

    await db.commit()
    for c in created_list:
        await db.refresh(c)

    return BatchImportContactsResponse(
        imported_count=len(created_list),
        contacts=created_list,
    )


@router.post("/seed-demo", response_model=BatchImportContactsResponse)
async def seed_demo_contacts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Insère 3 contacts types pour tester immédiatement la commande vocale.
    """
    demo_contacts = [
        Contact(
            user_id=current_user.id,
            name="Thomas Dupont",
            phone_number="+33612345678",
            email="thomas.dupont@atelier.ai",
            company="Atelier AI",
            notes="Collègue de projet",
        ),
        Contact(
            user_id=current_user.id,
            name="Sophie Martin",
            phone_number="+33698765432",
            email="sophie.martin@entreprise.com",
            company="Direction Générale",
            notes="Responsable administrative",
        ),
        Contact(
            user_id=current_user.id,
            name="Dr. Alain Bernard",
            phone_number="+33655443322",
            email="cabinet.bernard@sante.fr",
            company="Cabinet Médical",
            notes="Médecin généraliste",
        ),
    ]

    for c in demo_contacts:
        db.add(c)
    await db.commit()
    for c in demo_contacts:
        await db.refresh(c)

    return BatchImportContactsResponse(
        imported_count=len(demo_contacts),
        contacts=demo_contacts,
    )


@router.put("/{contact_id}", response_model=ContactOut)
async def update_contact(
    contact_id: uuid.UUID,
    payload: ContactUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Contact).where(Contact.id == contact_id, Contact.user_id == current_user.id)
    res = await db.execute(stmt)
    contact = res.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact non trouvé.")

    if payload.name is not None:
        contact.name = payload.name.strip()
    if payload.email is not None:
        contact.email = payload.email.strip() if payload.email else None
    if payload.phone_number is not None:
        contact.phone_number = payload.phone_number.strip() if payload.phone_number else None
    if payload.company is not None:
        contact.company = payload.company.strip() if payload.company else None
    if payload.notes is not None:
        contact.notes = payload.notes

    await db.commit()
    await db.refresh(contact)
    return contact


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(
    contact_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Contact).where(Contact.id == contact_id, Contact.user_id == current_user.id)
    res = await db.execute(stmt)
    contact = res.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact non trouvé.")

    await db.delete(contact)
    await db.commit()
    return None


@router.post("/{contact_id}/favorite", response_model=ContactOut)
async def toggle_favorite_contact(
    contact_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Bascule l'état favori d'un contact (étoile)."""
    stmt = select(Contact).where(Contact.id == contact_id, Contact.user_id == current_user.id)
    res = await db.execute(stmt)
    contact = res.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact non trouvé.")

    contact.is_favorite = not contact.is_favorite
    await db.commit()
    await db.refresh(contact)
    return contact

