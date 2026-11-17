"""
document_parser.py
------------------
Extraction de texte brut et données tabulaires depuis divers formats :
PDF (.pdf), Excel (.xlsx, .xls), Word (.docx) et Images (.png, .jpg, .jpeg, .webp).
"""

import io
import base64
from typing import Dict, Any
import pypdf
import openpyxl
import docx


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extrait le texte de toutes les pages d'un fichier PDF."""
    try:
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        extracted_pages = []
        for i, page in enumerate(reader.pages):
            txt = page.extract_text() or ""
            if txt.strip():
                extracted_pages.append(f"--- PAGE {i + 1} ---\n{txt.strip()}")
        return "\n\n".join(extracted_pages)
    except Exception as e:
        return f"[Erreur lecture PDF : {str(e)}]"


def extract_text_from_excel(file_bytes: bytes) -> str:
    """
    Extrait les données de toutes les feuilles d'un classeur Excel,
    en conservant l'alignement des colonnes pour faciliter l'analyse sémantique.
    """
    try:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        sheets_output = []
        for sheetname in wb.sheetnames:
            ws = wb[sheetname]
            sheet_lines = [f"=== FEUILLE : {sheetname} ==="]
            for row in ws.iter_rows(values_only=True):
                # Filtrer les lignes complètement vides
                if any(cell is not None and str(cell).strip() != "" for cell in row):
                    formatted_cells = [str(cell).strip() if cell is not None else "" for cell in row]
                    sheet_lines.append(" | ".join(formatted_cells))
            if len(sheet_lines) > 1:
                sheets_output.append("\n".join(sheet_lines))
        return "\n\n".join(sheets_output)
    except Exception as e:
        return f"[Erreur lecture Excel : {str(e)}]"


def extract_text_from_word(file_bytes: bytes) -> str:
    """
    Extrait les paragraphes et les tableaux structurés d'un document Word (.docx).
    """
    try:
        doc = docx.Document(io.BytesIO(file_bytes))
        sections = []

        # Paragraphes normaux
        paragraphs_text = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
        if paragraphs_text:
            sections.append("=== CONTENU DU DOCUMENT ===")
            sections.extend(paragraphs_text)

        # Tableaux (souvent utilisés pour les grilles d'emploi du temps)
        for t_idx, table in enumerate(doc.tables):
            table_lines = [f"\n=== TABLEAU {t_idx + 1} ==="]
            for row in table.rows:
                cells = [c.text.strip().replace("\n", " ") for c in row.cells]
                if any(cells):
                    table_lines.append(" | ".join(cells))
            sections.append("\n".join(table_lines))

        return "\n\n".join(sections)
    except Exception as e:
        return f"[Erreur lecture Word : {str(e)}]"


def encode_image_b64(file_bytes: bytes, mime_type: str = "image/png") -> str:
    """Encode une image en Data URL base64 pour les modèles LLM multimodaux."""
    b64_str = base64.b64encode(file_bytes).decode("utf-8")
    return f"data:{mime_type};base64,{b64_str}"


def parse_document(filename: str, file_bytes: bytes) -> Dict[str, Any]:
    """
    Détecte l'extension du fichier et extrait son contenu textuel ou son image.
    """
    fn_lower = filename.lower()

    # 1. PDF
    if fn_lower.endswith(".pdf"):
        text = extract_text_from_pdf(file_bytes)
        is_scanned = len(text.strip()) < 30
        return {
            "file_type": "pdf",
            "text_content": text,
            "is_image": False,
            "image_data_url": None,
            "is_scanned": is_scanned,
        }

    # 2. Excel
    if fn_lower.endswith(".xlsx") or fn_lower.endswith(".xlsm") or fn_lower.endswith(".xltx"):
        text = extract_text_from_excel(file_bytes)
        return {
            "file_type": "excel",
            "text_content": text,
            "is_image": False,
            "image_data_url": None,
            "is_scanned": False,
        }

    # 3. Word
    if fn_lower.endswith(".docx"):
        text = extract_text_from_word(file_bytes)
        return {
            "file_type": "word",
            "text_content": text,
            "is_image": False,
            "image_data_url": None,
            "is_scanned": False,
        }

    # 4. Images
    image_mimes = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
    }
    for ext, mime in image_mimes.items():
        if fn_lower.endswith(ext):
            data_url = encode_image_b64(file_bytes, mime)
            return {
                "file_type": "image",
                "text_content": "",
                "is_image": True,
                "image_data_url": data_url,
                "is_scanned": False,
            }

    # Format texte brut ou inconnu
    try:
        text = file_bytes.decode("utf-8")
        return {
            "file_type": "text",
            "text_content": text,
            "is_image": False,
            "image_data_url": None,
            "is_scanned": False,
        }
    except UnicodeDecodeError:
        return {
            "file_type": "unknown",
            "text_content": "",
            "is_image": False,
            "image_data_url": None,
            "is_scanned": False,
        }
