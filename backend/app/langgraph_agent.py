"""
langgraph_agent.py
==================
Drop-in replacement for azure_agent.py.

Same public interface:
    call_agent(user_message, history) -> tuple[str, dict | None]

LangGraph flow:
    START
      └─► enhance_prompt          (gpt-4o, max_tokens=300)
            └─► [parallel]
                  ├─► sql_agent   (gpt-4o, max_tokens=800)  — runs run_query tool
                  └─► chart_agent (gpt-4o, max_tokens=500)  — decides chart spec
            └─► judge             (gpt-4o, max_tokens=400)
                  ├─► pass  → END
                  └─► retry → sql_agent + chart_agent (max 3 loops)
    END

To swap to a different deployment for any agent just set the
corresponding env var:
    AZURE_DEPLOYMENT_NAME        (default for all agents)
    AZURE_FAST_DEPLOYMENT_NAME   (override for agents 1 & 3, optional)
"""

from __future__ import annotations

import json
import asyncio
from pathlib import Path
from typing import TypedDict, Optional, Any

from openai import AzureOpenAI
from langgraph.graph import StateGraph, START, END

from app.config import settings
from app.query_engine import execute_query, normalize_data

# ---------------------------------------------------------------------------
# Load static context files (same as original azure_agent.py)
# ---------------------------------------------------------------------------
_data_dir = Path(__file__).parent / "data"
_SCHEMA  = (_data_dir / "schema.md").read_text(encoding="utf-8")
_METRICS = (_data_dir / "metrics_dictionary.md").read_text(encoding="utf-8")

_visuals_dir = Path(__file__).parent.parent.parent / "visuals"
_CHARTS  = (_visuals_dir / "charts.json").read_text(encoding="utf-8")
_PALLETS = (_visuals_dir / "pallets.json").read_text(encoding="utf-8")
_PROMPT  = (_visuals_dir / "prompt.txt").read_text(encoding="utf-8")

# ---------------------------------------------------------------------------
# Azure OpenAI client (single client, all agents use same endpoint)
# ---------------------------------------------------------------------------
_client: AzureOpenAI | None = None

def _get_client() -> AzureOpenAI:
    global _client
    if _client is None:
        _client = AzureOpenAI(
            api_key=settings.AZURE_OPENAI_API_KEY,
            api_version="2024-02-15-preview",
            azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
        )
    return _client

# Deployment names — override AZURE_FAST_DEPLOYMENT_NAME in .env for a cheaper
# model (e.g. gpt-4o-mini) on agents 1 and 3 if available.
_MAIN_MODEL = settings.AZURE_DEPLOYMENT_NAME          # gpt-4o
_FAST_MODEL = getattr(settings, "AZURE_FAST_DEPLOYMENT_NAME", _MAIN_MODEL)

# ---------------------------------------------------------------------------
# LangGraph state
# ---------------------------------------------------------------------------
class AgentState(TypedDict):
    # Input
    original_message: str
    history: list[dict]

    # Set by agent 1
    enhanced_prompt: str
    rag_context: str              # chart-lib docs snippet

    # Set by agent 2 (sql)
    sql: str
    sql_rows: list[dict]          # raw rows from execute_query
    sql_error: str

    # Set by agent 3 (chart design)
    chart_type: str
    chart_title: str
    chart_palette: str
    chart_explanation: str
    color_rules: Optional[dict]

    # Set by agent 4 (judge)
    judge_passed: bool
    judge_feedback: str
    retry_count: int

    # Final output
    answer: str
    chart_dict: Optional[dict]


# ---------------------------------------------------------------------------
# System prompts — one per agent, tight and focused
# ---------------------------------------------------------------------------

