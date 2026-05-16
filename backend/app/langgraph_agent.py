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
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage

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

_SQL_SYSTEM = """\
You are a PostgreSQL expert for NR2Dashboard, a banking voicebot analytics platform.
Your ONLY job is to write and validate a SQL SELECT query using the run_query tool.

== IMPORTANT: SUPABASE FLAT TABLES (PostgreSQL) ==
Do NOT use DuckDB syntax, nested structs, or dot-notation column access.
Do NOT use conversations_raw, v_conversations, or any view names.
Use ONLY these five flat tables with the exact columns listed below.

-- TABLE: conversations
   conversation_id    TEXT  (primary key)
   agent_id           TEXT  (e.g. 'agt_bank_voicebot_v2_2_1')
   agent_name         TEXT
   user_id            TEXT
   status             TEXT
   start_time         TIMESTAMPTZ
   start_date         DATE   ← use this for daily/weekly grouping
   start_hour         INT    (0-23)
   start_dow          INT    (0=Sunday … 6=Saturday)
   call_duration_secs BIGINT
   cost_amount        FLOAT
   cost_currency      TEXT   (always 'EUR')
   call_direction     TEXT
   from_number        TEXT
   termination_reason TEXT   ('completed'|'transferred_to_human'|'caller_hung_up'|'silence_timeout')
   bot_version        TEXT   ('2.2.1' or '2.3.0')
   transcript_summary TEXT
   call_successful    TEXT   ('success'|'failure'|'unknown')
   main_language      TEXT   ('el'|'en')
   segment            TEXT   ('new'|'returning'|'premium'|'business'|'unknown')
   region             TEXT   ('attica'|'thessaloniki'|'crete'|'patras'|'larissa'|'other_gr'|'international')
   csat_score         FLOAT  (1.0–5.0, NULL if not surveyed ~70% of calls)
   csat_collected     BOOL
   outcome            TEXT   ('resolved'|'escalated'|'abandoned'|'timeout')

-- TABLE: turns
   id                 BIGINT (PK)
   conversation_id    TEXT   (FK → conversations)
   start_time         TIMESTAMPTZ
   agent_id           TEXT
   main_language      TEXT
   role               TEXT   ('agent'|'user')
   time_in_call_secs  BIGINT
   message            TEXT
   detected_intent    TEXT   (populated on user turns that surface an intent)
   intent_confidence  FLOAT
   sentiment          TEXT   ('positive'|'neutral'|'negative')
   turn_number        BIGINT
   tool_calls_count   BIGINT

-- TABLE: evaluations
   id                 BIGINT (PK)
   conversation_id    TEXT   (FK → conversations)
   start_time         TIMESTAMPTZ
   agent_id           TEXT
   bot_version        TEXT
   main_language      TEXT
   segment            TEXT
   region             TEXT
   criterion_id       TEXT   ('authentication_completed'|'intent_resolved'|'escalation_triggered'|
                               'compliance_disclaimer_given'|'pii_handled_safely'|
                               'fallback_count_acceptable'|'language_consistency'|'tool_call_success_rate')
   result             TEXT   ('success'|'failure'|'unknown')
   rationale          TEXT

-- TABLE: data_collection
   id                 BIGINT (PK)
   conversation_id    TEXT   (FK → conversations)
   start_time         TIMESTAMPTZ
   agent_id           TEXT
   bot_version        TEXT
   main_language      TEXT
   segment            TEXT
   region             TEXT
   field_id           TEXT   ('customer_segment'|'region'|'declared_language'|'caller_line_type'|
                               'account_type_referenced'|'transfer_amount_bucket'|
                               'transfer_destination_country'|'card_type_referenced'|
                               'loan_type_inquired'|'auth_method_used'|'self_service_completed'|
                               'promised_callback'|'complaint_detected'|'topic_tags')
   value              TEXT
   rationale          TEXT

-- TABLE: tool_calls
   id                 BIGINT (PK)
   conversation_id    TEXT   (FK → conversations)
   start_time         TIMESTAMPTZ
   agent_id           TEXT
   main_language      TEXT
   time_in_call_secs  BIGINT
   tool_name          TEXT
   success            BOOLEAN
   latency_ms         BIGINT

== SQL RULES ==
- Use ONLY the five tables above. No other tables or views exist.
- bar/pie/line/area: return exactly 2 columns — label (string) first, numeric value second. Always alias both.
- kpi: return 1 row with 1 numeric column.
- Limit bar/pie results to 20 rows max. Use ORDER BY + LIMIT.
- Always ALIAS computed columns: e.g. COUNT(*) AS call_count, AVG(...) AS containment_rate
- When joining turns for intent: wrap in a subquery with DISTINCT conversation_id to avoid row duplication.
- Rates/percentages: decimals 0-1 ONLY. NEVER multiply by 100.
- Containment rate formula: AVG(CASE WHEN call_successful = 'success' THEN 1.0 ELSE 0.0 END)
- For daily queries use start_date (DATE column on conversations) — do NOT cast start_time.
- For customer segment use the segment column directly on conversations (do NOT join data_collection for this).
- For criterion pass rate: AVG(CASE WHEN result = 'success' THEN 1.0 ELSE 0.0 END) on evaluations, filtered by criterion_id.
- For tool reliability: AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) on tool_calls, grouped by tool_name.

== METRICS QUICK REFERENCE ==
- containment_rate  : AVG(CASE WHEN call_successful='success' THEN 1.0 ELSE 0.0 END) on conversations
- csat              : AVG(csat_score) WHERE csat_score IS NOT NULL on conversations
- aht               : AVG(call_duration_secs) on conversations
- volume            : COUNT(*) on conversations (or turns)
- cost_per_call     : AVG(cost_amount) on conversations
- escalation_rate   : AVG(CASE WHEN outcome='escalated' THEN 1.0 ELSE 0.0 END) on conversations

== WORKFLOW ==
Step 1: Call run_query with your SQL.
Step 2: If it returns a "Query error", read the error, fix the SQL, and call run_query again.
Step 3: Once run_query returns actual data rows (a JSON array that is NOT an error string),
        stop calling tools and write a plain-text reply:
        - One short sentence answering the user's question in their language.
        - Do NOT call run_query again after receiving rows.
        - Do NOT output JSON. Plain text only.
"""

