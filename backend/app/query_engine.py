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


# ---------------------------------------------------------------------------
# normalize_data
# ---------------------------------------------------------------------------
# Converts raw SQL rows into the shape each chart type expects.
# The frontend reads these shapes directly to render with Vega-Lite.
#
# Supported chart_type values and their expected SQL column contracts:
#
#   bar / pie / line / area / tick / spiral
#       2 cols: label (TEXT) first, value (NUMERIC) second
#       → [{"label": str, "value": float}, ...]
#
#   stacked_bar / stacked_area / grouped_bar
#       3 cols: label (TEXT), group (TEXT), value (NUMERIC)
#       → [{"label": str, "group": str, "value": float}, ...]
#
#   scatter / bubble (2-var)
#       2 cols aliased x_value, y_value (both NUMERIC)
#       → [{"x": float, "y": float}, ...]
#
#   bubble (3-var)
#       3 cols: x_value (NUMERIC), y_value (NUMERIC), size_value (NUMERIC)
#       → [{"x": float, "y": float, "size": float}, ...]
#
#   heatmap / calendar / rect
#       3 cols: row_label (TEXT), col_label (TEXT), value (NUMERIC)
#       → [{"row": str, "col": str, "value": float}, ...]
#
#   kpi
#       1 col, 1 row (single NUMERIC)
#       → float
#
#   boxplot
#       cols: label (TEXT), min, q1, median, q3, max (all NUMERIC)
#       → [{"label": str, "min": float, "q1": float, "median": float, "q3": float, "max": float}, ...]
#
#   errorbar
#       cols: label (TEXT), value (NUMERIC), error_lower (NUMERIC), error_upper (NUMERIC)
#       → [{"label": str, "value": float, "lower": float, "upper": float}, ...]
#
#   candlestick / rule_bar
#       cols: date (TEXT), open (NUMERIC), close (NUMERIC), high (NUMERIC), low (NUMERIC)
#       → [{"date": str, "open": float, "close": float, "high": float, "low": float}, ...]
#
#   donut / arc / sunburst / radial
#       2 cols: label (TEXT), value (NUMERIC)  — same as pie
#       → [{"label": str, "value": float}, ...]
#
#   text / wordcloud
#       2 cols: word/label (TEXT), frequency/value (NUMERIC)
#       → [{"label": str, "value": float}, ...]
#
# ---------------------------------------------------------------------------

