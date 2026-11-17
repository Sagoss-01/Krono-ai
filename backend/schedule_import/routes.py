"""
routes.py (schedule_import)
----------------------------
Routes d'API pour le téléversement, l'analyse IA et l'importation par lot
d'emplois du temps depuis des documents (PDF, Excel, Word, Images).
"""

from typing import List, Optional
from datetime import datetime
import uuid

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.auth.routes import get_current_user
from backend.models.db_models import User, Event, ConstraintType, EventStatus
from backend.models.schemas import EventOut
from backend.schedule_import.document_parser import parse_document
from backend.schedule_import.ai_schedule_extractor import extract_schedule_from_document

router = APIRouter(prefix="/schedule-import", tags=["schedule-import"])


class EventImportItem(BaseModel):
    title: str
    start_time: str  # ISO string
    end_time: str    # ISO string
    location: Optional[str] = None
    description: Optional[str] = None
    constraint_type: str = "hard"


class BatchConfirmPayload(BaseModel):
    events: List[EventImportItem]


@router.post("/upload-and-parse")
async def upload_and_parse_schedule(
    file: UploadFile = File(...),
    week_start: Optional[str] = Form(None),
    repeat_weeks: int = Form(1),
    current_user: User = Depends(get_current_user),
):
    """
    Reçoit un fichier (PDF, Excel, Word ou Image), extrait son contenu,
    l'analyse via l'IA et retourne les cours détectés pré-remplis pour validation.
    """
    allowed_extensions = (
        ".pdf", ".xlsx", ".xls", ".docx",
        ".png", ".jpg", ".jpeg", ".webp"
    )
    filename = file.filename or "document"
    if not any(filename.lower().endswith(ext) for ext in allowed_extensions):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Format de fichier non pris en charge ({filename}). Formats acceptés : PDF, Excel (.xlsx), Word (.docx) ou Image (.png, .jpg, .webp)."
        )

    try:
        content_bytes = await file.read()
        if len(content_bytes) > 20 * 1024 * 1024:  # 20 Mo max
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Le fichier dépasse la taille maximale autorisée (20 Mo)."
            )

        # 1. Extraction textuelle ou encodage image
        parsed_doc = parse_document(filename, content_bytes)

        # 2. Interprétation IA et calcul des plages
        result = extract_schedule_from_document(
            document_info=parsed_doc,
            week_start_date_iso=week_start,
            repeat_weeks=repeat_weeks,
        )

        return {
            "status": "success",
            "filename": filename,
            "file_type": parsed_doc["file_type"],
            **result,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors du traitement du document : {str(e)}"
        )


@router.post("/confirm-import", response_model=List[EventOut])
async def confirm_import_events(
    payload: BatchConfirmPayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Enregistre en lot dans la base de données les événements validés par l'utilisateur.
    """
    if not payload.events:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Aucun événement fourni pour l'import."
        )

    created_events: List[Event] = []

    try:
        for item in payload.events:
            try:
                start_dt = datetime.fromisoformat(item.start_time)
                end_dt = datetime.fromisoformat(item.end_time)
            except ValueError:
                continue

            ctype = ConstraintType.HARD if item.constraint_type.lower() == "hard" else ConstraintType.SOFT

            evt = Event(
                id=uuid.uuid4(),
                owner_id=current_user.id,
                title=item.title.strip() or "Cours",
                start_time=start_dt,
                end_time=end_dt,
                location=item.location.strip() if item.location else None,
                constraint_type=ctype,
                status=EventStatus.CONFIRMED,
                source="document_import",
                external_id=f"doc_{uuid.uuid4().hex[:8]}",
            )
            db.add(evt)
            created_events.append(evt)

        await db.commit()

        # Rafraîchir les instances pour l'affichage
        for evt in created_events:
            await db.refresh(evt)

        return created_events

    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors de la sauvegarde des événements : {str(e)}"
        )