# Escape { } in the JSON content so LangChain's template parser
# doesn't try to interpret them as variable placeholders.
_CHARTS_ESC  = _CHARTS.replace("{", "{{").replace("}", "}}")
_PALLETS_ESC = _PALLETS.replace("{", "{{").replace("}", "}}")

_CHART_SYSTEM = (
    "You are a data visualisation expert for NR2Dashboard.\n"
    "Given the analytical question and context, decide the best chart specification.\n\n"
    "== CHART GUIDE ==\n"
    + _CHARTS_ESC +
    "\n\n== PALETTE GUIDE ==\n"
    + _PALLETS_ESC +
    "\n\n== RULES ==\n"
    "- Values 0-1 are rates — never multiply by 100.\n"
    "- Containment rate threshold = 0.85; always add color_rules for containment charts.\n\n"
    "Return ONLY a JSON object — no prose, no markdown fences:\n"
    '{{"chart_type": "<bar|line|area|pie|kpi|scatter>",\n'
    ' "title": "<short descriptive title>",\n'
    ' "palette": "<vega-lite-name from PALETTE GUIDE>",\n'
    ' "explanation": "<one sentence describing what the chart shows>",\n'
    ' "color_rules": null}}\n'
    "For containment charts set color_rules to:\n"
    '{{"threshold": 0.85, "above": "purple", "below": "orange"}}\n'
)