_PROMPT_ENHANCER_SYSTEM = """\
You are a query normalizer for NR2Dashboard, a banking voicebot analytics dashboard.
Your job is to rephrase the user's question into a precise analytical question and
identify the key intent, metric, and dimensions.

Return a JSON object with exactly these keys:
{
  "enhanced_prompt": "<rewritten analytical question, clear and unambiguous>",
  "metric": "<primary metric: containment_rate | csat | aht | volume | cost | escalation_rate | tool_success_rate>",
  "dimensions": ["<dim1>", "<dim2>"],   // e.g. ["intent", "bot_version"]
  "chart_hint": "<bar | line | pie | kpi | area | scatter>",
  "language": "<el | en>"
}

Rules:
- Keep enhanced_prompt in the same language as the user's input.
- If the question is already clear, minimal changes are fine.
- dimensions must be columns from: region, segment, bot_version, outcome, detected_intent, start_date, start_hour, criterion_id, tool_name
- Return ONLY the JSON object, no prose, no markdown fences.
"""

_SQL_AGENT_SYSTEM = f"""\
You are a PostgreSQL expert for NR2Dashboard, a banking voicebot analytics platform.
Write a single correct SQL SELECT query and validate it using run_query.

== DATABASE SCHEMA ==
{_SCHEMA}

== METRICS DEFINITIONS ==
{_METRICS}

== SQL RULES ==
- Use ONLY these flat tables: conversations, turns, evaluations, data_collection, tool_calls
- For bar/pie/line/area charts: return exactly 2 columns — label (string) and value (numeric). Always alias both.
- For kpi: return 1 row with 1 numeric column.
- Limit bar/pie results to 20 rows max.
- Always ALIAS computed columns: e.g. AVG(...) AS containment_rate
- When joining turns for intent: use a subquery with DISTINCT conversation_id to avoid duplicates.
- ALL rates/percentages MUST be decimals 0-1 (e.g. 0.76, NOT 76). NEVER multiply by 100.
- Containment rate: AVG(CASE WHEN call_successful='success' THEN 1.0 ELSE 0.0 END)

== WORKFLOW ==
1. Call run_query with your SQL to validate it.
2. If it errors, fix and retry (max 4 attempts).
3. When successful, return a JSON object:
{{
  "sql": "<final validated SQL>",
  "answer": "<concise natural-language answer to the user's question>",
  "row_count": <int>
}}
Return ONLY the JSON object after successful validation.
"""

_CHART_AGENT_SYSTEM = f"""\
You are a data visualization expert for NR2Dashboard.
Given an analytical question and chart context, decide the best chart specification.

== CHART SELECTION GUIDE ==
{_CHARTS}

== PALETTE GUIDE ==
{_PALLETS}

== CHART CREATION RULES ==
{_PROMPT}

== RATES DISPLAY RULE ==
Values 0-1 are rates/percentages — the frontend formats them. Never multiply by 100.
Containment rate threshold is 0.85 — always add color_rules for containment charts.

Return a JSON object with exactly these keys:
{{
  "chart_type": "<bar | line | area | pie | kpi | scatter>",
  "title": "<short descriptive chart title>",
  "palette": "<vega-lite-name from PALETTE GUIDE>",
  "explanation": "<one sentence describing what the chart shows>",
  "color_rules": null  // or {{"threshold": 0.85, "above": "purple", "below": "orange"}} for containment
}}

Return ONLY the JSON object, no prose, no markdown fences.
"""

_JUDGE_SYSTEM = """\
You are a quality-control judge for NR2Dashboard chart responses.
You receive: the user's question, the SQL query, sample rows, and the chart spec.
Evaluate whether the response correctly and clearly answers the question.

Score on these criteria (each pass/fail):
1. sql_correct      — does the SQL logically answer the question?
2. shape_match      — do the row columns match the chart_type requirements?
3. data_non_empty   — are there rows (not 0)?
4. chart_appropriate — is the chart type a good fit for the data?
5. answer_relevant  — does the answer text address the question?

Return a JSON object:
{
  "passed": true | false,
  "score": <int 0-5>,
  "failures": ["<criterion_id>", ...],
  "feedback": "<one sentence of actionable feedback if failed, else empty string>"
}

Pass threshold: score >= 4 AND sql_correct = true AND data_non_empty = true.
Return ONLY the JSON object.
"""

