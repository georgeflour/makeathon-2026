# pyrefly: ignore [missing-import]
from fastapi import APIRouter
from app.models import ChatRequest, ChatResponse, ChartSpec, ColorRules
from app.db import supabase_client
# from app.azure_agent import call_agent
from app.langgraph_agent import call_agent

router = APIRouter()


@router.post("/api/chat", response_model=ChatResponse)
def chat_endpoint(request: ChatRequest):
    history = [{"role": m.role, "content": m.content} for m in request.history]

    if supabase_client:
        try:
            supabase_client.table("chat_messages").insert({
                "role": "user",
                "content": request.message,
            }).execute()
        except Exception as e:
            print(f"Failed to log user message: {e}")

    print(f"\\n{'='*50}\\n[API] New Chat Request: {request.message}\\n{'='*50}")
    answer, chart_dict = call_agent(request.message, history)
    print(f"[API] Agent Finished. Answer length: {len(answer) if answer else 0}, Has Chart: {chart_dict is not None}\\n{'='*50}\\n")

    if supabase_client:
        try:
            supabase_client.table("chat_messages").insert({
                "role": "assistant",
                "content": answer,
            }).execute()
        except Exception as e:
            print(f"Failed to log assistant message: {e}")

    chart = None
    if chart_dict:
        color_rules = None
        if chart_dict.get("color_rules"):
            cr = chart_dict["color_rules"]
            color_rules = ColorRules(
                threshold=cr["threshold"],
                above=cr["above"],
                below=cr["below"],
            )
        chart = ChartSpec(
            type=chart_dict["type"],
            title=chart_dict["title"],
            data=chart_dict["data"],
            sql=chart_dict["sql"],
            explanation=chart_dict.get("explanation"),
            color_rules=color_rules,
        )

    return ChatResponse(answer=answer, chart=chart)
