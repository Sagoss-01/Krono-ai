"""
routes.py (agent)
-----------------
Endpoint d'API pour traiter les requêtes via l'agent Langgraph.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.routes import get_current_user
from backend.database import get_db
from backend.models.db_models import User
from backend.models.schemas import AgentProcessRequest, AgentProcessResponse, ParsedTaskIntent
from backend.agent.graph import agent_graph

router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("/process", response_model=AgentProcessResponse)
async def process_agent_command(
    payload: AgentProcessRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    inputs = {
        "user_id": str(current_user.id),
        "raw_input": payload.text,
        "cleaned_input": "",
        "token_map": {},
        "intent": None,
        "conflicts": [],
        "resolved_moves": {},
        "response_message": "",
        "status": "success",
    }
    
    config = {
        "configurable": {
            "db": db,
            "today_iso": payload.today_iso,
        }
    }
    
    try:
        result = await agent_graph.ainvoke(inputs, config=config)
        
        intent_data = result.get("intent")
        intent_response = None
        if intent_data:
            action = intent_data.get("action", "")
            if action == "geo_query":
                # Pour les requetes geo, on passe directement geo_data dans l'intent
                intent_response = ParsedTaskIntent(
                    action="geo_query",
                    geo_data=intent_data.get("geo_data", {})
                )
            elif action == "schedule_proposal":
                first_item = intent_data.get("first_item", {})
                intent_response = ParsedTaskIntent(
                    action="schedule_proposal",
                    title=first_item.get("title"),
                    date=first_item.get("date"),
                    time=first_item.get("time"),
                    duration_minutes=first_item.get("duration_minutes", 45),
                    priority=first_item.get("priority", "normal")
                )
            else:
                intent_response = ParsedTaskIntent(**intent_data)
            
        return AgentProcessResponse(
            status=result.get("status", "success"),
            message=result.get("response_message", ""),
            intent=intent_response,
            conflicts_detected=result.get("conflicts", []),
            relocations=result.get("resolved_moves", {}),
            proposal=result.get("proposal"),
            message_draft=result.get("message_draft"),
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur d'execution de l'agent : {str(e)}"
        )
