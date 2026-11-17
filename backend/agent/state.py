"""
state.py
--------
Définition de l'état de l'agent Langgraph (AgentState).
"""

from typing import TypedDict, Dict, Any, List, Optional


class AgentState(TypedDict):
    user_id: str
    raw_input: str
    cleaned_input: str
    token_map: Dict[str, str]
    intent: Optional[Dict[str, Any]]
    conflicts: List[str]
    resolved_moves: Dict[str, Any]
    response_message: str
    status: str  # "success" | "conflict" | "error" | "proposal" | "message_draft"
    proposal: Optional[Dict[str, Any]]
    message_draft: Optional[Dict[str, Any]]
