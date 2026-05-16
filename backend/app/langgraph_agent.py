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
      └─► enhance_prompt   (fast model — JSON: enhanced_prompt, metric, chart_hint,
      |                      language, breakdown_by + RAG: fetches chart docs)
            ├─► sql_agent  (main model + run_query tool, agentic loop up to 6 calls)
            └─► chart_agent(fast model — JSON chart spec, uses RAG chart docs)
                  └─► judge (main model — scores quality, pass/fail)
                        ├─► pass → assemble → END
                        └─► fail → retry    → judge  (max 3 loops)

RAG strategy:
    - schema.md + metrics_dictionary.md : always fully injected (SQL agent needs all of it)
    - pallets.json                       : always fully injected (small, always needed)
    - charts.json                        : RAG — only relevant chart type docs retrieved
                                           based on chart_hint from enhance_prompt node.
                                           Retrieved once in Node 1, stored in state as
                                           chart_docs, consumed by Node 3.

Requirements (add to requirements.txt):
    langgraph
    langchain-openai
    langchain-core
"""

from __future__ import annotations

import json
import operator
from pathlib import Path
from typing import Annotated, Optional, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.tools import tool
from langchain_openai import AzureChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode

from app.config import settings
from app.query_engine import execute_query, normalize_data

# ---------------------------------------------------------------------------
# Load static knowledge files
# ---------------------------------------------------------------------------
_data_dir    = Path(__file__).parent / "data"
_visuals_dir = Path(__file__).parent.parent.parent / "visuals"


def _load_file(path: Path, default: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        print(f"Warning: {path} not found, using empty default")
        return default


_SCHEMA      = _load_file(_visuals_dir / "schema.md")
_METRICS     = _load_file(_data_dir    / "metrics_dictionary.md")
_PALLETS     = _load_file(_visuals_dir / "pallets.json", default="{}")
_CHARTS_RAW  = _load_file(_visuals_dir / "charts.json",  default="{}")

# Parse charts once at startup for RAG lookups
try:
    _CHARTS_INDEX: dict = json.loads(_CHARTS_RAW)
except Exception:
    _CHARTS_INDEX = {}

# ---------------------------------------------------------------------------
# RAG — retrieve relevant chart docs by chart_hint
# ---------------------------------------------------------------------------

# Map chart_hint values → chart names in charts.json
_CHART_HINT_MAP: dict[str, list[str]] = {
    "bar":      ["Bar Chart", "Grouped Bar Chart", "Stacked Bar Chart", "Column Chart"],
    "line":     ["Line Chart", "Multi-set Line Chart", "Slope Chart"],
    "area":     ["Area Chart", "Stacked Area Chart"],
    "pie":      ["Pie Chart", "Donut Chart"],
    "kpi":      [],          # no chart doc needed — single number
    "scatter":  ["Scatterplot", "Bubble Chart"],
    "heatmap":  ["Heatmap (Matrix)"],
}


def _retrieve_chart_docs(chart_hint: str) -> str:
    """
    Return a compact JSON string containing only the chart type entries
    relevant to the given chart_hint. Falls back to bar if hint unknown.
    Empty string is returned for 'kpi' (no doc needed).
    """
    keys = _CHART_HINT_MAP.get(chart_hint, _CHART_HINT_MAP["bar"])
    if not keys:
        return ""
    docs = {k: _CHARTS_INDEX[k] for k in keys if k in _CHARTS_INDEX}
    if not docs:
        # Fallback: return bar docs
        bar_keys = _CHART_HINT_MAP["bar"]
        docs = {k: _CHARTS_INDEX[k] for k in bar_keys if k in _CHARTS_INDEX}
    return json.dumps(docs, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# LLM instances
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


llm_fast = _make_llm(_FAST_MODEL, max_tokens=500)    # agents 1 & 3
llm_main = _make_llm(_MAIN_MODEL, max_tokens=1200)   # agents 2 & 4

# ---------------------------------------------------------------------------
# Tool — run_query
# ---------------------------------------------------------------------------

def _json_safe(obj):
    import datetime, decimal
    if isinstance(obj, decimal.Decimal):
        return float(obj)
    if isinstance(obj, (datetime.date, datetime.datetime)):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


@tool
def run_query(sql: str) -> str:
    """
    Execute a PostgreSQL SELECT query against the Supabase conversations database.
    Returns rows as a JSON array (max 50 rows).
    Always use this to validate SQL before finalising.
    """
    try:
        rows = execute_query(sql)
        return json.dumps(rows[:50], default=_json_safe)
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
    metric:           str
    chart_hint:       str
    language:         str
    breakdown_by:     str
    chart_docs:       str   # RAG result: relevant chart type documentation

    # agent 2 output
    # Annotated[list, operator.add] → langgraph appends messages across nodes
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


# ===========================================================================
# AGENT SYSTEM PROMPTS
# ===========================================================================

# ---------------------------------------------------------------------------
# Agent 1 — Prompt Enhancer + RAG Classifier
# ---------------------------------------------------------------------------
_ENHANCER_SYSTEM = """\
You are a query classifier for NR2Dashboard, a banking voicebot analytics dashboard \
for a Greek bank. The dataset has ~10,000 calls over 90 days in Greek and English.

