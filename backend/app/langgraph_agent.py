"""
langgraph_agent.py  —  fully LangChain + LangGraph implementation
=================================================================
Drop-in replacement for azure_agent.py.

Public interface (identical signature):
    call_agent(user_message, history) -> tuple[str, dict | None]

Stack:
    - langchain-openai  →  AzureChatOpenAI  (LLM calls)
    - langchain-core    →  ChatPromptTemplate, tool decorator
    - langgraph         →  StateGraph, START, END, ToolNode

Flow:
    START
      └─► enhance_prompt   (fast model, structured JSON output)
            ├─► sql_agent  (gpt-4o + run_query tool, agentic loop)
            └─► chart_agent(fast model, structured JSON output)
                  └─► judge (gpt-4o, structured JSON output)
                        ├─► pass → assemble → END
                        └─► fail → retry    → judge  (max 3 loops)

Requirements (add to requirements.txt):
    langgraph
    langchain-openai
    langchain-core
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TypedDict, Optional, Annotated
import operator

from langchain_openai import AzureChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.tools import tool
from langchain_core.messages import HumanMessage, SystemMessage

from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode

from app.config import settings
from app.query_engine import execute_query, normalize_data

# ---------------------------------------------------------------------------
# Load static knowledge files (same paths as original azure_agent.py)
# ---------------------------------------------------------------------------
_data_dir    = Path(__file__).parent / "data"
_visuals_dir = Path(__file__).parent.parent.parent / "visuals"

_SCHEMA  = (_data_dir    / "schema.md").read_text(encoding="utf-8")
_METRICS = (_data_dir    / "metrics_dictionary.md").read_text(encoding="utf-8")
_CHARTS  = (_visuals_dir / "charts.json").read_text(encoding="utf-8")
_PALLETS = (_visuals_dir / "pallets.json").read_text(encoding="utf-8")
_PROMPT  = (_visuals_dir / "prompt.txt").read_text(encoding="utf-8")

# ---------------------------------------------------------------------------
# LangChain LLM instances — both point at your single Azure endpoint
# AZURE_FAST_DEPLOYMENT_NAME is optional; falls back to AZURE_DEPLOYMENT_NAME
# ---------------------------------------------------------------------------
_MAIN_MODEL = settings.AZURE_DEPLOYMENT_NAME
_FAST_MODEL = getattr(settings, "AZURE_FAST_DEPLOYMENT_NAME", _MAIN_MODEL)


def _make_llm(deployment: str, max_tokens: int) -> AzureChatOpenAI:
    return AzureChatOpenAI(
        azure_deployment=deployment,
        azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
        api_key=settings.AZURE_OPENAI_API_KEY,
        api_version="2024-02-15-preview",
        max_tokens=max_tokens,
        temperature=0,
    )


llm_fast = _make_llm(_FAST_MODEL, max_tokens=400)   # agents 1 & 3
llm_main = _make_llm(_MAIN_MODEL, max_tokens=1000)  # agents 2 & 4

# ---------------------------------------------------------------------------
# LangChain Tool — run_query (used by SQL agent)
# ---------------------------------------------------------------------------
@tool
def run_query(sql: str) -> str:
    """
    Execute a PostgreSQL SELECT query against the Supabase conversations database.
    Returns rows as a JSON array (max 50 rows).
    Always use this to validate SQL before finalising.
    """
    try:
        rows = execute_query(sql)
        return json.dumps(rows[:50])
    except Exception as e:
        return f"Query error: {e}"


_tools         = [run_query]
_tool_node     = ToolNode(_tools)
llm_with_tools = llm_main.bind_tools(_tools)

# ---------------------------------------------------------------------------
# LangGraph state
# ---------------------------------------------------------------------------
class AgentState(TypedDict):
    # input
    original_message: str
    history:          list[dict]

    # agent 1 output
    enhanced_prompt:  str
    rag_context:      str

    # agent 2 output — Annotated[list, operator.add] lets langgraph
    # append messages across nodes instead of overwriting
    messages: Annotated[list, operator.add]
    sql:      str
    sql_rows: list[dict]
    answer:   str

    # agent 3 output
    chart_type:        str
    chart_title:       str
    chart_palette:     str
    chart_explanation: str
    color_rules:       Optional[dict]

    # agent 4 output
    judge_passed:   bool
    judge_feedback: str
    retry_count:    int

    # final output
    chart_dict: Optional[dict]


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------
_ENHANCER_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """\
You are a query normalizer for NR2Dashboard, a banking voicebot analytics dashboard.
Rephrase the user question into a precise analytical question.