# ---------------------------------------------------------------------------
# Tool definition for SQL agent (run_query only)
# ---------------------------------------------------------------------------
_SQL_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "run_query",
            "description": "Execute a PostgreSQL SELECT query. Returns rows as JSON array.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {"type": "string", "description": "Valid PostgreSQL SELECT query"}
                },
                "required": ["sql"],
            },
        },
    }
]

# ---------------------------------------------------------------------------
# Helper: call OpenAI and get text response
# ---------------------------------------------------------------------------
def _chat(system: str, user: str, model: str, max_tokens: int,
          tools=None, tool_choice=None) -> tuple[str, list]:
    """Single chat completion. Returns (text_content, tool_calls)."""
    client = _get_client()
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        "max_tokens": max_tokens,
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = tool_choice or "auto"

    resp = client.chat.completions.create(**kwargs)
    msg = resp.choices[0].message
    return (msg.content or ""), (msg.tool_calls or [])


def _parse_json(text: str) -> dict:
    """Strip markdown fences and parse JSON."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


# ---------------------------------------------------------------------------
# Node 1 — Prompt enhancer
# ---------------------------------------------------------------------------
def node_enhance_prompt(state: AgentState) -> dict:
    user_msg = state["original_message"]

    # RAG context: inject full chart guide (already in system prompt of chart agent,
    # but we also pass a summary hint here for the SQL agent to use)
    rag_context = (
        f"Available chart types: bar, line, area, pie, kpi, scatter.\n"
        f"Palette options: tableau10, viridis, redblue, spectral, blues, dark2.\n"
    )

    try:
        text, _ = _chat(
            system=_PROMPT_ENHANCER_SYSTEM,
            user=user_msg,
            model=_FAST_MODEL,
            max_tokens=300,
        )
        parsed = _parse_json(text)
        enhanced = parsed.get("enhanced_prompt", user_msg)
        chart_hint = parsed.get("chart_hint", "bar")
        language = parsed.get("language", "en")
        rag_context += f"Suggested chart type: {chart_hint}. Language: {language}."
        print(f"[node_enhance_prompt] Extracted intent/metrics -> Enhanced: {enhanced}")
    except Exception as e:
        print(f"[enhance_prompt] fallback due to: {e}")
        enhanced = user_msg

    return {
        "enhanced_prompt": enhanced,
        "rag_context": rag_context,
    }


# ---------------------------------------------------------------------------
# Node 2 — SQL agent (with run_query tool loop)
# ---------------------------------------------------------------------------
def node_sql_agent(state: AgentState) -> dict:
    prompt = state["enhanced_prompt"]
    feedback = state.get("judge_feedback", "")

    user_content = f"Question: {prompt}"
    if feedback:
        user_content += f"\n\nPrevious attempt failed. Judge feedback: {feedback}\nPlease fix accordingly."

    messages = [
        {"role": "system", "content": _SQL_AGENT_SYSTEM},
        {"role": "user",   "content": user_content},
    ]
    client = _get_client()

    sql_result = ""
    sql_rows: list[dict] = []
    answer = ""

    for attempt in range(4):
        resp = client.chat.completions.create(
            model=_MAIN_MODEL,
            messages=messages,
            tools=_SQL_TOOLS,
            tool_choice="auto",
            max_tokens=800,
        )
        msg = resp.choices[0].message
        messages.append(msg)

        if msg.tool_calls:
            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                    sql_result = args.get("sql", "")
                    rows = execute_query(sql_result)
                    sql_rows = rows[:50]
                    content = json.dumps(sql_rows)
                except Exception as e:
                    content = f"Query error: {e}"
                    sql_rows = []

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": content,
                })
        else:
            # Model returned final JSON
            try:
                parsed = _parse_json(msg.content or "{}")
                sql_result = parsed.get("sql", sql_result)
                answer = parsed.get("answer", "")
                if not sql_rows and sql_result:
                    sql_rows = execute_query(sql_result)[:50]
            except Exception:
                answer = msg.content or ""
            break

    print(f"[node_sql_agent] Final SQL (attempt {attempt+1}): {sql_result}")
    if answer:
        print(f"[node_sql_agent] Generated answer snippet.")

    return {
        "sql": sql_result,
        "sql_rows": sql_rows,
        "sql_error": "" if sql_rows else "No rows returned",
        "answer": answer,
    }


# ---------------------------------------------------------------------------
# Node 3 — Chart design agent
# ---------------------------------------------------------------------------
def node_chart_agent(state: AgentState) -> dict:
    prompt = state["enhanced_prompt"]
    rag = state.get("rag_context", "")
    feedback = state.get("judge_feedback", "")

    user_content = (
        f"Question: {prompt}\n\n"
        f"Context: {rag}"
    )
    if feedback:
        user_content += f"\n\nPrevious attempt failed. Judge feedback: {feedback}\nPlease fix the chart spec."

    try:
        text, _ = _chat(
            system=_CHART_AGENT_SYSTEM,
            user=user_content,
            model=_FAST_MODEL,
            max_tokens=500,
        )
        parsed = _parse_json(text)
    except Exception as e:
        print(f"[chart_agent] fallback due to: {e}")
        parsed = {
            "chart_type": "bar",
            "title": prompt[:60],
            "palette": "tableau10",
            "explanation": "",
            "color_rules": None,
        }

    print(f"[node_chart_agent] Chose chart: {parsed.get('chart_type')} | Palette: {parsed.get('palette')}")

    return {
        "chart_type":      parsed.get("chart_type", "bar"),
        "chart_title":     parsed.get("title", ""),
        "chart_palette":   parsed.get("palette", "tableau10"),
        "chart_explanation": parsed.get("explanation", ""),
        "color_rules":     parsed.get("color_rules"),
    }


# ---------------------------------------------------------------------------
# Node 4 — Judge
# ---------------------------------------------------------------------------
def node_judge(state: AgentState) -> dict:
    retry_count = state.get("retry_count", 0)

    # Hard stop — don't loop forever
    if retry_count >= 3:
        return {"judge_passed": True, "judge_feedback": ""}

    sample = json.dumps(state.get("sql_rows", [])[:5], indent=2)
    user_content = (
        f"User question: {state['original_message']}\n\n"
        f"SQL:\n{state.get('sql', '')}\n\n"
        f"Sample rows (first 5):\n{sample}\n\n"
        f"Chart spec:\n"
        f"  type: {state.get('chart_type')}\n"
        f"  title: {state.get('chart_title')}\n"
        f"  explanation: {state.get('chart_explanation')}\n\n"
        f"Answer text: {state.get('answer', '')}"
    )

    try:
        text, _ = _chat(
            system=_JUDGE_SYSTEM,
            user=user_content,
            model=_MAIN_MODEL,
            max_tokens=400,
        )
        parsed = _parse_json(text)
        passed = parsed.get("passed", True)
        feedback = parsed.get("feedback", "")
    except Exception as e:
        print(f"[judge] parse error: {e} — defaulting to pass")
        passed = True
        feedback = ""

    print(f"[node_judge] Passed: {passed} | Feedback: {feedback} (Retry #{retry_count})")

    return {
        "judge_passed": passed,
        "judge_feedback": feedback,
        "retry_count": retry_count + (0 if passed else 1),
    }


# ---------------------------------------------------------------------------
# Node 5 — Assemble final output
# ---------------------------------------------------------------------------
def node_assemble(state: AgentState) -> dict:
    chart_type_raw = state.get("chart_type", "bar").lower()
    if "pie" in chart_type_raw:
        chart_type = "pie"
    elif "line" in chart_type_raw:
        chart_type = "line"
    elif "area" in chart_type_raw:
        chart_type = "area"
    elif "kpi" in chart_type_raw:
        chart_type = "kpi"
    elif "scatter" in chart_type_raw:
        chart_type = "scatter"
    else:
        chart_type = "bar"

    sql = state.get("sql", "")
    try:
        rows = state.get("sql_rows") or execute_query(sql)
        data = normalize_data(rows, chart_type)
    except Exception as e:
        return {
            "answer": f"Could not build chart: {e}",
            "chart_dict": None,
        }

    raw_color = state.get("color_rules")
    color_rules = raw_color if isinstance(raw_color, dict) and raw_color else None

    chart_dict = {
        "type":        chart_type,
        "title":       state.get("chart_title", ""),
        "data":        data,
        "sql":         sql,
        "explanation": state.get("chart_explanation", ""),
        "color_rules": color_rules,
        "palette":     state.get("chart_palette", "tableau10"),
    }

    return {
        "answer":     state.get("answer") or "Here is your chart.",
        "chart_dict": chart_dict,
    }


# ---------------------------------------------------------------------------
# Parallel fan-out: run sql + chart agents concurrently
# ---------------------------------------------------------------------------
def node_parallel(state: AgentState) -> dict:
    """Run sql_agent and chart_agent in parallel using asyncio."""
    async def _run():
        loop = asyncio.get_event_loop()
        sql_fut   = loop.run_in_executor(None, node_sql_agent,   state)
        chart_fut = loop.run_in_executor(None, node_chart_agent, state)
        sql_result, chart_result = await asyncio.gather(sql_fut, chart_fut)
        return {**sql_result, **chart_result}

    try:
        loop = asyncio.new_event_loop()
        result = loop.run_until_complete(_run())
        loop.close()
    except Exception:
        # Fallback: sequential
        result = {**node_sql_agent(state), **node_chart_agent(state)}
    return result


# ---------------------------------------------------------------------------
# Routing function after judge
# ---------------------------------------------------------------------------
def route_after_judge(state: AgentState) -> str:
    if state.get("judge_passed", True):
        return "assemble"
    return "parallel"   # retry both agents with feedback


# ---------------------------------------------------------------------------
# Build the LangGraph
# ---------------------------------------------------------------------------
def _build_graph() -> Any:
    graph = StateGraph(AgentState)

    graph.add_node("enhance_prompt", node_enhance_prompt)
    graph.add_node("parallel",       node_parallel)
    graph.add_node("judge",          node_judge)
    graph.add_node("assemble",       node_assemble)

    graph.add_edge(START,            "enhance_prompt")
    graph.add_edge("enhance_prompt", "parallel")
    graph.add_edge("parallel",       "judge")
    graph.add_conditional_edges(
        "judge",
        route_after_judge,
        {"assemble": "assemble", "parallel": "parallel"},
    )
    graph.add_edge("assemble", END)

    return graph.compile()


_graph = None

def _get_graph():
    global _graph
    if _graph is None:
        _graph = _build_graph()
    return _graph


# ---------------------------------------------------------------------------
# Public interface — identical signature to the original azure_agent.py
# ---------------------------------------------------------------------------
def call_agent(user_message: str, history: list[dict] | None = None) -> tuple[str, dict | None]:
    """
    Drop-in replacement for the original call_agent.
    Returns (answer: str, chart_dict: dict | None).
    """
    if not settings.AZURE_OPENAI_ENDPOINT or not settings.AZURE_OPENAI_API_KEY:
        return "Azure AI is not configured.", None

    initial_state: AgentState = {
        "original_message": user_message,
        "history":          history or [],
        "enhanced_prompt":  "",
        "rag_context":      "",
        "sql":              "",
        "sql_rows":         [],
        "sql_error":        "",
        "chart_type":       "bar",
        "chart_title":      "",
        "chart_palette":    "tableau10",
        "chart_explanation":"",
        "color_rules":      None,
        "judge_passed":     False,
        "judge_feedback":   "",
        "retry_count":      0,
        "answer":           "",
        "chart_dict":       None,
    }

    try:
        final_state = _get_graph().invoke(initial_state)
        return final_state.get("answer", "No answer generated."), final_state.get("chart_dict")
    except Exception as e:
        return f"Agent error: {e}", None