Your job: turn the user's raw question into a precise analytical question and classify it \
so the downstream SQL and chart agents can work correctly.

== CHART HINT RULES ==
Single summary number (overall rate, total, average with no grouping)  → "kpi"
Distribution or share of 2–5 categories (breakdown, split, ποσοστό)   → "pie"
Ranking or comparison across many categories (top N, by X, ανά)        → "bar"
Trend over time (daily, weekly, hourly, τάση, over time)               → "line"
Two dimensions as a grid (hour × day, region × intent, heatmap)        → "heatmap"
Relationship between two numeric variables (correlation, vs, σχέση)    → "scatter"

== METRIC CLASSIFICATION ==
containment_rate  → AVG(CASE WHEN call_successful='success' THEN 1.0 ELSE 0.0 END)
csat              → AVG(csat_score) WHERE csat_score IS NOT NULL (~70% of calls have it)
aht               → AVG(call_duration_secs)
volume            → COUNT(*) on conversations
cost              → AVG(cost_amount) or SUM(cost_amount)
escalation_rate   → AVG(CASE WHEN outcome='escalated' THEN 1.0 ELSE 0.0 END)
tool_success_rate → AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) on tool_calls

== OUTPUT ==
Return ONLY valid JSON — no prose, no markdown fences:
{{
  "enhanced_prompt": "<precise analytical question, same language as user input>",
  "metric": "<containment_rate|csat|aht|volume|cost|escalation_rate|tool_success_rate|other>",
  "chart_hint": "<bar|line|pie|kpi|heatmap|scatter>",
  "language": "<el|en>",
  "breakdown_by": "<grouping dimension if any: region|intent|bot_version|segment|hour|date|null>"
}}"""

# ---------------------------------------------------------------------------
# Agent 2 — SQL Agent
# (schema and metrics are always fully injected — SQL agent needs all of it)
# ---------------------------------------------------------------------------
_SQL_SYSTEM = f"""\
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
- bar/pie/line/area : return exactly 2 columns — label TEXT first, numeric value second. Always alias both.
- kpi              : return 1 row with 1 numeric column.
- heatmap          : return exactly 3 columns — row_label TEXT, col_label TEXT, value NUMERIC.
- scatter          : return exactly 2 numeric columns — x first, y second.
- Limit bar/pie results to 20 rows max. Use ORDER BY value DESC LIMIT 20.
- For line charts  : ORDER BY date/time ASC.
- Always ALIAS computed columns: COUNT(*) AS call_count, AVG(...) AS containment_rate, etc.
- When joining turns for intent: wrap in a subquery with DISTINCT conversation_id to avoid row duplication.
- Rates/percentages: decimals 0–1 ONLY. NEVER multiply by 100. Frontend handles formatting.
- For daily queries: use start_date (DATE column on conversations) — do NOT cast start_time.
- For customer segment: use segment column directly on conversations. Do NOT join data_collection.
- For criterion pass rate: AVG(CASE WHEN result='success' THEN 1.0 ELSE 0.0 END) on evaluations, filtered by criterion_id.
- For tool reliability: AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) on tool_calls, grouped by tool_name.

