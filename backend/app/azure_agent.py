import json
from pathlib import Path

from openai import AzureOpenAI

from app.config import settings
from app.query_engine import execute_query, normalize_data

_data_dir = Path(__file__).parent / "data"
_SCHEMA = (_data_dir / "schema.md").read_text(encoding="utf-8")
_METRICS = (_data_dir / "metrics_dictionary.md").read_text(encoding="utf-8")
_visuals_dir = Path(__file__).parent.parent.parent / "visuals"
_CHARTS = (_visuals_dir / "charts.json").read_text(encoding="utf-8")
_PALLETS = (_visuals_dir / "pallets.json").read_text(encoding="utf-8")
_PROMPT = (_visuals_dir / "prompt.txt").read_text(encoding="utf-8")

SYSTEM_PROMPT = (
    "You are NR2Dashboard, a data analyst AI for SmartRep's banking voicebot analytics platform.\n"
    "You have access to a PostgreSQL database (Supabase) with ~10,000 banking voicebot conversations over 90 days (Greek & English).\n\n"
    "== TOOLS ==\n"
    "- run_query(sql): Execute a PostgreSQL SQL SELECT query. Returns rows as JSON. Always use this to verify SQL first.\n"
    "- render_chart(...): Your FINAL step — always end by calling this, never return plain text.\n\n"
    "== SQL RULES ==\n"
    "- Use ONLY these flat tables: conversations, turns, evaluations, data_collection, tool_calls\n"
    "- For bar/pie/line/area: SQL must return exactly 2 columns — first = label/x-axis (string), second = numeric value. Always alias both columns.\n"
    "- For kpi: return 1 row with 1 numeric column\n"
    "- Limit bar/pie results to 20 rows max\n"
    "- Always ALIAS computed columns: e.g. AVG(...) AS containment_rate\n"
    "- When joining turns for intent: use a subquery with DISTINCT conversation_id to avoid duplicate rows\n\n"
    "== CHART SELECTION GUIDE ==\n"
    + _CHARTS
    + "\n\n"
    "== PALETTE SELECTION GUIDE ==\n"
    + _PALLETS
    + "\n\n"
    "== CHART CREATION PROMPT ==\n"
    + _PROMPT
    + "\n\n"
    "== RATES AND PERCENTAGES — CRITICAL ==\n"
    "- ALL rate/percentage values MUST be expressed as decimals between 0 and 1 (e.g. 0.76, not 76)\n"
    "- NEVER multiply by 100 in SQL — the frontend handles display formatting\n"
    "- Containment rate formula: AVG(CASE WHEN call_successful='success' THEN 1.0 ELSE 0.0 END)\n"
    "- The threshold for containment rate is 0.85 (not 85)\n"
    "- For containment charts always pass color_rules: {threshold: 0.85, above: 'purple', below: 'orange'}\n\n"
    "== LANGUAGE ==\n"
    "Answer in the same language as the user's question (Greek or English).\n\n"
    "== DATABASE SCHEMA ==\n"
    + _SCHEMA
    + "\n\n== METRICS DEFINITIONS ==\n"
    + _METRICS
)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "run_query",
            "description": (
                "Execute a PostgreSQL SQL SELECT query against the Supabase conversations database. "
                "Returns rows as a JSON array. Always test SQL here before calling render_chart."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {"type": "string", "description": "A valid DuckDB SQL SELECT query"}
                },
                "required": ["sql"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "render_chart",
            "description": "Call this as your FINAL step to render the dashboard chart. This ends the turn.",
            "parameters": {
                "type": "object",
                "properties": {
                    "answer": {
                        "type": "string",
                        "description": "Concise natural-language answer to the user's question",
                    },
                    "sql": {
                        "type": "string",
                        "description": "The final SQL query producing exactly 2 columns of chart data",
                    },
                    "chart_type": {
                        "type": "string",
                        "description": "The type of chart to render, from the CHART SELECTION GUIDE",
                    },
                    "palette": {
                        "type": "string",
                        "description": "The vega-lite-name of the selected color palette",
                    },
                    "title": {"type": "string", "description": "Chart title"},
                    "explanation": {
                        "type": "string",
                        "description": "One short plain-language sentence describing what this chart shows (e.g. 'Containment rate per intent, sorted from highest to lowest.'). Do NOT mention why this chart type was chosen.",
                    },
                    "color_rules": {
                        "type": "object",
                        "description": "Optional threshold-based coloring (use for containment rate charts)",
                        "properties": {
                            "threshold": {"type": "number"},
                            "above": {"type": "string"},
                            "below": {"type": "string"},
                        },
                    },
                },
                "required": ["answer", "sql", "chart_type", "title"],
            },
        },
    },
]


def call_agent(user_message: str, history: list[dict] | None = None) -> tuple[str, dict | None]:
    if not settings.AZURE_OPENAI_ENDPOINT or not settings.AZURE_OPENAI_API_KEY:
        return "Azure AI is not configured.", None

    try:
        openai_client = AzureOpenAI(
            api_key=settings.AZURE_OPENAI_API_KEY,
            api_version="2024-02-15-preview",
            azure_endpoint=settings.AZURE_OPENAI_ENDPOINT
        )
    except Exception as e:
        return f"Failed to connect to Azure AI: {e}", None

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    if history:
        # Drop trailing user messages — consecutive user turns are invalid for the API
        # and happen when the page is refreshed before an assistant response arrives.
        trimmed = [m for m in history if m.get("role") in ("user", "assistant") and m.get("content")]
        while trimmed and trimmed[-1]["role"] == "user":
            trimmed.pop()
        messages.extend(trimmed)

    messages.append({"role": "user", "content": user_message})

    for _ in range(6):
        try:
            response = openai_client.chat.completions.create(
                model=settings.AZURE_DEPLOYMENT_NAME,
                messages=messages,
                tools=TOOLS,
                tool_choice="required",
            )
        except Exception as e:
            return f"LLM error: {e}", None

        msg = response.choices[0].message

        if not msg.tool_calls:
            return msg.content or "No response generated.", None

        messages.append(msg)

        chart_args = None
        tool_results = []

        for tc in msg.tool_calls:
            try:
                args = json.loads(tc.function.arguments)
            except json.JSONDecodeError:
                args = {}

            if tc.function.name == "render_chart":
                chart_args = args
            elif tc.function.name == "run_query":
                try:
                    rows = execute_query(args.get("sql", "SELECT 1"))
                    content = json.dumps(rows[:50])
                except Exception as e:
                    content = f"Query error: {e}"
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": content,
                })

        if chart_args:
            sql = chart_args.get("sql", "")
            raw_type = chart_args.get("chart_type", "bar").lower()
            if "pie" in raw_type:
                chart_type = "pie"
            elif "line" in raw_type:
                chart_type = "line"
            elif "area" in raw_type:
                chart_type = "area"
            elif "kpi" in raw_type:
                chart_type = "kpi"
            else:
                chart_type = "bar"
                
            try:
                rows = execute_query(sql)
                data = normalize_data(rows, chart_type)
            except Exception as e:
                return f"Chart query failed: {e}", None

            raw_color = chart_args.get("color_rules")
            color_rules = raw_color if isinstance(raw_color, dict) and raw_color else None

            return chart_args.get("answer", "Here is your chart."), {
                "type": chart_type,
                "title": chart_args.get("title", ""),
                "data": data,
                "sql": sql,
                "explanation": chart_args.get("explanation"),
                "color_rules": color_rules,
                "palette": chart_args.get("palette"),
            }

        messages.extend(tool_results)

    return "Could not generate a chart for this query. Please try rephrasing.", None
