# pyrefly: ignore [missing-import]
import traceback
from fastapi import APIRouter
from app.models import ChatRequest, ChatResponse, ChartSpec, ColorRules
from app.db import supabase_client
# from app.azure_agent import call_agent
from app.langgraph_agent import call_agent

router = APIRouter()


@router.get("/api/test")
def test_endpoint():
    """Quick connectivity check — open http://172.20.10.9:8000/api/test in browser."""
    return {"status": "ok", "message": "Backend is reachable and langgraph_agent is imported!"}


@router.post("/api/chat", response_model=ChatResponse)
def chat_endpoint(request: ChatRequest):
    history = [{"role": m.role, "content": m.content} for m in request.history]

    print(f"\n{'='*60}")
    print(f"[API] >>> New Chat Request received")
    print(f"[API]     Message : {request.message!r}")
    print(f"[API]     History : {len(history)} turn(s)")
    print(f"{'='*60}")

    if supabase_client:
        try:
            supabase_client.table("chat_messages").insert({
                "role": "user",
                "content": request.message,
            }).execute()
        except Exception as e:
            print(f"[API] [WARN] Failed to log user message to Supabase: {e}")

    try:
        print(f"[API] Calling call_agent ...")
        answer, chart_dict = call_agent(request.message, history)
        print(f"[API] <<< Agent returned. answer_len={len(answer or '')}, has_chart={chart_dict is not None}")
    except Exception as e:
        print(f"[API] [ERROR] call_agent raised an exception!")
        traceback.print_exc()
        return ChatResponse(answer=f"Agent error: {e}", chart=None)

    if supabase_client:
        try:
            supabase_client.table("chat_messages").insert({
                "role": "assistant",
                "content": answer,
            }).execute()
        except Exception as e:
            print(f"[API] [WARN] Failed to log assistant message to Supabase: {e}")

    chart = None
    if chart_dict:
        try:
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
        except Exception as e:
            print(f"[API] [WARN] Failed to build ChartSpec from chart_dict: {e}")
            print(f"[API]        chart_dict was: {chart_dict}")

    print(f"{'='*60}\n")
    return ChatResponse(answer=answer, chart=chart)
