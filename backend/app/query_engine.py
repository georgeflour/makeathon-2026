import psycopg2
import psycopg2.extras
from app.config import settings


def execute_query(sql: str) -> list[dict]:
    stripped = sql.strip().upper().lstrip("(")
    if not (stripped.startswith("SELECT") or stripped.startswith("WITH")):
        raise ValueError("Only SELECT queries are allowed")

    con = psycopg2.connect(settings.SUPABASE_DB_URL)
    try:
        with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql)
            return [dict(row) for row in cur.fetchall()]
    finally:
        con.close()


def normalize_data(rows: list[dict], chart_type: str):
    if not rows:
        return []

    keys = list(rows[0].keys())

    if chart_type == "kpi":
        val = list(rows[0].values())[0]
        return {"value": round(float(val), 4) if val is not None else 0}

    if chart_type in ("line", "area"):
        x_key = keys[0]
        y_key = keys[1] if len(keys) > 1 else keys[0]
        return [{"x": str(row[x_key]), "y": _to_float(row[y_key])} for row in rows]

    # bar, pie
    label_key = keys[0]
    value_key = keys[1] if len(keys) > 1 else keys[0]
    return [{"label": str(row[label_key]), "value": _to_float(row[value_key])} for row in rows]


def _to_float(v) -> float:
    if v is None:
        return 0.0
    try:
        return round(float(v), 4)
    except (TypeError, ValueError):
        return 0.0