_JUDGE_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """\
You are a quality-control judge for NR2Dashboard chart responses.
Evaluate whether the SQL result and chart spec correctly answer the user question.

Score criteria (each pass/fail):
1. sql_correct       — SQL logically answers the question
2. shape_match       — columns match chart_type requirements
3. data_non_empty    — rows were returned (sql_rows is not empty)
4. chart_appropriate — chart type fits the data
5. answer_relevant   — answer text addresses the question

Pass threshold: score >= 4 AND sql_correct = true AND data_non_empty = true.

Return ONLY a JSON object — no prose, no markdown fences:
{{
  "passed": true,
  "score": 5,
  "failures": [],
  "feedback": ""
}}"""),
    ("human", """\
User question: {original_message}

SQL: {sql}

Row count: {row_count}

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
# ---------------------------------------------------------------------------
def node_enhance_prompt(state: AgentState) -> dict:
    print("[enhance_prompt] START")
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
        print(f"[enhance_prompt] → {enhanced!r}")
    except Exception as e:
        print(f"[enhance_prompt] parse failed ({e}), using original")
        enhanced    = state["original_message"]
        rag_context = "Suggested chart: bar. Language: en."

    return {
        "enhanced_prompt": enhanced,
        "rag_context":     rag_context,
        "messages":        [],
    }


# ---------------------------------------------------------------------------
# Node 2 — SQL agent
# Key fix: SQL is captured from tool call args (reliable),
# not from parsing model text output (unreliable).
# ---------------------------------------------------------------------------
def node_sql_agent(state: AgentState) -> dict:
    print("[sql_agent] START")
    feedback  = state.get("judge_feedback", "")
    user_text = state["enhanced_prompt"]
    if feedback:
        user_text += f"\n\nPrevious attempt failed. Judge feedback: {feedback}\nPlease fix."

    messages = [
        SystemMessage(content=_SQL_SYSTEM),
        HumanMessage(content=user_text),
    ]

    last_good_sql  = ""   # last SQL that returned rows (not an error)
    last_sql_tried = ""   # last SQL submitted (even if it errored)
    answer         = ""
    sql_rows: list[dict] = []

    for i in range(6):
        print(f"[sql_agent] call #{i+1}")
        response = llm_with_tools.invoke(messages)
        messages.append(response)

        if not response.tool_calls:
            # Model gave a text answer — use it as the answer
            answer = response.content or ""
            print(f"[sql_agent] text reply: {answer[:80]!r}")
            break

        # Run tool calls
        print(f"[sql_agent] tools: {[tc['name'] for tc in response.tool_calls]}")
        tool_output = _tool_node.invoke({"messages": messages})
        new_msgs    = tool_output["messages"]
        messages.extend(new_msgs)

        # Check each tool call result
        for tc, tm in zip(response.tool_calls, new_msgs):
            if tc["name"] != "run_query":
                continue

            submitted_sql  = tc["args"].get("sql", "")
            last_sql_tried = submitted_sql
            tool_result    = tm.content if isinstance(tm, ToolMessage) else ""

            if tool_result.startswith("Query error"):
                print(f"[sql_agent] query error: {tool_result[:120]}")
                # keep looping so model can fix
            else:
                # Successful query — capture SQL and rows immediately
                try:
                    rows = json.loads(tool_result)
                    if isinstance(rows, list) and len(rows) > 0:
                        last_good_sql = submitted_sql
                        sql_rows      = rows[:50]
                        print(f"[sql_agent] got {len(sql_rows)} rows ✓")
                except Exception:
                    pass

    # Use the best SQL we found
    final_sql = last_good_sql or last_sql_tried

    # If we still have no rows but have a good SQL, fetch now
    if not sql_rows and final_sql:
        try:
            sql_rows = execute_query(final_sql)[:50]
            print(f"[sql_agent] fallback fetch: {len(sql_rows)} rows")
        except Exception as e:
            print(f"[sql_agent] fallback fetch failed: {e}")

    if not answer:
        answer = f"Here are the results for: {state['enhanced_prompt']}"

    print(f"[sql_agent] DONE — sql={final_sql[:60]!r}, rows={len(sql_rows)}")
    return {
        "messages": messages,
        "sql":      final_sql,
        "sql_rows": sql_rows,
        "answer":   answer,
    }


# ---------------------------------------------------------------------------
# Node 3 — Chart design agent
# ---------------------------------------------------------------------------
def node_chart_agent(state: AgentState) -> dict:
    print("[chart_agent] START")
    feedback     = state.get("judge_feedback", "")
    feedback_str = (
        f"\n\nJudge feedback: {feedback}\nPlease fix the chart spec."
        if feedback else ""
    )

    prompt = ChatPromptTemplate.from_messages([
        ("system", _CHART_SYSTEM),
        ("human", "Question: {enhanced_prompt}\nContext: {rag_context}{feedback}"),
    ])
    chain  = prompt | llm_fast
    result = chain.invoke({
        "enhanced_prompt": state["enhanced_prompt"],
        "rag_context":     state.get("rag_context", ""),
        "feedback":        feedback_str,
    })

    try:
        parsed = _parse_json(result.content)
        print(f"[chart_agent] type={parsed.get('chart_type')}")
    except Exception as e:
        print(f"[chart_agent] parse failed ({e}), using defaults")
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
# ---------------------------------------------------------------------------
def node_judge(state: AgentState) -> dict:
    retry_count = state.get("retry_count", 0)
    print(f"[judge] START (retry #{retry_count})")

    # Hard stop at 3 retries
    if retry_count >= 3:
        print("[judge] max retries hit — forcing pass")
        return {
            "judge_passed":   True,
            "judge_feedback": "",
            "retry_count":    retry_count,
        }

    sql_rows   = state.get("sql_rows", [])
    row_count  = len(sql_rows)
    sample     = json.dumps(sql_rows[:5], indent=2)

    chain  = _JUDGE_PROMPT | llm_main
    result = chain.invoke({
        "original_message":  state["original_message"],
        "sql":               state.get("sql", ""),
        "row_count":         row_count,
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
        score    = parsed.get("score", 5)
        print(f"[judge] score={score}, passed={passed}, feedback={feedback!r}")
    except Exception as e:
        print(f"[judge] parse failed ({e}) — defaulting to pass")
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
    print("[assemble] START")
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

    print(f"[assemble] chart_type={chart_type}, data_len={len(data) if isinstance(data, list) else 1}")
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
# (sequential — safe inside uvicorn's event loop, no asyncio conflict)
# ---------------------------------------------------------------------------
def node_retry(state: AgentState) -> dict:
    print("[retry] re-running sql + chart agents")
    sql_result   = node_sql_agent(state)
    chart_result = node_chart_agent(state)
    return {**sql_result, **chart_result}


# ---------------------------------------------------------------------------
# Routing: after judge → pass or retry
# ---------------------------------------------------------------------------
def route_after_judge(state: AgentState) -> str:
    result = "assemble" if state.get("judge_passed", True) else "retry"
    print(f"[route_after_judge] → {result}")
    return result


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
        print(f"[call_agent] EXCEPTION: {e}")
        return f"Agent error: {e}", None