== METRICS QUICK REFERENCE ==
- containment_rate  : AVG(CASE WHEN call_successful='success' THEN 1.0 ELSE 0.0 END) on conversations
- csat              : AVG(csat_score) WHERE csat_score IS NOT NULL on conversations
- aht               : AVG(call_duration_secs) on conversations
- volume            : COUNT(*) on conversations (or turns)
- cost_per_call     : AVG(cost_amount) on conversations
- escalation_rate   : AVG(CASE WHEN outcome='escalated' THEN 1.0 ELSE 0.0 END) on conversations

== HUMAN-READABLE COLUMN ALIASES (always use these) ==
  call_duration_secs  → avg_handle_time_secs
  csat_score          → avg_csat_score
  cost_amount         → avg_cost_eur
  COUNT(*)            → call_volume
  start_date          → date

== DATABASE SCHEMA ==
{_SCHEMA}

== METRICS DEFINITIONS ==
{_METRICS}

== WORKFLOW ==
Step 1: Call run_query with your SQL.
Step 2: If it returns "Query error", read the error carefully, fix the SQL, call run_query again (max 5 retries).
Step 3: Once run_query returns a non-empty JSON array, STOP calling tools.
        Write ONE plain-text sentence answering the user's question in their language.
        Do NOT output JSON. Do NOT call run_query again after receiving rows.
"""

# ---------------------------------------------------------------------------
# Agent 3 — Chart Design Agent
# (chart_docs injected at runtime from RAG — only relevant chart types)
# Palettes always injected in full — small file
# ---------------------------------------------------------------------------
_PALLETS_ESC = _PALLETS.replace("{", "{{").replace("}", "}}")

_CHART_AGENT_SYSTEM_BASE = (
    "You are a data visualisation expert for NR2Dashboard, a banking voicebot analytics dashboard.\n"
    "You receive an analytical question, relevant chart type documentation (RAG), and palette options.\n"
    "Produce the best chart specification as a JSON object.\n\n"
    "== SUPPORTED CHART TYPES ==\n"
    "Use ONLY these types (the frontend supports exactly these):\n"
    "  bar      → ranking or comparison across categories; sort descending unless time-ordered\n"
    "  line     → trend over time; x-axis must be a date or hour\n"
    "  area     → cumulative or stacked trend over time\n"
    "  pie      → part-of-whole for 2–5 categories ONLY; never for >5 slices\n"
    "  kpi      → single summary number; no axes needed\n"
    "  scatter  → relationship between two numeric variables\n"
    "  heatmap  → two categorical dimensions as a grid\n\n"
    "== PALETTE SELECTION ==\n"
    "  Categorical / nominal groups         → tableau10\n"
    "  Sequential / rates / counts / KPIs   → blues or viridis\n"
    "  Diverging / sentiment / delta        → redblue or spectral\n"
    "  Bot version or binary comparisons    → dark2\n"
    "  Always use lowercase vega-lite names.\n\n"
    "== CONSISTENT DIMENSION COLORS ==\n"
    "When these values appear in the data, use these colors in color_rules or annotations:\n"
    "  el (Greek) → blue      | en (English) → orange\n"
    "  resolved   → green     | escalated → amber | abandoned → red | timeout → grey\n"
    "  v2.2.1     → #90CAF9   | v2.3.0 → #1565C0\n\n"
    "== COLOR RULES (threshold-based coloring) ==\n"
    "Add color_rules ONLY for these metrics:\n"
    '  containment_rate  → {{"threshold": 0.85, "above": "purple", "below": "orange"}}\n'
    '  csat_score        → {{"threshold": 3.5,  "above": "green",  "below": "red"}}\n'
    '  tool_success_rate → {{"threshold": 0.90, "above": "green",  "below": "red"}}\n'
    "  All other metrics → null\n\n"
    "== TITLE RULES ==\n"
    "Short, human-readable, includes the grouping dimension if present.\n"
    "  WRONG: 'bar chart of data' | 'Chart 1'\n"
    "  RIGHT: 'Containment Rate by Region' | 'Daily Call Volume — Last 90 Days'\n"
    "Include (n=X) in title when the metric is an average or rate, if row count is available from context.\n\n"
    "== AXIS LABEL MAP (never use raw column names) ==\n"
    "  start_date / date       → 'Date'\n"
    "  call_duration_secs      → 'Handle Time (s)'\n"
    "  avg_handle_time_secs    → 'Avg Handle Time (s)'\n"
    "  csat_score              → 'CSAT Score (1–5)'\n"
    "  avg_csat_score          → 'Avg CSAT Score'\n"
    "  cost_amount / avg_cost  → 'Cost (EUR)'\n"
    "  containment_rate        → 'Containment Rate'\n"
    "  escalation_rate         → 'Escalation Rate'\n"
    "  call_volume / COUNT     → 'Call Volume'\n\n"
    "== RATES — NEVER MULTIPLY BY 100 ==\n"
    "All rate values are decimals 0–1. The frontend formats them as percentages.\n\n"
    "== PALETTE GUIDE ==\n"
    + _PALLETS_ESC
    + "\n\n"
    "== RELEVANT CHART TYPE DOCUMENTATION (RAG) ==\n"
    "{chart_docs}\n\n"
    "Return ONLY a JSON object — no prose, no markdown fences:\n"
    '{{\n'
    '  "chart_type":  "<bar|line|area|pie|kpi|scatter|heatmap>",\n'
    '  "title":       "<short human-readable title>",\n'
    '  "palette":     "<vega-lite palette name>",\n'
    '  "explanation": "<one sentence: what does this chart show and why is this chart type correct>",\n'
    '  "color_rules": null\n'
    '}}\n'
)

# ---------------------------------------------------------------------------
# Agent 4 — Judge
# ---------------------------------------------------------------------------
_JUDGE_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """\
You are a quality-control judge for NR2Dashboard chart responses.
Evaluate whether the SQL result and chart spec correctly and completely answer the user's question.