def normalize_data(rows: list[dict], chart_type: str):
    if not rows:
        return []

    keys = list(rows[0].keys())
    ct   = chart_type.lower().strip()

    # ------------------------------------------------------------------
    # KPI — single number
    # ------------------------------------------------------------------
    if ct == "kpi":
        return _to_float(list(rows[0].values())[0])

    # ------------------------------------------------------------------
    # SCATTER / BUBBLE (2-var)
    # ------------------------------------------------------------------
    if ct in ("scatter", "bubble") and len(keys) == 2:
        result = []
        for row in rows:
            vals = list(row.values())
            x = row.get("x_value") or row.get("x") or (vals[0] if len(vals) >= 2 else None)
            y = row.get("y_value") or row.get("y") or (vals[1] if len(vals) >= 2 else None)
            if x is not None and y is not None:
                try:
                    result.append({"x": float(x), "y": float(y)})
                except (TypeError, ValueError):
                    pass
        return result

    # ------------------------------------------------------------------
    # BUBBLE (3-var: x, y, size)
    # ------------------------------------------------------------------
    if ct == "bubble" and len(keys) >= 3:
        result = []
        for row in rows:
            vals = list(row.values())
            x    = row.get("x_value") or (vals[0] if len(vals) >= 3 else None)
            y    = row.get("y_value") or (vals[1] if len(vals) >= 3 else None)
            size = row.get("size_value") or (vals[2] if len(vals) >= 3 else None)
            if x is not None and y is not None:
                result.append({"x": _to_float(x), "y": _to_float(y), "size": _to_float(size)})
        return result

    # ------------------------------------------------------------------
    # HEATMAP / CALENDAR / RECT — 3 cols: row, col, value
    # ------------------------------------------------------------------
    if ct in ("heatmap", "calendar", "rect") and len(keys) >= 3:
        return [
            {
                "row":   str(row[keys[0]]),
                "col":   str(row[keys[1]]),
                "value": _to_float(row[keys[2]]),
            }
            for row in rows
        ]

    # ------------------------------------------------------------------
    # BOXPLOT — label + 5-number summary
    # ------------------------------------------------------------------
    if ct == "boxplot":
        result = []
        for row in rows:
            vals = list(row.values())
            result.append({
                "label":  str(vals[0]) if len(vals) > 0 else "",
                "min":    _to_float(row.get("min")    or row.get("min_val")    or (vals[1] if len(vals) > 1 else 0)),
                "q1":     _to_float(row.get("q1")     or row.get("q1_val")     or (vals[2] if len(vals) > 2 else 0)),
                "median": _to_float(row.get("median")  or row.get("median_val") or (vals[3] if len(vals) > 3 else 0)),
                "q3":     _to_float(row.get("q3")     or row.get("q3_val")     or (vals[4] if len(vals) > 4 else 0)),
                "max":    _to_float(row.get("max")     or row.get("max_val")    or (vals[5] if len(vals) > 5 else 0)),
            })
        return result

    # ------------------------------------------------------------------
    # ERROR BAR — label, value, lower error, upper error
    # ------------------------------------------------------------------
    if ct == "errorbar":
        result = []
        for row in rows:
            vals = list(row.values())
            result.append({
                "label": str(vals[0]) if len(vals) > 0 else "",
                "value": _to_float(row.get("value") or (vals[1] if len(vals) > 1 else 0)),
                "lower": _to_float(row.get("error_lower") or row.get("lower") or (vals[2] if len(vals) > 2 else 0)),
                "upper": _to_float(row.get("error_upper") or row.get("upper") or (vals[3] if len(vals) > 3 else 0)),
            })
        return result

    # ------------------------------------------------------------------
    # CANDLESTICK / OHLC — date, open, close, high, low
    # ------------------------------------------------------------------
    if ct in ("candlestick", "rule_bar", "ohlc"):
        result = []
        for row in rows:
            vals = list(row.values())
            result.append({
                "date":  str(vals[0]) if len(vals) > 0 else "",
                "open":  _to_float(row.get("open")  or (vals[1] if len(vals) > 1 else 0)),
                "close": _to_float(row.get("close") or (vals[2] if len(vals) > 2 else 0)),
                "high":  _to_float(row.get("high")  or (vals[3] if len(vals) > 3 else 0)),
                "low":   _to_float(row.get("low")   or (vals[4] if len(vals) > 4 else 0)),
            })
        return result

    # ------------------------------------------------------------------
    # STACKED BAR / STACKED AREA / GROUPED BAR — label, group, value
    # ------------------------------------------------------------------
    if ct in ("stacked_bar", "stacked_area", "grouped_bar", "multiset_bar") and len(keys) >= 3:
        return [
            {
                "label": str(row[keys[0]]),
                "group": str(row[keys[1]]),
                "value": _to_float(row[keys[2]]),
            }
            for row in rows
        ]

    # ------------------------------------------------------------------
    # SPAN / RANGE BAR — label, min, max
    # ------------------------------------------------------------------
    if ct in ("span", "range_bar") and len(keys) >= 3:
        return [
            {
                "label": str(row[keys[0]]),
                "min":   _to_float(row[keys[1]]),
                "max":   _to_float(row[keys[2]]),
            }
            for row in rows
        ]

    # ------------------------------------------------------------------
    # DEFAULT — bar, pie, line, area, donut, arc, text, tick, wordcloud,
    #           radial, sunburst, spiral, density, histogram, violin, etc.
    #           All use the simple 2-col contract: label + value
    # ------------------------------------------------------------------
    label_key = keys[0]
    value_key = keys[1] if len(keys) > 1 else keys[0]
    return [
        {"label": str(row[label_key]), "value": _to_float(row[value_key])}
        for row in rows
    ]


def _to_float(v) -> float:
    if v is None:
        return 0.0
    try:
        return round(float(v), 4)
    except (TypeError, ValueError):
        return 0.0