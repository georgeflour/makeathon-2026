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

Prompt files (edit these without touching Python):
    prompts/enhancer_system.txt   — Agent 1: query classifier
    prompts/sql_system.txt        — Agent 2: SQL writer  ({schema} and {metrics} injected at runtime)
    prompts/chart_system.txt      — Agent 3: chart spec  ({palettes} and {chart_docs} injected at runtime)
    prompts/judge_system.txt      — Agent 4: quality judge

RAG strategy:
    - schema_explainations.md + metrics_dictionary.md : always fully injected into SQL agent
    - pallets.json                                   : always fully injected into chart agent
    - charts.json                                    : RAG — only relevant entries retrieved
                                                       based on chart_hint from Node 1,
                                                       stored in state.chart_docs, used by Node 3

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
from app.vegalite_retriever import retrieve_vegalite_docs, is_built as vegalite_is_built

# ---------------------------------------------------------------------------
# Directory layout — everything lives in prompts/ next to this file
# ---------------------------------------------------------------------------
#
#   backend/app/
#   ├── langgraph_agent.py
#   └── prompts/
#       ├── enhancer_system.txt      ← Agent 1 system prompt
#       ├── sql_system.txt           ← Agent 2 system prompt  ({schema} {metrics} placeholders)
#       ├── chart_system.txt         ← Agent 3 system prompt  ({palettes} {chart_docs} placeholders)
#       ├── judge_system.txt         ← Agent 4 system prompt
#       ├── schema_explainations.md   ← flat-table DB schema (injected into sql_system)
#       ├── metrics_dictionary.md    ← metric formulas       (injected into sql_system)
#       ├── pallets.json             ← palette catalogue      (injected into chart_system)
#       └── charts.json             ← chart type docs        (RAG source for chart_system)
#
_THIS_DIR    = Path(__file__).parent
_PROMPTS_DIR = _THIS_DIR / "prompts"


