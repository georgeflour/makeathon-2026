import json
from pathlib import Path

from openai import AzureOpenAI

from app.config import settings
from app.query_engine import execute_query, normalize_data

_visuals_dir = Path(__file__).parent.parent.parent / "visuals"
_CHARTS = (_visuals_dir / "charts.json").read_text(encoding="utf-8")
_PALLETS = (_visuals_dir / "pallets.json").read_text(encoding="utf-8")
_PROMPT = (_visuals_dir / "prompt.txt").read_text(encoding="utf-8")
_data_dir = Path(__file__).parent / "data"
_METRICS = (_data_dir / "metrics_dictionary.md").read_text(encoding="utf-8")

# Inline schema με τα σωστά table names (αντί για schema.md που έχει λάθος v_* ονόματα)
_SCHEMA = """\
Tables in PostgreSQL (Supabase):

conversations: conversation_id(PK), agent_id, agent_name, user_id, status, start_time, start_date, start_hour, start_dow, call_duration_secs, cost_amount, cost_currency, call_direction, from_number, termination_reason, bot_version, transcript_summary, call_successful(success/failure/unknown), main_language(el/en), dv_user_id, segment(new/returning/premium/business), region(attica/thessaloniki/crete/patras/larissa/other_gr/international), preferred_language, channel_origin, csat_score(1-5 nullable), csat_collected(bool), outcome(resolved/escalated/abandoned/timeout)

turns: id, conversation_id(FK), start_time, agent_id, main_language, role(agent/user), time_in_call_secs, message, detected_intent, intent_confidence, sentiment(positive/neutral/negative), turn_number, tool_calls_count

evaluations: id, conversation_id(FK), start_time, agent_id, bot_version, main_language, segment, region, criterion_id(authentication_completed/intent_resolved/escalation_triggered/compliance_disclaimer_given/pii_handled_safely/fallback_count_acceptable/language_consistency/tool_call_success_rate), result(success/failure/unknown), rationale

data_collection: id, conversation_id(FK), start_time, agent_id, bot_version, main_language, segment, region, field_id(customer_segment/region/declared_language/caller_line_type/account_type_referenced/transfer_amount_bucket/transfer_destination_country/card_type_referenced/loan_type_inquired/auth_method_used/self_service_completed/promised_callback/complaint_detected/topic_tags), value(text), rationale

tool_calls: id, conversation_id(FK), start_time, agent_id, main_language, time_in_call_secs, tool_name, success(bool), latency_ms\
"""

# ORIGINAL PROMPT (full, ~22k tokens) — για σύγκριση performance
SYSTEM_PROMPT = (
    "You are NR2Dashboard, a data analyst AI for SmartRep's banking voicebot analytics platform.\n"
    "You have access to a PostgreSQL database (Supabase) with ~10,000 banking voicebot conversations over 90 days (Greek & English).\n\n"
    "== TOOLS ==\n"
    "- run_query(sql): Execute a PostgreSQL SQL SELECT query. Returns rows as JSON. Always use this to verify SQL first.\n"
    "- render_chart(...): Your FINAL step — always end by calling this, never return plain text.\n\n"
    "== SQL RULES ==\n"
    "- Use ONLY these tables: conversations, turns, evaluations, data_collection, tool_calls\n"
    "- DO NOT use conversations_raw, v_conversations, v_turns, or any other name\n"
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

    has_query_result = False

    for _ in range(4):
        tool_choice = (
            {"type": "function", "function": {"name": "render_chart"}}
            if has_query_result
            else "required"
        )
        try:
            response = openai_client.chat.completions.create(
                model=settings.AZURE_DEPLOYMENT_NAME,
                messages=messages,
                tools=TOOLS,
                tool_choice=tool_choice,
            )
        except Exception as e:
            return f"LLM error: {e}", None

        msg = response.choices[0].message
        print(f"[agent] tool_calls: {[tc.function.name for tc in (msg.tool_calls or [])]}")

        if not msg.tool_calls:
            print(f"[agent] no tool_calls, content: {msg.content}")
            return msg.content or "No response generated.", None

        messages.append(msg)

        chart_args = None
        tool_results = []

        for tc in msg.tool_calls:
            try:
                args = json.loads(tc.function.arguments)
            except json.JSONDecodeError:
                args = {}

            print(f"[agent] calling {tc.function.name} args={str(args)[:200]}")

            if tc.function.name == "render_chart":
                chart_args = args
            elif tc.function.name == "run_query":
                try:
                    rows = execute_query(args.get("sql", "SELECT 1"))
                    print(f"[agent] query ok, {len(rows)} rows")
                    content = json.dumps(rows[:50], default=str)
                    has_query_result = True
                except Exception as e:
                    print(f"[agent] query error: {e}")
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