== SCORING CRITERIA (each is pass/fail) ==
1. sql_correct       — SQL logically answers the exact question asked (not a similar one)
2. shape_match       — column count and types match the chart_type contract:
                         bar/pie/area/line → 2 cols (label TEXT, value NUMERIC)
                         kpi              → 1 col, 1 row, NUMERIC only
                         scatter          → 2 NUMERIC cols
                         heatmap          → 3 cols (row TEXT, col TEXT, value NUMERIC)
3. data_non_empty    — sql_rows is not empty (at least 1 row returned)
4. chart_appropriate — chart type fits the data shape and question intent
                         (pie only if ≤5 categories, kpi only if 1 row, etc.)
5. answer_relevant   — the plain-text answer sentence addresses the user's question in their language

== PASS THRESHOLD ==
passed = true ONLY IF:  score >= 4  AND  sql_correct = true  AND  data_non_empty = true

== FEEDBACK ==
If passed = false, write ONE specific actionable instruction.
Be precise — tell the agent exactly what to fix.
  BAD:  "Fix the SQL."
  GOOD: "SQL returns 3 columns but chart_type=bar requires exactly 2; remove the third column."
  GOOD: "No rows returned — the WHERE clause filters out all data; relax the date filter."

Return ONLY a JSON object — no prose, no markdown fences:
{{
  "passed":   true,
  "score":    5,
  "failures": [],
  "feedback": ""
}}"""),
    ("human", """\
User question: {original_message}

SQL:
{sql}

Row count: {row_count}

Sample rows (first 5):
{sample_rows}

Chart spec:
  type:        {chart_type}
  title:       {chart_title}
  explanation: {chart_explanation}