Return ONLY a JSON object — no prose, no markdown fences:
{{
  "enhanced_prompt": "<rewritten question, same language as input>",
  "metric": "<containment_rate|csat|aht|volume|cost|escalation_rate|tool_success_rate>",
  "chart_hint": "<bar|line|pie|kpi|area|scatter>",
  "language": "<el|en>"
}}"""),
    ("human", "{user_message}"),
])

_SQL_SYSTEM = f"""\
You are a PostgreSQL expert for NR2Dashboard.
Write a correct SQL SELECT query and validate it using the run_query tool.

== DATABASE SCHEMA ==
{_SCHEMA}

== METRICS DEFINITIONS ==
{_METRICS}

== SQL RULES ==
- Available flat tables: conversations, turns, evaluations, data_collection, tool_calls
- bar/pie/line/area: exactly 2 columns — label (string), value (numeric). Always alias.
- kpi: 1 row, 1 numeric column.
- Limit bar/pie to 20 rows max.
- Always ALIAS computed columns: AVG(...) AS containment_rate
- Joins on turns: use DISTINCT conversation_id subquery to avoid duplicates.
- Rates/percentages: decimals 0-1 ONLY. NEVER multiply by 100.
- Containment rate: AVG(CASE WHEN call_successful='success' THEN 1.0 ELSE 0.0 END)

== COLUMN ACCESS GUIDE ==
The `conversations` table has these direct columns:
  conversation_id, agent_id, user_id, call_successful, call_duration_secs,
  main_language, bot_version, start_date, start_hour, start_dow, csat_score,
  outcome, region, termination_reason

The `conversations` table does NOT have a `segment` column directly.
To get customer segment, join with data_collection:
  JOIN data_collection dc ON dc.conversation_id = c.conversation_id
  WHERE dc.field_id = 'customer_segment'
  -- then use dc.value AS the segment label

Similarly for other data_collection fields (region, declared_language, etc.):
  field_id = 'region' | 'declared_language' | 'caller_line_type' | 'customer_segment'
  -- use dc.value for the label

The `turns` table has: conversation_id, role, time_in_call_secs, message,
  detected_intent, intent_confidence, sentiment, turn_number

The `evaluations` table has: conversation_id, criterion_id, result, rationale

The `tool_calls` table has: conversation_id, turn_number, tool_name, success, latency_ms

WORKFLOW:
1. Call run_query to validate your SQL.
2. If it errors with "column does not exist", check the COLUMN ACCESS GUIDE above and fix.
3. Fix and retry on errors (max 4 attempts).
4. When rows come back cleanly, stop calling tools and reply with plain text:
   FINAL_SQL: <the validated sql>
   ANSWER: <concise natural-language answer in the same language as the question>
"""

# Use mustache template_format so that embedded JSON { } from _CHARTS / _PALLETS
# are treated as literal characters (not template variables). Mustache variables
# use {{double_braces}} syntax, which doesn't conflict with JSON content.
_CHART_PROMPT = ChatPromptTemplate.from_messages([
    ("system", f"""\
You are a data visualisation expert for NR2Dashboard.
Given the analytical question and context, decide the best chart specification.

== CHART GUIDE ==
{_CHARTS}

== PALETTE GUIDE ==
{_PALLETS}

== RULES ==
- Values 0-1 are rates — never multiply by 100.
- Containment rate threshold = 0.85; always add color_rules for containment charts.

