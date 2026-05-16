import json
import re

# pyrefly: ignore [missing-import]
from langchain_core.messages import AIMessage, HumanMessage

from app.agent import call_llm
from app.query_engine import execute_query
from state import State


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _strip_markdown_fences(text: str) -> str:
    """Remove leading/trailing ``` or ```json fences from an LLM response."""
    text = text.strip()
    text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
    text = re.sub(r"\n?```$", "", text)
    return text.strip()


def _lc_messages_to_dicts(messages) -> list[dict]:
    """Convert LangChain BaseMessage objects to OpenAI-style role/content dicts."""
    role_map = {"human": "user", "ai": "assistant", "system": "system"}
    return [
        {"role": role_map.get(getattr(m, "type", "human"), "user"), "content": m.content}
        for m in messages
    ]


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------

def orchestrate(state: State) -> dict:
    """
    Analyses the conversation and produces:
      - sql_prompt            → instruction for the SQL-generation node
      - chart_prompt          → instruction for the chart-generation node
      - natural_language_response → human-readable answer / commentary
    """
    system = (
        "You are an expert data analyst assistant. "
        "You receive a user question and a database schema. "
        "Your job is to produce a JSON object with exactly three keys:\n"
        "  1. \"sql_prompt\": a clear, self-contained instruction for another LLM to write "
        "     a SQL query that answers the user's question. Include any relevant schema context.\n"
        "  2. \"chart_prompt\": a clear, self-contained instruction for another LLM to write "
        "     Python Altair code that visualises the query results. Describe the desired chart type, "
        "     axes, title, and any styling preferences.\n"
        "  3. \"natural_language_response\": a concise, friendly message to show the user "
        "     while the data is being fetched.\n\n"
        "Respond with ONLY valid JSON — no markdown fences, no extra text.\n\n"
        f"Database schema:\n{state.get('db_schema', '')}"
    )

    history = _lc_messages_to_dicts(state.get("messages", []))
    raw = _strip_markdown_fences(
        call_llm(state["user_question"], system=system, history=history)
    )
    parsed = json.loads(raw)

    return {
        "messages": [
            HumanMessage(content=state["user_question"]),
            AIMessage(content=parsed["natural_language_response"]),
        ],
        "sql_prompt": parsed["sql_prompt"],
        "chart_prompt": parsed["chart_prompt"],
        "natural_language_response": parsed["natural_language_response"],
        "error": None,
    }


def generate_sql(state: State) -> dict:
    """
    Calls the LLM with the sql_prompt + db_schema and returns a raw SQL query string.
    """
    system = (
        "You are an expert SQL developer. "
        "Given an instruction and a database schema, write a single valid PostgreSQL query "
        "that fulfils the instruction.\n"
        "Rules:\n"
        "  - Return ONLY the raw SQL query. No markdown fences, no explanations.\n"
        "  - Do NOT include a trailing semicolon.\n"
        "  - Only SELECT or WITH queries — no mutations.\n"
        "  - Use only tables and columns that exist in the schema provided.\n\n"
        f"Database schema:\n{state.get('db_schema', '')}"
    )

    sql_query = _strip_markdown_fences(
        call_llm(state["sql_prompt"], system=system)
    ).strip()

    return {"sql_query": sql_query}


def execute_sql(state: State) -> dict:
    """
    Executes state["sql_query"] against Supabase via execute_query() (psycopg2 + SUPABASE_DB_URL).
    Returns query_results as list[dict], or sets error on failure.
    """
    sql_query = state.get("sql_query", "")
    if not sql_query:
        return {"query_results": [], "error": "No SQL query was generated."}

    try:
        query_results = execute_query(sql_query)
        return {"query_results": query_results, "error": None}
    except Exception as exc:
        return {"query_results": [], "error": str(exc)}


def generate_chart(state: State) -> dict:
    """
    Calls the LLM with the chart_prompt + query_results and returns Python Altair code.
    The returned code defines a variable named `chart`.
    """
    results_json = json.dumps(state.get("query_results", []), indent=2)

    system = (
        "You are an expert data visualisation engineer specialising in Python Altair. "
        "Given a chart instruction and query results as JSON, write Python code that "
        "creates an Altair chart.\n"
        "Rules:\n"
        "  - Return ONLY valid Python code. No markdown fences, no explanations.\n"
        "  - The final chart object MUST be assigned to a variable named `chart`.\n"
        "  - Start with `import altair as alt` and any other required imports.\n"
        "  - Embed the data directly (use alt.Data or pd.DataFrame from the JSON below).\n"
        "  - Do NOT include file I/O or plt.show() calls.\n"
        "  - The code must be self-contained and executable.\n\n"
        f"Query results (JSON):\n{results_json}"
    )

    chart_code = _strip_markdown_fences(
        call_llm(state["chart_prompt"], system=system)
    ).strip()

    return {"chart_code": chart_code}