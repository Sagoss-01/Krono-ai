"""
nlp_service.py
---------------
Filtrage du langage parlé :
Le système doit ignorer les tics de langage, hésitations et répétitions.
"""

import re

FILLER_WORDS = [
    r"\beuh+\b", r"\bhum+\b", r"\benfin\b", r"\bdonc\b(?=\s+donc\b)",
    r"\bbah\b", r"\bben\b", r"\bvoilà\b", r"\bgenre\b", r"\bquoi\b(?=\s*[.,!?]|\s*$)",
    r"\bdu coup\b",
]

_FILLER_REGEX = re.compile("|".join(FILLER_WORDS), flags=re.IGNORECASE)
_REPEATED_WORD_REGEX = re.compile(r"\b(\w+)( \1\b)+", flags=re.IGNORECASE)
_MULTI_SPACE_REGEX = re.compile(r"\s{2,}")


def clean_transcription(raw_text: str) -> str:
    """
    Exemple : "euh ajoute ajoute un point d'équipe demain euh après-midi genre"
           -> "ajoute un point d'équipe demain après-midi"
    """
    text = _FILLER_REGEX.sub("", raw_text)
    text = _REPEATED_WORD_REGEX.sub(r"\1", text)  # "ajoute ajoute" -> "ajoute"
    text = _MULTI_SPACE_REGEX.sub(" ", text)
    return text.strip(" ,.")