Return ONLY a JSON object — no prose, no markdown fences:
{{
  "chart_type": "<bar|line|area|pie|kpi|scatter>",
  "title": "<short descriptive title>",
  "palette": "<vega-lite-name from PALETTE GUIDE>",
  "explanation": "<one sentence describing what the chart shows>",
  "color_rules": null
}}
For containment: set color_rules to {{"threshold": 0.85, "above": "purple", "below": "orange"}}"""),
    ("human", "Question: {{enhanced_prompt}}\nContext: {{rag_context}}{{feedback}}"),
], template_format="mustache")

_JUDGE_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """\
You are a quality-control judge for NR2Dashboard chart responses.
Evaluate whether the SQL result and chart spec correctly answer the user question.

Score criteria (each pass/fail):
1. sql_correct       — SQL logically answers the question
2. shape_match       — columns match chart_type requirements
3. data_non_empty    — rows were returned
4. chart_appropriate — chart type fits the data
5. answer_relevant   — answer text addresses the question

Pass threshold: score >= 4 AND sql_correct = true AND data_non_empty = true.

Return ONLY a JSON object — no prose, no markdown fences:
{{
  "passed": true|false,
  "score": <0-5>,
  "failures": ["<criterion>"],
  "feedback": "<one actionable sentence if failed, else empty string>"
}}"""),
    ("human", """\
User question: {original_message}

SQL: {sql}

Sample rows (first 5):
{sample_rows}

Chart spec:
  type: {chart_type}
  title: {chart_title}
  explanation: {chart_explanation}