Answer: {answer}"""),
])


# ===========================================================================
# NODES
# ===========================================================================

# ---------------------------------------------------------------------------
# Node 1 — Prompt Enhancer  (also runs RAG for chart docs)
# ---------------------------------------------------------------------------
def node_enhance_prompt(state: AgentState) -> dict:
    print("[enhance_prompt] START")

    # Include recent history for follow-up question context
    history = state.get("history", [])
    history_str = ""
    if history:
        recent = history[-4:]
        history_str = "\n\nRecent conversation context:\n" + "\n".join(
            f"{m['role'].upper()}: {m['content'][:200]}" for m in recent
        )

    prompt = ChatPromptTemplate.from_messages([
        ("system", _ENHANCER_SYSTEM),
        ("human",  "{user_message}"),
    ])
    chain  = prompt | llm_fast
    result = chain.invoke({"user_message": state["original_message"] + history_str})

    # Defaults
    enhanced     = state["original_message"]
    metric       = "volume"
    chart_hint   = "bar"
    language     = "en"
    breakdown_by = "null"

    try:
        parsed       = _parse_json(result.content)
        enhanced     = parsed.get("enhanced_prompt", enhanced)
        metric       = parsed.get("metric",       metric)
        chart_hint   = parsed.get("chart_hint",   chart_hint)
        language     = parsed.get("language",     language)
        breakdown_by = parsed.get("breakdown_by", breakdown_by) or "null"
        print(f"[enhance_prompt] → {enhanced!r} | metric={metric} | hint={chart_hint} | lang={language}")
    except Exception as e:
        print(f"[enhance_prompt] parse failed ({e}), using defaults")

    # RAG: retrieve only the relevant chart type docs
    chart_docs = _retrieve_chart_docs(chart_hint)
    if chart_docs:
        print(f"[enhance_prompt] RAG: retrieved {len(chart_docs)} chars for hint={chart_hint!r}")
    else:
        print(f"[enhance_prompt] RAG: no chart docs for hint={chart_hint!r} (kpi or unknown)")

    return {
        "enhanced_prompt": enhanced,
        "metric":          metric,
        "chart_hint":      chart_hint,
        "language":        language,
        "breakdown_by":    breakdown_by,
        "chart_docs":      chart_docs,
        "messages":        [],
        # Keep rag_context for backward compat with any downstream readers
        "rag_context": (
            f"metric={metric}, chart_hint={chart_hint}, language={language}, "
            f"breakdown_by={breakdown_by}. "
            f"Available palettes: tableau10, viridis, redblue, spectral, blues, dark2."
        ),
    }


# ---------------------------------------------------------------------------
# Node 2 — SQL Agent
# ---------------------------------------------------------------------------
def node_sql_agent(state: AgentState) -> dict:
    print("[sql_agent] START")
    feedback  = state.get("judge_feedback", "")
    language  = state.get("language", "en")
    user_text = state["enhanced_prompt"]
    if feedback:
        user_text += f"\n\nPrevious attempt failed. Judge feedback: {feedback}\nPlease fix."

    # Inject language so the agent knows what language to reply in
    sql_system = _SQL_SYSTEM + f"\n\nAnswer in: {'Greek' if language == 'el' else 'English'}."

    messages: list = [
        SystemMessage(content=sql_system),
        HumanMessage(content=user_text),
    ]

    last_good_sql  = ""
    last_sql_tried = ""
    answer         = ""
    sql_rows: list[dict] = []

    for i in range(6):
        print(f"[sql_agent] call #{i+1}")
        response = llm_with_tools.invoke(messages)
        messages.append(response)

        if not response.tool_calls:
            answer = response.content or ""
            print(f"[sql_agent] text reply: {answer[:80]!r}")
            break

        print(f"[sql_agent] tools: {[tc['name'] for tc in response.tool_calls]}")
        tool_output = _tool_node.invoke({"messages": messages})
        new_msgs    = tool_output["messages"]
        messages.extend(new_msgs)

        for tc, tm in zip(response.tool_calls, new_msgs):
            if tc["name"] != "run_query":
                continue

            submitted_sql  = tc["args"].get("sql", "")
            last_sql_tried = submitted_sql
            tool_result    = tm.content if isinstance(tm, ToolMessage) else ""

            if tool_result.startswith("Query error"):
                print(f"[sql_agent] query error: {tool_result[:120]}")
            else:
                try:
                    rows = json.loads(tool_result)
                    if isinstance(rows, list) and len(rows) > 0:
                        last_good_sql = submitted_sql
                        sql_rows = json.loads(json.dumps(rows[:50], default=_json_safe))
                        print(f"[sql_agent] got {len(sql_rows)} rows ✓")
                except Exception:
                    pass

    final_sql = last_good_sql or last_sql_tried

    # Fallback fetch if model stopped without returning rows
    if not sql_rows and final_sql:
        try:
            sql_rows = execute_query(final_sql)[:50]
            sql_rows = json.loads(json.dumps(sql_rows, default=_json_safe))
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
# Node 3 — Chart Design Agent
# (receives chart_docs from state — populated by Node 1 RAG)
# ---------------------------------------------------------------------------
def node_chart_agent(state: AgentState) -> dict:
    print("[chart_agent] START")

    feedback     = state.get("judge_feedback", "")
    feedback_str = (
        f"\n\nJudge feedback: {feedback}\nPlease fix the chart spec."
        if feedback else ""
    )

    # Inject RAG chart docs into the system prompt
    chart_docs = state.get("chart_docs", "") or "No specific chart documentation available; use your best judgement."
    chart_system = _CHART_AGENT_SYSTEM_BASE.replace("{chart_docs}", chart_docs.replace("{", "{{").replace("}", "}}"))

    prompt = ChatPromptTemplate.from_messages([
        ("system", chart_system),
        ("human",
         "Question: {enhanced_prompt}\n"
         "Metric: {metric}\n"
         "Suggested chart hint: {chart_hint}\n"
         "Breakdown by: {breakdown_by}\n"
         "Language: {language}{feedback}"),
    ])
    chain  = prompt | llm_fast
    result = chain.invoke({
        "enhanced_prompt": state["enhanced_prompt"],
        "metric":          state.get("metric",       "volume"),
        "chart_hint":      state.get("chart_hint",   "bar"),
        "breakdown_by":    state.get("breakdown_by", "null"),
        "language":        state.get("language",     "en"),
        "feedback":        feedback_str,
    })

    try:
        parsed = _parse_json(result.content)
        print(f"[chart_agent] type={parsed.get('chart_type')} title={parsed.get('title')!r}")
    except Exception as e:
        print(f"[chart_agent] parse failed ({e}), using defaults")
        parsed = {
            "chart_type":  state.get("chart_hint", "bar"),
            "title":       state["enhanced_prompt"][:60],
            "palette":     "tableau10",
            "explanation": "",
            "color_rules": None,
        }

    return {
        "chart_type":        parsed.get("chart_type",  "bar"),
        "chart_title":       parsed.get("title",       ""),
        "chart_palette":     parsed.get("palette",     "tableau10"),
        "chart_explanation": parsed.get("explanation", ""),
        "color_rules":       parsed.get("color_rules"),
    }


# ---------------------------------------------------------------------------
# Node 4 — Judge
# ---------------------------------------------------------------------------
def node_judge(state: AgentState) -> dict:
    retry_count = state.get("retry_count", 0)
    print(f"[judge] START (retry #{retry_count})")

    if retry_count >= 3:
        print("[judge] max retries hit — forcing pass")
        return {
            "judge_passed":   True,
            "judge_feedback": "",
            "retry_count":    retry_count,
        }

    sql_rows  = state.get("sql_rows", [])
    row_count = len(sql_rows)
    sample    = json.dumps(sql_rows[:5], indent=2)

    chain  = _JUDGE_PROMPT | llm_main
    result = chain.invoke({
        "original_message":  state["original_message"],
        "sql":               state.get("sql",               ""),
        "row_count":         row_count,
        "sample_rows":       sample,
        "chart_type":        state.get("chart_type",        ""),
        "chart_title":       state.get("chart_title",       ""),
        "chart_explanation": state.get("chart_explanation", ""),
        "answer":            state.get("answer",            ""),
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
    elif "heatmap" in raw_type: chart_type = "heatmap"
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
            "title":       state.get("chart_title",       ""),
            "data":        data,
            "sql":         sql,
            "explanation": state.get("chart_explanation", ""),
            "color_rules": color_rules,
            "palette":     state.get("chart_palette",     "tableau10"),
        },
    }


# ---------------------------------------------------------------------------
# Retry node — re-runs SQL + chart agents with judge feedback injected
# ---------------------------------------------------------------------------
def node_retry(state: AgentState) -> dict:
    print("[retry] re-running sql + chart agents")
    sql_result   = node_sql_agent(state)
    chart_result = node_chart_agent(state)
    return {**sql_result, **chart_result}


# ---------------------------------------------------------------------------
# Routing: after judge
# ---------------------------------------------------------------------------
def route_after_judge(state: AgentState) -> str:
    result = "assemble" if state.get("judge_passed", True) else "retry"
    print(f"[route_after_judge] → {result}")
    return result


# ---------------------------------------------------------------------------
# Build and compile the LangGraph (singleton)
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
        "metric":            "volume",
        "chart_hint":        "bar",
        "language":          "en",
        "breakdown_by":      "null",
        "chart_docs":        "",
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