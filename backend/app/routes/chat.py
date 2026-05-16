import json
import asyncio
import traceback
from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse
from app.models import ChatRequest, ChatResponse, ChartSpec, ColorRules
from app.db import supabase_client
from app.langgraph_agent import call_agent

router = APIRouter()

@router.get("/api/test")
def test_endpoint():
    return {"status": "ok", "message": "Backend is reachable!"}

@router.post("/api/chat-stream")
async def chat_stream_endpoint(request: Request):
    """
    Claude-style streaming endpoint. 
    Streams 'thinking' steps followed by the final JSON response.
    """
    body = await request.json()
    chat_request = ChatRequest(**body)
    history = [{"role": m.role, "content": m.content} for m in chat_request.history]

    async def event_generator():
        queue = asyncio.Queue()

        def on_step(step_data: dict):
            # Put step data into the queue to be streamed
            queue.put_nowait(step_data)

        # Run call_agent in a thread to avoid blocking the event loop
        # and allow the queue to be processed
        loop = asyncio.get_event_loop()
        
        # Helper to log messages to Supabase
        def log_to_supabase(role: str, content: str):
            if supabase_client:
                try:
                    supabase_client.table("chat_messages").insert({
                        "role": role,
                        "content": content,
                    }).execute()
                except Exception as e:
                    print(f"[API] [WARN] Failed to log {role} message: {e}")

        log_to_supabase("user", chat_request.message)

        # Start the agent task
        task = loop.run_in_executor(None, call_agent, chat_request.message, history, on_step)

        while not task.done() or not queue.empty():
            try:
                # Wait for next step or timeout
                step = await asyncio.wait_for(queue.get(), timeout=0.1)
                yield {
                    "event": "step",
                    "data": json.dumps(step)
                }
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                print(f"Queue error: {e}")
                break

        try:
            answer, chart_dict = await task
            
            # Log assistant response
            log_to_supabase("assistant", answer)

            # Build final response object
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
            
            final_response = ChatResponse(answer=answer, chart=chart)
            yield {
                "event": "final",
                "data": final_response.model_dump_json()
            }
        except Exception as e:
            traceback.print_exc()
            yield {
                "event": "error",
                "data": json.dumps({"message": str(e)})
            }

    return EventSourceResponse(event_generator())

@router.post("/api/chat", response_model=ChatResponse)
def chat_endpoint(request: ChatRequest):
    # Keep original endpoint for compatibility if needed
    history = [{"role": m.role, "content": m.content} for m in request.history]
    try:
        answer, chart_dict = call_agent(request.message, history)
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
    except Exception as e:
        traceback.print_exc()
        return ChatResponse(answer=f"Error: {e}", chart=None)
