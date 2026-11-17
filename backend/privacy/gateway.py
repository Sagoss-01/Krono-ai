"""
gateway.py (Privacy Gateway)
-----------------------------
Exigence RGPD du cahier des charges :
On substitue les données nominatives et confidentielles
par des jetons anonymes avant tout envoi vers l'API externe Gemini, puis
on restaure les valeurs réelles lors de la réception de la réponse.
"""

import re
import uuid
from dataclasses import dataclass, field


EMAIL_PATTERN = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_PATTERN = re.compile(r"(?:\+?\d{1,3}[ .-]?)?\(?\d{2,4}\)?[ .-]?\d{2,4}[ .-]?\d{2,4}[ .-]?\d{0,4}")
NAME_PATTERN = re.compile(r"(?<!^)(?<!\. )\b[A-Z][a-zà-ÿ]{2,}\b")


@dataclass
class AnonymizationResult:
    anonymized_text: str
    token_map: dict[str, str] = field(default_factory=dict)  # jeton -> valeur réelle


class PrivacyGateway:
    """Anonymise un texte, puis sait le restaurer après traitement par le LLM."""

    def anonymize(self, text: str) -> AnonymizationResult:
        token_map: dict[str, str] = {}

        def _replace(pattern: re.Pattern, prefix: str, source: str) -> str:
            def repl(match: re.Match) -> str:
                token = f"__{prefix}_{uuid.uuid4().hex[:6]}__"
                token_map[token] = match.group(0)
                return token

            return pattern.sub(repl, source)

        working_text = text
        working_text = _replace(EMAIL_PATTERN, "EMAIL", working_text)
        working_text = _replace(PHONE_PATTERN, "PHONE", working_text)
        working_text = _replace(NAME_PATTERN, "NAME", working_text)

        return AnonymizationResult(anonymized_text=working_text, token_map=token_map)

    def restore(self, text: str, token_map: dict[str, str]) -> str:
        """Remet les vraies valeurs à la place des jetons dans la réponse de Gemini."""
        restored = text
        for token, real_value in token_map.items():
            restored = restored.replace(token, real_value)
        return restored


privacy_gateway = PrivacyGateway()