# ---------------------------------------------------------------------------
# File loader
# ---------------------------------------------------------------------------
def _load_file(path: Path, default: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        print(f"Warning: {path} not found, using empty default")
        return default


# ---------------------------------------------------------------------------
# Static knowledge — all loaded from prompts/, once at startup
# ---------------------------------------------------------------------------

# Agent system prompts (plain text — edit without touching Python)
_ENHANCER_SYSTEM_RAW   = _load_file(_PROMPTS_DIR / "enhancer_system.txt")
_SQL_SYSTEM_TEMPLATE   = _load_file(_PROMPTS_DIR / "sql_system.txt")     # placeholders: {schema} {metrics}
_CHART_SYSTEM_TEMPLATE = _load_file(_PROMPTS_DIR / "chart_system.txt")   # placeholders: {palettes} {chart_docs}
_JUDGE_SYSTEM_RAW      = _load_file(_PROMPTS_DIR / "judge_system.txt")

# Data / knowledge files (also in prompts/)
_SCHEMA     = _load_file(_PROMPTS_DIR / "schema_explainations.md")
_METRICS    = _load_file(_PROMPTS_DIR / "metrics_dictionary.md")
_PALLETS    = _load_file(_PROMPTS_DIR / "pallets.json",  default="{}")
_CHARTS_RAW = _load_file(_PROMPTS_DIR / "charts.json",   default="{}")

# Parse charts.json once for RAG lookups
try:
    _CHARTS_INDEX: dict = json.loads(_CHARTS_RAW)
except Exception:
    _CHARTS_INDEX = {}

# Build SQL system prompt once (schema + metrics are static, language added per call)
_SQL_SYSTEM_BASE = _SQL_SYSTEM_TEMPLATE.format(schema=_SCHEMA, metrics=_METRICS)

# Escape { } in enhancer + judge prompts so LangChain doesn't treat them as variables.
# Their only real template variable is in the human turn, not the system turn.
_ENHANCER_SYSTEM = _ENHANCER_SYSTEM_RAW.replace("{", "{{").replace("}", "}}")
_JUDGE_SYSTEM    = _JUDGE_SYSTEM_RAW.replace("{", "{{").replace("}", "}}")


# ---------------------------------------------------------------------------
# RAG — retrieve relevant chart docs by chart_hint
# ---------------------------------------------------------------------------
_CHART_HINT_MAP: dict[str, list[str]] = {
    "bar":          ["Bar Chart", "Grouped Bar Chart", "Stacked Bar Chart", "Column Chart"],
    "stacked_bar":  ["Stacked Bar Graph", "Bar Chart"],
    "grouped_bar":  ["Grouped Bar Chart", "Bar Chart"],
    "line":         ["Line Chart", "Multi-set Line Chart", "Slope Chart"],
    "area":         ["Area Graph", "Stacked Area Graph"],
    "stacked_area": ["Stacked Area Graph", "Area Graph"],
    "pie":          ["Pie Chart", "Donut Chart"],
    "donut":        ["Donut Chart", "Pie Chart"],
    "arc":          ["Donut Chart", "Pie Chart"],
    "sunburst":     ["Sunburst Diagram"],
    "radial":       ["Radial Bar Chart", "Radial Column Chart"],
    "kpi":          [],
    "scatter":      ["Scatterplot", "Bubble Chart"],
    "bubble":       ["Bubble Chart", "Scatterplot"],
    "heatmap":      ["Heatmap (Matrix)"],
    "calendar":     ["Calendar"],
    "boxplot":      ["Box and Whisker Plot"],
    "violin":       ["Violin Plot"],
    "errorbar":     ["Error Bars"],
    "histogram":    ["Histogram"],
    "density":      ["Density Plot"],
    "radar":        ["Radar Chart"],
    "candlestick":  ["Candlestick Chart"],
    "span":         ["Span Chart"],
    "tick":         ["Tally Chart", "Dot Plot"],
    "wordcloud":    ["Word Cloud"],
    "spiral":       ["Spiral Plot"],
    "stream":       ["Stream Graph"],
}


def _retrieve_chart_docs(chart_hint: str) -> str:
    """
    Return compact JSON of chart-type entries relevant to chart_hint.
    Falls back to bar entries if hint is unknown. Empty string for kpi.
    """
    keys = _CHART_HINT_MAP.get(chart_hint, _CHART_HINT_MAP["bar"])
    if not keys:
        return ""
    docs = {k: _CHARTS_INDEX[k] for k in keys if k in _CHARTS_INDEX}
    if not docs:  # key mismatch — fall back to bar
        docs = {k: _CHARTS_INDEX[k] for k in _CHART_HINT_MAP["bar"] if k in _CHARTS_INDEX}
    return json.dumps(docs, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# LLM instances
# ---------------------------------------------------------------------------
_MAIN_MODEL = settings.AZURE_DEPLOYMENT_NAME
_FAST_MODEL = settings.AZURE_FAST_DEPLOYMENT_NAME or _MAIN_MODEL  # ← fix: use 'or' not getattr


def _make_llm(deployment: str, max_tokens: int) -> AzureChatOpenAI:
    return AzureChatOpenAI(
        azure_deployment=deployment,
        azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
        api_key=settings.AZURE_OPENAI_API_KEY,
        api_version="2024-02-15-preview",
        max_tokens=max_tokens,
        temperature=0,
    )



llm_main = _make_llm(_MAIN_MODEL, max_tokens=1200)   # agents 2 & 4
print(f"[DEBUG] MAIN={_MAIN_MODEL!r} FAST={_FAST_MODEL!r}")
llm_fast = _make_llm(_FAST_MODEL, max_tokens=500)


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
    # stream callback
    on_step: Optional[callable]

    # input
    original_message: str
    history:          list[dict]

    # agent 1 output
    enhanced_prompt:  str
    metric:           str
    chart_hint:       str
    language:         str
    breakdown_by:     str
    chart_docs:       str    # RAG result: relevant chart type docs (from charts.json)
    vegalite_docs:    str    # RAG result: relevant Vega-Lite spec docs (from ChromaDB)
    rag_context:      str    # backward-compat summary string

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


# ---------------------------------------------------------------------------
# Static prompt templates (built once at import time)
# ---------------------------------------------------------------------------
_ENHANCER_PROMPT = ChatPromptTemplate.from_messages([
    ("system", _ENHANCER_SYSTEM),   # { } already escaped
    ("human",  "{user_message}"),
])

_JUDGE_PROMPT = ChatPromptTemplate.from_messages([
    ("system", _JUDGE_SYSTEM),      # { } already escaped
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
# CODE SNIPPETS — shown in the frontend when a user clicks on a step
# ===========================================================================

_STEP_CODE: dict[str, str] = {
    "enhancing": """\
prompt = ChatPromptTemplate.from_messages([
    ("system", ENHANCER_SYSTEM),
    ("human",  "{user_message}"),
])
chain  = prompt | llm_fast
result = chain.invoke({"user_message": original_message})
parsed = parse_json(result.content)
# → enhanced_prompt, metric, chart_hint, language, breakdown_by

chart_docs = retrieve_chart_docs(parsed["chart_hint"])""",

    "sql_generation": """\
messages = [
    SystemMessage(content=SQL_SYSTEM),
    HumanMessage(content=enhanced_prompt),
]
for _ in range(6):           # up to 6 LLM calls
    response = llm_with_tools.invoke(messages)
    if not response.tool_calls:
        break                # text answer ready
    tool_output = tool_node.invoke({"messages": messages})
    messages.extend(tool_output["messages"])""",

    "sql_executing": """\
@tool
def run_query(sql: str) -> str:
    \"\"\"Execute a read-only SQL query and return JSON rows.\"\"\"
    rows = execute_query(sql)
    return json.dumps(rows[:50])""",

    "charting": """\
prompt = ChatPromptTemplate.from_messages([
    ("system", CHART_AGENT_SYSTEM),   # injected with RAG chart docs
    ("human",  "Question: {enhanced_prompt}\\n"
               "Metric: {metric}\\n"
               "Chart hint: {chart_hint}\\n"
               "Breakdown by: {breakdown_by}"),
])
chain  = prompt | llm_fast
result = chain.invoke({**state})
parsed = parse_json(result.content)
# → chart_type, chart_title, chart_palette, color_rules""",

    "judging": """\
chain  = JUDGE_PROMPT | llm_main
result = chain.invoke({
    "original_message": state["original_message"],
    "sql":              state["sql"],
    "row_count":        len(state["sql_rows"]),
    "sample_rows":      state["sql_rows"][:5],
    "answer":           state["answer"],
})
verdict = parse_json(result.content)
if not verdict["pass"]:
    return {"judge_passed": False, "judge_feedback": verdict["feedback"]}
return {"judge_passed": True}""",
}


# ===========================================================================
# NODES
# ===========================================================================

# ---------------------------------------------------------------------------
# Node 1 — Prompt Enhancer + RAG classifier
# ---------------------------------------------------------------------------
def node_enhance_prompt(state: AgentState) -> dict:
    print("[enhance_prompt] START")
    if state.get("on_step"):
        state["on_step"]({"step": "enhancing", "message": "Analyzing your request...", "code": _STEP_CODE["enhancing"]})

    history = state.get("history", [])
    history_str = ""
    if history:
        recent = history[-4:]
        history_str = "\n\nRecent conversation context:\n" + "\n".join(
            f"{m['role'].upper()}: {m['content'][:200]}" for m in recent
        )

    chain  = _ENHANCER_PROMPT | llm_fast
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

    # RAG 1: retrieve relevant chart type docs from charts.json
    chart_docs = _retrieve_chart_docs(chart_hint)
    print(f"[enhance_prompt] RAG charts.json: {len(chart_docs)} chars for hint={chart_hint!r}")

    # RAG 2: retrieve relevant Vega-Lite spec docs from ChromaDB (if built)
    vegalite_docs = ""
    if vegalite_is_built():
        vegalite_docs = retrieve_vegalite_docs(
            query      = enhanced,
            chart_hint = chart_hint,
            k          = 5,
        )
        print(f"[enhance_prompt] RAG vega-lite: {len(vegalite_docs)} chars")
    else:
        print("[enhance_prompt] RAG vega-lite: Supabase table empty or not built — skipping")

    return {
        "enhanced_prompt": enhanced,
        "metric":          metric,
        "chart_hint":      chart_hint,
        "language":        language,
        "breakdown_by":    breakdown_by,
        "chart_docs":      chart_docs,
        "vegalite_docs":   vegalite_docs,
        "messages":        [],
        "rag_context": (
            f"metric={metric}, chart_hint={chart_hint}, language={language}, "
            f"breakdown_by={breakdown_by}."
        ),
    }


# ---------------------------------------------------------------------------
# Node 2 — SQL Agent
# ---------------------------------------------------------------------------
def node_sql_agent(state: AgentState) -> dict:
    print("[sql_agent] START")

    if state.get("on_step"):
        state["on_step"]({"step": "sql_generation", "message": "Querying the database...", "code": _STEP_CODE["sql_generation"]})
    feedback  = state.get("judge_feedback", "")
    language  = state.get("language", "en")
    user_text = state["enhanced_prompt"]
    if feedback:
        user_text += f"\n\nPrevious attempt failed. Judge feedback: {feedback}\nPlease fix."

    # Append language instruction at call time (not baked into static template)
    sql_system = _SQL_SYSTEM_BASE + f"\n\nAnswer in: {'Greek' if language == 'el' else 'English'}."

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
            if state.get("on_step"):
                state["on_step"]({"step": "sql_executing", "message": "Executing SQL...", "sql": submitted_sql, "code": _STEP_CODE["sql_executing"]})
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

    # Fallback fetch if model stopped before returning rows
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
# Builds system prompt at call time by filling {palettes}, {chart_docs},
# and {vegalite_docs} from the template file, then escaping remaining { }.
# ---------------------------------------------------------------------------
def node_chart_agent(state: AgentState) -> dict:
    print("[chart_agent] START")
    if state.get("on_step"):
        state["on_step"]({"step": "charting", "message": "Designing your visualization...", "code": _STEP_CODE["charting"]})

    feedback     = state.get("judge_feedback", "")
    feedback_str = (
        f"\n\nJudge feedback: {feedback}\nPlease fix the chart spec."
        if feedback else ""
    )

    chart_docs = (
        state.get("chart_docs") or
        "No specific chart documentation available; use your best judgement."
    )
    vegalite_docs = (
        state.get("vegalite_docs") or
        "Vega-Lite reference not available; use your knowledge of the Vega-Lite spec."
    )

    # Step 1: fill the three runtime placeholders with real content
    chart_system_filled = (
        _CHART_SYSTEM_TEMPLATE
        .replace("{palettes}",      _PALLETS)
        .replace("{chart_docs}",    chart_docs)
        .replace("{vegalite_docs}", vegalite_docs)
    )
    # Step 2: escape ALL remaining { } so LangChain doesn't misread JSON in content
    chart_system_escaped = chart_system_filled.replace("{", "{{").replace("}", "}}")

    prompt = ChatPromptTemplate.from_messages([
        ("system", chart_system_escaped),
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
    if state.get("on_step"):
        state["on_step"]({"step": "judging", "message": "Verifying results...", "code": _STEP_CODE["judging"]})

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
    raw_type = state.get("chart_type", "bar").lower().strip()

    # Map chart_type string → canonical key used by normalize_data and frontend
    # Groups share the same normalize_data path
    _TYPE_MAP = {
        # arc family (pie/donut/sunburst/radial) → label+value
        "pie":          "pie",
        "donut":        "pie",
        "arc":          "pie",
        "sunburst":     "pie",
        "radial":       "pie",
        "radial_bar":   "pie",

        # bar family → label+value  (stacked/grouped handled separately)
        "bar":          "bar",
        "column":       "bar",
        "histogram":    "bar",
        "span":         "span",
        "range_bar":    "span",
        "stacked_bar":  "stacked_bar",
        "grouped_bar":  "grouped_bar",
        "multiset_bar": "grouped_bar",
        "bullet":       "bar",
        "population_pyramid": "bar",

        # line family → label+value
        "line":         "line",
        "slope":        "line",
        "spiral":       "line",
        "radar":        "line",

        # area family → label+value
        "area":         "area",
        "stacked_area": "stacked_area",
        "stream":       "area",
        "density":      "area",
        "violin":       "area",

        # rect family → row+col+value
        "heatmap":      "heatmap",
        "calendar":     "heatmap",
        "rect":         "heatmap",
        "timetable":    "heatmap",

        # point/circle family
        "scatter":      "scatter",
        "bubble":       "bubble",
        "dot":          "scatter",
        "dot_matrix":   "scatter",

        # kpi
        "kpi":          "kpi",
        "text":         "kpi",      # single-value text mark
        "wordcloud":    "bar",      # word + frequency → bar-like

        # statistical
        "boxplot":      "boxplot",
        "box":          "boxplot",
        "errorbar":     "errorbar",
        "error_bar":    "errorbar",

        # financial
        "candlestick":  "candlestick",
        "ohlc":         "candlestick",
        "rule_bar":     "candlestick",

        # tick / tally / timeline
        "tick":         "bar",
        "tally":        "bar",
        "timeline":     "bar",
        "gantt":        "bar",
    }

    chart_type = _TYPE_MAP.get(raw_type)

    # Fuzzy fallback — match substrings
    if chart_type is None:
        for key, mapped in _TYPE_MAP.items():
            if key in raw_type or raw_type in key:
                chart_type = mapped
                break

    if chart_type is None:
        chart_type = "bar"   # last resort

    print(f"[assemble] raw_type={raw_type!r} → chart_type={chart_type!r}")

    sql = state.get("sql", "")
    try:
        rows = state.get("sql_rows") or execute_query(sql)
        data = normalize_data(rows, chart_type)
    except Exception as e:
        return {"answer": f"Could not build chart: {e}", "chart_dict": None}

    raw_color   = state.get("color_rules")
    color_rules = raw_color if isinstance(raw_color, dict) and raw_color else None

    print(f"[assemble] data_len={len(data) if isinstance(data, list) else 1}")
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
    on_step: Optional[callable] = None,
) -> tuple[str, dict | None]:
    """
    Drop-in replacement for the original call_agent.
    Returns (answer: str, chart_dict: dict | None).
    """
    if not settings.AZURE_OPENAI_ENDPOINT or not settings.AZURE_OPENAI_API_KEY:
        return "Azure AI is not configured.", None

    initial_state: AgentState = {
        "on_step":           on_step,
        "original_message":  user_message,
        "history":           history or [],
        "enhanced_prompt":   "",
        "metric":            "volume",
        "chart_hint":        "bar",
        "language":          "en",
        "breakdown_by":      "null",
        "chart_docs":        "",
        "vegalite_docs":     "",
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