Answer: {answer}"""),
])

# ---------------------------------------------------------------------------
# Helper: strip markdown fences and parse JSON
# ---------------------------------------------------------------------------
def _parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text  = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


# ---------------------------------------------------------------------------
# Node 1 — Prompt enhancer
# (LangChain: ChatPromptTemplate | AzureChatOpenAI)
# ---------------------------------------------------------------------------
def node_enhance_prompt(state: AgentState) -> dict:
    print("[node_enhance_prompt] START")
    chain  = _ENHANCER_PROMPT | llm_fast
    result = chain.invoke({"user_message": state["original_message"]})

    try:
        parsed      = _parse_json(result.content)
        enhanced    = parsed.get("enhanced_prompt", state["original_message"])
        chart_hint  = parsed.get("chart_hint", "bar")
        language    = parsed.get("language", "en")
        rag_context = (
            f"Suggested chart: {chart_hint}. Language: {language}. "
            f"Available palettes: tableau10, viridis, redblue, spectral, blues, dark2."
        )
        print(f"[node_enhance_prompt] Enhanced: {enhanced!r}")
    except Exception as e:
        print(f"[node_enhance_prompt] Parse failed: {e}, using original")
        enhanced    = state["original_message"]
        rag_context = "Suggested chart: bar. Language: en."

    return {
        "enhanced_prompt": enhanced,
        "rag_context":     rag_context,
        "messages":        [],  # reset message list for sql agent
    }


# ---------------------------------------------------------------------------
# Node 2 — SQL agent
# (LangChain: AzureChatOpenAI.bind_tools → ToolNode agentic loop)
# ---------------------------------------------------------------------------
def node_sql_agent(state: AgentState) -> dict:
    print("[node_sql_agent] START")
    feedback  = state.get("judge_feedback", "")
    user_text = state["enhanced_prompt"]
    if feedback:
        user_text += f"\n\nPrevious attempt failed. Judge feedback: {feedback}\nPlease fix."

    messages = [
        SystemMessage(content=_SQL_SYSTEM),
        HumanMessage(content=user_text),
    ]

    sql    = ""
    answer = ""

    # Agentic tool-use loop — max 6 iterations
    for i in range(6):
        print(f"[node_sql_agent] LLM call #{i+1}")
        response = llm_with_tools.invoke(messages)
        messages.append(response)

        # No tool calls → model is done
        if not response.tool_calls:
            content = response.content or ""
            for line in content.splitlines():
                if line.startswith("FINAL_SQL:"):
                    sql = line.replace("FINAL_SQL:", "").strip()
                elif line.startswith("ANSWER:"):
                    answer = line.replace("ANSWER:", "").strip()
            if not answer:
                answer = content
            print(f"[node_sql_agent] Done. sql={sql[:60]!r}")
            break

        # Execute all tool calls via LangChain ToolNode
        print(f"[node_sql_agent] Running tool calls: {[tc['name'] for tc in response.tool_calls]}")
        tool_output = _tool_node.invoke({"messages": messages})
        messages.extend(tool_output["messages"])

        # Track the last SQL that was submitted
        for tc in response.tool_calls:
            if tc["name"] == "run_query":
                sql = tc["args"].get("sql", sql)

    # Fetch rows for judge + assembler
    sql_rows: list[dict] = []
    if sql:
        try:
            sql_rows = execute_query(sql)[:50]
            print(f"[node_sql_agent] Fetched {len(sql_rows)} rows")
        except Exception as e:
            print(f"[node_sql_agent] Row fetch failed: {e}")

    return {
        "messages": messages,
        "sql":      sql,
        "sql_rows": sql_rows,
        "answer":   answer,
    }


# ---------------------------------------------------------------------------
# Node 3 — Chart design agent
# (LangChain: ChatPromptTemplate | AzureChatOpenAI)
# ---------------------------------------------------------------------------
def node_chart_agent(state: AgentState) -> dict:
    feedback     = state.get("judge_feedback", "")
    feedback_str = (
        f"\n\nJudge feedback: {feedback}\nPlease fix the chart spec."
        if feedback else ""
    )

    chain  = _CHART_PROMPT | llm_fast
    result = chain.invoke({
        "enhanced_prompt": state["enhanced_prompt"],
        "rag_context":     state.get("rag_context", ""),
        "feedback":        feedback_str,
    })

    try:
        parsed = _parse_json(result.content)
    except Exception:
        parsed = {
            "chart_type":  "bar",
            "title":       state["enhanced_prompt"][:60],
            "palette":     "tableau10",
            "explanation": "",
            "color_rules": None,
        }

    return {
        "chart_type":        parsed.get("chart_type", "bar"),
        "chart_title":       parsed.get("title", ""),
        "chart_palette":     parsed.get("palette", "tableau10"),
        "chart_explanation": parsed.get("explanation", ""),
        "color_rules":       parsed.get("color_rules"),
    }


# ---------------------------------------------------------------------------
# Node 4 — Judge
# (LangChain: ChatPromptTemplate | AzureChatOpenAI)
# ---------------------------------------------------------------------------
def node_judge(state: AgentState) -> dict:
    retry_count = state.get("retry_count", 0)

    # Hard stop at 3 retries — pass through whatever we have
    if retry_count >= 3:
        return {
            "judge_passed":   True,
            "judge_feedback": "",
            "retry_count":    retry_count,
        }

    sample = json.dumps(state.get("sql_rows", [])[:5], indent=2)
    chain  = _JUDGE_PROMPT | llm_main
    result = chain.invoke({
        "original_message":  state["original_message"],
        "sql":               state.get("sql", ""),
        "sample_rows":       sample,
        "chart_type":        state.get("chart_type", ""),
        "chart_title":       state.get("chart_title", ""),
        "chart_explanation": state.get("chart_explanation", ""),
        "answer":            state.get("answer", ""),
    })

    try:
        parsed   = _parse_json(result.content)
        passed   = bool(parsed.get("passed", True))
        feedback = parsed.get("feedback", "")
    except Exception:
        passed   = True
        feedback = ""

    return {
        "judge_passed":   passed,
        "judge_feedback": feedback,
        "retry_count":    retry_count + (0 if passed else 1),
    }


# ---------------------------------------------------------------------------
# Node 5 — Assemble final output
# ---------------------------------------------------------------------------
def node_assemble(state: AgentState) -> dict:
    raw_type = state.get("chart_type", "bar").lower()
    if   "pie"     in raw_type: chart_type = "pie"
    elif "line"    in raw_type: chart_type = "line"
    elif "area"    in raw_type: chart_type = "area"
    elif "kpi"     in raw_type: chart_type = "kpi"
    elif "scatter" in raw_type: chart_type = "scatter"
    else:                       chart_type = "bar"

    sql = state.get("sql", "")
    try:
        rows = state.get("sql_rows") or execute_query(sql)
        data = normalize_data(rows, chart_type)
    except Exception as e:
        return {"answer": f"Could not build chart: {e}", "chart_dict": None}

    raw_color   = state.get("color_rules")
    color_rules = raw_color if isinstance(raw_color, dict) and raw_color else None

    return {
        "answer": state.get("answer") or "Here is your chart.",
        "chart_dict": {
            "type":        chart_type,
            "title":       state.get("chart_title", ""),
            "data":        data,
            "sql":         sql,
            "explanation": state.get("chart_explanation", ""),
            "color_rules": color_rules,
            "palette":     state.get("chart_palette", "tableau10"),
        },
    }


# ---------------------------------------------------------------------------
# Retry node — re-runs sql + chart agents with judge feedback
# (sequential, no asyncio — safe inside uvicorn's event loop)
# ---------------------------------------------------------------------------
def node_retry(state: AgentState) -> dict:
    sql_result   = node_sql_agent(state)
    chart_result = node_chart_agent(state)
    return {**sql_result, **chart_result}


# ---------------------------------------------------------------------------
# Routing: after judge → pass or retry
# ---------------------------------------------------------------------------
def route_after_judge(state: AgentState) -> str:
    return "assemble" if state.get("judge_passed", True) else "retry"


# ---------------------------------------------------------------------------
# Build and compile the LangGraph
# ---------------------------------------------------------------------------
def _build_graph():
    graph = StateGraph(AgentState)

    graph.add_node("enhance_prompt", node_enhance_prompt)
    graph.add_node("sql_agent",      node_sql_agent)
    graph.add_node("chart_agent",    node_chart_agent)
    graph.add_node("judge",          node_judge)
    graph.add_node("retry",          node_retry)
    graph.add_node("assemble",       node_assemble)

    graph.add_edge(START,            "enhance_prompt")
    graph.add_edge("enhance_prompt", "sql_agent")
    graph.add_edge("enhance_prompt", "chart_agent")
    graph.add_edge("sql_agent",      "judge")
    graph.add_edge("chart_agent",    "judge")
    graph.add_conditional_edges(
        "judge",
        route_after_judge,
        {"assemble": "assemble", "retry": "retry"},
    )
    graph.add_edge("retry",    "judge")
    graph.add_edge("assemble", END)

    return graph.compile()


_graph = None


def _get_graph():
    global _graph
    if _graph is None:
        _graph = _build_graph()
    return _graph


# ---------------------------------------------------------------------------
# Public interface — identical signature to original azure_agent.py
# ---------------------------------------------------------------------------
def call_agent(
    user_message: str,
    history: list[dict] | None = None,
) -> tuple[str, dict | None]:
    """
    Drop-in replacement for the original call_agent.
    Returns (answer: str, chart_dict: dict | None).
    """
    if not settings.AZURE_OPENAI_ENDPOINT or not settings.AZURE_OPENAI_API_KEY:
        return "Azure AI is not configured.", None

    initial_state: AgentState = {
        "original_message":  user_message,
        "history":           history or [],
        "enhanced_prompt":   "",
        "rag_context":       "",
        "messages":          [],
        "sql":               "",
        "sql_rows":          [],
        "answer":            "",
        "chart_type":        "bar",
        "chart_title":       "",
        "chart_palette":     "tableau10",
        "chart_explanation": "",
        "color_rules":       None,
        "judge_passed":      False,
        "judge_feedback":    "",
        "retry_count":       0,
        "chart_dict":        None,
    }

    try:
        final = _get_graph().invoke(initial_state)
        return final.get("answer", "No answer generated."), final.get("chart_dict")
    except Exception as e:
        return f"Agent error: {e}", None