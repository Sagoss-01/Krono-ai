"""
graph.py
--------
Construction et compilation du graphe de flux Langgraph.
"""

from langgraph.graph import StateGraph, START, END

from backend.agent.state import AgentState
from backend.agent.nodes import (
    anonymize_node, clean_node, parse_node,
    conflict_node, finalize_node, geo_node, _is_geo_intent,
)


def route_after_clean(state: AgentState) -> str:
    """Routing conditionnel : si la requete est geographique, aller vers geo_node."""
    raw = state.get("raw_input", "")
    cleaned = state.get("cleaned_input", raw)
    if _is_geo_intent(cleaned) or _is_geo_intent(raw):
        return "geo"
    return "parse"


# Initialisation du graphe
workflow = StateGraph(AgentState)

# Ajout des noeuds
workflow.add_node("anonymize", anonymize_node)
workflow.add_node("clean", clean_node)
workflow.add_node("parse", parse_node)
workflow.add_node("conflict", conflict_node)
workflow.add_node("finalize", finalize_node)
workflow.add_node("geo", geo_node)

# Transitions standard
workflow.add_edge(START, "anonymize")
workflow.add_edge("anonymize", "clean")

# Routing conditionnel apres clean
workflow.add_conditional_edges(
    "clean",
    route_after_clean,
    {"geo": "geo", "parse": "parse"},
)

# Pipeline standard calendrier
workflow.add_edge("parse", "conflict")
workflow.add_edge("conflict", "finalize")
workflow.add_edge("finalize", END)

# Pipeline geo (court-circuit direct vers END)
workflow.add_edge("geo", END)

# Compilation du graphe
agent_graph = workflow.compile()
