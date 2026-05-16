# backend/app/routes/chat.py
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Request
from app.models import ChatRequest, ChatResponse, ChartSpec, ColorRules
from app.db import supabase_client
from app.langgraph_agent import call_agent

import json

router = APIRouter()


def _serialize_chart_context(chart) -> str:
    """
    Convert a ChartSpec (from history) into a compact text block that the
    LLM can read as context about a previously rendered graph.

    Example output:
        [Previous chart: "Containment Rate by Intent"
         Type: bar | SQL: SELECT intent, AVG(...) AS rate FROM ...
         Data (first 5 rows): [{"label": "balance_inquiry", "value": 0.91}, ...]
         Explanation: Containment rate per intent, sorted highest to lowest.]
    """
    if chart is None:
        return ""

    data = chart.data
    # Summarise to first 5 rows so we don't bloat the prompt
    if isinstance(data, list):
        sample = data[:5]
        data_str = json.dumps(sample, ensure_ascii=False)
        if len(data) > 5:
            data_str += f" ... ({len(data)} rows total)"
    else:
        data_str = json.dumps(data, ensure_ascii=False)

    lines = [
        f'[Previous chart: "{chart.title}"',
        f" Type: {chart.type} | SQL: {chart.sql}",
        f" Data (first 5 rows): {data_str}",
    ]
    if chart.explanation:
        lines.append(f" Explanation: {chart.explanation}]")
    else:
        lines[-1] = lines[-1].rstrip() + "]"

    return "\n".join(lines)


def _build_agent_history(history: list) -> list[dict]:
    """
    Convert the Pydantic ChatMessage list into plain dicts for the agent.

    For assistant turns that carried a chart, we append a structured
    context block to the content so the agent can answer follow-up
    questions like "why is that intent low?" or "compare to last week".
    """
    result = []
    for m in history:
        content = m.content

        if m.role == "assistant" and m.chart is not None:
            chart_ctx = _serialize_chart_context(m.chart)
            if chart_ctx:
                content = content + "\n\n" + chart_ctx if content else chart_ctx

        result.append({"role": m.role, "content": content})
    return result


@router.post("/api/chat-stream")
async def chat_stream_endpoint(request: Request):
    """
    Claude-style streaming endpoint. 
    Streams 'thinking' steps followed by the final JSON response.
    """
    body = await request.json()
    chat_request = ChatRequest(**body)
    history = _build_agent_history(chat_request.history)

    import asyncio
    import traceback
    from sse_starlette.sse import EventSourceResponse

    async def event_generator():
        queue = asyncio.Queue()

        def on_step(step_data: dict):
            queue.put_nowait(step_data)

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
            
            log_to_supabase("assistant", answer)

            chart = None
            if chart_dict:
                color_rules = None
                if isinstance(chart_dict.get("color_rules"), dict):
                    cr = chart_dict["color_rules"]
                    if "threshold" in cr and "above" in cr and "below" in cr:
                        color_rules = ColorRules(
                            threshold=float(cr["threshold"]),
                            above=str(cr["above"]),
                            below=str(cr["below"]),
                        )
                chart = ChartSpec(
                    type=chart_dict["type"],
                    title=chart_dict["title"],
                    data=chart_dict["data"],
                    sql=chart_dict["sql"],
                    explanation=chart_dict.get("explanation"),
                    color_rules=color_rules,
                    suggestions=chart_dict.get("suggestions", []),
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
    history = _build_agent_history(request.history)

    if supabase_client:
        try:
            supabase_client.table("chat_messages").insert({
                "role": "user",
                "content": request.message,
            }).execute()
        except Exception as e:
            print(f"Failed to log user message: {e}")

    answer, chart_dict = call_agent(request.message, history)

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
        if isinstance(chart_dict.get("color_rules"), dict):
            cr = chart_dict["color_rules"]
            if "threshold" in cr and "above" in cr and "below" in cr:
                color_rules = ColorRules(
                    threshold=float(cr["threshold"]),
                    above=str(cr["above"]),
                    below=str(cr["below"]),
                )
        chart = ChartSpec(
            type=chart_dict["type"],
            title=chart_dict["title"],
            data=chart_dict["data"],
            sql=chart_dict["sql"],
            explanation=chart_dict.get("explanation"),
            color_rules=color_rules,
            suggestions=chart_dict.get("suggestions", []),
        )

    return ChatResponse(answer=answer, chart=chart)