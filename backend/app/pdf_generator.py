"""
pdf_generator.py
================
Generates a styled PDF report from saved widgets.

Structure:
  Page 1  - Cover: header, KPI cards (2x2 grid)
  Page N  - One chart per widget with indigo header strip + footer
"""

from __future__ import annotations

import io
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from fpdf import FPDF

from app.query_engine import execute_query

# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------
INDIGO      = (79,  70,  229)
INDIGO_DARK = (55,  48,  163)
DARK        = (17,  24,   39)
MID         = (107, 114, 128)
LIGHT_GRAY  = (229, 231, 235)
OFF_WHITE   = (248, 250, 252)
WHITE       = (255, 255, 255)

KPI_ACCENTS = [
    (79,  70,  229),   # indigo  — containment
    (16,  185, 129),   # emerald — csat
    (245, 158,  11),   # amber   — aht
    (239,  68,  68),   # rose    — escalation
]

# ---------------------------------------------------------------------------
# Unicode font detection
# ---------------------------------------------------------------------------
_FONT_CANDIDATES = [
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
     "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "DejaVu"),
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf", "Arial"),
]

def _setup_fonts(pdf: FPDF) -> str:
    for regular, bold, family in _FONT_CANDIDATES:
        if os.path.exists(regular) and os.path.exists(bold):
            pdf.add_font(family, "",  regular)
            pdf.add_font(family, "B", bold)
            return family
    return "Helvetica"


# ---------------------------------------------------------------------------
# KPI query
# ---------------------------------------------------------------------------
def _fetch_kpis() -> dict[str, float]:
    sql = """
        SELECT
            AVG(CASE WHEN call_successful = 'success' THEN 1.0 ELSE 0.0 END) AS containment_rate,
            AVG(csat_score) FILTER (WHERE csat_score IS NOT NULL)             AS csat,
            AVG(call_duration_secs)                                            AS aht,
            AVG(CASE WHEN call_successful = 'unknown' THEN 1.0 ELSE 0.0 END)  AS escalation_rate
        FROM conversations
    """
    try:
        rows = execute_query(sql)
        if rows:
            r = rows[0]
            return {
                "containment_rate": float(r.get("containment_rate") or 0),
                "csat":             float(r.get("csat") or 0),
                "aht":              float(r.get("aht") or 0),
                "escalation_rate":  float(r.get("escalation_rate") or 0),
            }
    except Exception as e:
        print(f"[pdf_generator] KPI query failed: {e}")
    return {"containment_rate": 0, "csat": 0, "aht": 0, "escalation_rate": 0}


# ---------------------------------------------------------------------------
# Chart rendering
# ---------------------------------------------------------------------------
def _chart_to_png(data: Any, chart_type: str, title: str) -> bytes | None:
    try:
        fig, ax = plt.subplots(figsize=(9, 3.4))
        fig.patch.set_facecolor("#ffffff")
        ax.set_facecolor("#fafafa")
        ax.spines[["top", "right"]].set_visible(False)
        ax.spines[["left", "bottom"]].set_color("#e5e7eb")
        ax.tick_params(colors="#6b7280", labelsize=8)
        ax.yaxis.set_tick_params(length=0)
        ax.xaxis.set_tick_params(length=0)
        ax.grid(axis="y", color="#f3f4f6", linewidth=0.8, zorder=0)

        BLUE = "#4f46e5"
        ct = (chart_type or "bar").lower()

        if ct == "kpi":
            value = float(data) if not isinstance(data, dict) else float(data.get("value", 0))
            display = f"{value * 100:.1f}%" if 0 < value < 1 else f"{value:,.2f}"
            ax.text(0.5, 0.5, display, ha="center", va="center",
                    fontsize=52, fontweight="bold", color=BLUE, transform=ax.transAxes)
            ax.axis("off")

        elif ct in ("pie", "donut"):
            if isinstance(data, list) and data:
                labels = [str(r.get("label", "")) for r in data]
                values = [float(r.get("value", 0)) for r in data]
                colors = ["#4f46e5", "#818cf8", "#6366f1", "#a5b4fc", "#c7d2fe"]
                wedges, texts, autotexts = ax.pie(
                    values, labels=labels, autopct="%1.1f%%",
                    startangle=90, colors=colors[:len(values)],
                    wedgeprops={"linewidth": 1, "edgecolor": "white"},
                )
                for t in autotexts:
                    t.set_fontsize(8)
                ax.axis("equal")

        elif ct in ("line", "area"):
            if isinstance(data, list) and data:
                xs = list(range(len(data)))
                ys = [float(r.get("value", 0)) for r in data]
                labels = [str(r.get("label", i)) for i, r in enumerate(data)]
                ax.plot(xs, ys, color=BLUE, linewidth=2.5, marker="o",
                        markersize=5, markerfacecolor="white", markeredgewidth=2)
                if ct == "area":
                    ax.fill_between(xs, ys, alpha=0.12, color=BLUE)
                step = max(1, len(labels) // 10)
                ax.set_xticks(xs[::step])
                ax.set_xticklabels(labels[::step], rotation=30, ha="right", fontsize=8)
                ax.yaxis.set_major_formatter(plt.FuncFormatter(
                    lambda v, _: f"{v*100:.0f}%" if 0 < v < 1 else f"{v:,.0f}"))

        else:  # bar
            if isinstance(data, list) and data:
                labels = [str(r.get("label", "")) for r in data]
                values = [float(r.get("value", 0)) for r in data]
                bars = ax.bar(range(len(labels)), values, color=BLUE,
                              alpha=0.88, width=0.55, zorder=3)
                ax.set_xticks(range(len(labels)))
                ax.set_xticklabels(labels, rotation=30, ha="right", fontsize=8)
                ax.yaxis.set_major_formatter(plt.FuncFormatter(
                    lambda v, _: f"{v*100:.0f}%" if 0 < v < 1 else f"{v:,.0f}"))
                for bar, val in zip(bars, values):
                    lbl = f"{val*100:.1f}%" if 0 < val < 1 else f"{val:,.1f}"
                    ax.text(bar.get_x() + bar.get_width() / 2,
                            bar.get_height() + max(values) * 0.01,
                            lbl, ha="center", va="bottom", fontsize=7.5,
                            color="#374151", fontweight="bold")

        plt.tight_layout(pad=1.5)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=160, bbox_inches="tight",
                    facecolor="#ffffff")
        plt.close(fig)
        buf.seek(0)
        return buf.read()

    except Exception as e:
        print(f"[pdf_generator] chart render failed ({chart_type}): {e}")
        plt.close("all")
        return None


# ---------------------------------------------------------------------------
# Footer helper
# ---------------------------------------------------------------------------
def _footer(pdf: FPDF, font: str, page_num: int, total: int, report_name: str) -> None:
    pdf.set_draw_color(*LIGHT_GRAY)
    pdf.set_line_width(0.2)
    pdf.line(15, 285, 195, 285)
    pdf.set_font(font, "", 7)
    pdf.set_text_color(*MID)
    pdf.set_xy(15, 287)
    pdf.cell(90, 4, report_name, ln=False)
    pdf.set_xy(15, 287)
    pdf.cell(180, 4, f"Page {page_num} of {total}", align="R", ln=True)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
def generate_pdf(schedule_name: str, frequency: str, widgets: list[dict]) -> bytes:
    days = 7 if frequency == "weekly" else 1
    period_end = date.today()
    period_start = period_end - timedelta(days=days)
    kpis = _fetch_kpis()

    # Count renderable widgets
    total_pages = 1 + len(widgets)

    pdf = FPDF()
    font = _setup_fonts(pdf)
    pdf.set_auto_page_break(auto=False)

    # ── COVER PAGE ────────────────────────────────────────────────────────────
    pdf.add_page()

    # Indigo header block
    pdf.set_fill_color(*INDIGO)
    pdf.rect(0, 0, 210, 60, "F")

    # Subtle darker accent strip at the very top
    pdf.set_fill_color(*INDIGO_DARK)
    pdf.rect(0, 0, 210, 3, "F")

    # Frequency badge
    pdf.set_font(font, "B", 7)
    pdf.set_text_color(*WHITE)
    badge = "WEEKLY REPORT" if frequency == "weekly" else "DAILY REPORT"
    pdf.set_xy(15, 13)
    pdf.set_fill_color(255, 255, 255)
    # Draw badge manually
    pdf.set_draw_color(*WHITE)
    badge_w = pdf.get_string_width(badge) + 8
    pdf.rect(15, 12, badge_w, 7, "D")
    pdf.set_xy(15 + 4, 14)
    pdf.cell(badge_w - 8, 5, badge, ln=False)

    # Report name
    pdf.set_font(font, "B", 20)
    pdf.set_text_color(*WHITE)
    pdf.set_xy(15, 24)
    pdf.cell(180, 10, schedule_name, ln=True)

    # Period & generated time
    pdf.set_font(font, "", 9)
    pdf.set_text_color(200, 205, 240)
    pdf.set_xy(15, 37)
    period_str = (f"{period_start.strftime('%d %b %Y')} - "
                  f"{period_end.strftime('%d %b %Y')}")
    pdf.cell(0, 5, period_str, ln=True)

    now_str = datetime.now(timezone.utc).strftime("Generated %d %b %Y at %H:%M UTC")
    pdf.set_font(font, "", 8)
    pdf.set_text_color(160, 165, 210)
    pdf.set_xy(15, 44)
    pdf.cell(0, 5, now_str, ln=True)

    # ── KPI SECTION ──────────────────────────────────────────────────────────
    pdf.set_text_color(*DARK)
    pdf.set_font(font, "B", 11)
    pdf.set_xy(15, 72)
    pdf.cell(0, 6, "Key Performance Indicators", ln=True)

    pdf.set_draw_color(*INDIGO)
    pdf.set_line_width(0.6)
    pdf.line(15, 80, 195, 80)

    kpi_items = [
        ("Containment Rate", f"{kpis['containment_rate']*100:.1f}%",  KPI_ACCENTS[0]),
        ("CSAT Score",       f"{kpis['csat']:.2f} / 5",               KPI_ACCENTS[1]),
        ("Avg Handle Time",  f"{kpis['aht']:.0f} sec",                KPI_ACCENTS[2]),
        ("Escalation Rate",  f"{kpis['escalation_rate']*100:.1f}%",   KPI_ACCENTS[3]),
    ]

    card_w, card_h = 85, 32
    gap = 10
    xs = [15, 15 + card_w + gap]
    ys = [86, 86 + card_h + 8]

    for i, (lbl, val, accent) in enumerate(kpi_items):
        cx = xs[i % 2]
        cy = ys[i // 2]

        # Card fill + border
        pdf.set_fill_color(*OFF_WHITE)
        pdf.set_draw_color(*LIGHT_GRAY)
        pdf.set_line_width(0.25)
        pdf.rect(cx, cy, card_w, card_h, "FD")

        # Colored left accent
        pdf.set_fill_color(*accent)
        pdf.rect(cx, cy, 4, card_h, "F")

        # Label
        pdf.set_font(font, "", 8)
        pdf.set_text_color(*MID)
        pdf.set_xy(cx + 9, cy + 6)
        pdf.cell(card_w - 11, 5, lbl, ln=True)

        # Value
        pdf.set_font(font, "B", 19)
        pdf.set_text_color(*accent)
        pdf.set_xy(cx + 9, cy + 13)
        pdf.cell(card_w - 11, 14, val, ln=True)

    # Summary line
    y_end = ys[1] + card_h + 10
    pdf.set_draw_color(*LIGHT_GRAY)
    pdf.set_line_width(0.2)
    pdf.line(15, y_end, 195, y_end)

    pdf.set_font(font, "", 9)
    pdf.set_text_color(*MID)
    pdf.set_xy(15, y_end + 5)
    n = len(widgets)
    pdf.cell(0, 5, f"This report includes {n} chart{'s' if n != 1 else ''}.", ln=True)

    _footer(pdf, font, 1, total_pages, schedule_name)

    # ── CHART PAGES (2 per page) ──────────────────────────────────────────────
    # Pre-render all charts
    rendered: list[tuple[str, bytes]] = []
    for widget in widgets:
        chart       = widget.get("chart", {})
        chart_type  = chart.get("type", "bar")
        chart_title = chart.get("title") or widget.get("name", "Chart")
        sql         = chart.get("sql", "")
        data        = chart.get("data")

        if sql:
            try:
                rows = execute_query(sql)
                from app.query_engine import normalize_data
                data = normalize_data(rows, chart_type)
            except Exception as e:
                print(f"[pdf_generator] widget query failed: {e}")

        png = _chart_to_png(data, chart_type, chart_title)
        if png:
            rendered.append((chart_title, png))

    # Recalculate total pages: 1 cover + ceil(charts / 2)
    import math
    total_pages = 1 + math.ceil(len(rendered) / 2) if rendered else 1

    # Positions for top and bottom chart slots on a page
    SLOTS = [
        {"title_y": 16, "line_y": 26, "img_y": 30},
        {"title_y": 154, "line_y": 164, "img_y": 168},
    ]
    DIVIDER_Y = 148  # separator between the two slots

    page_idx = 2
    for i in range(0, len(rendered), 2):
        pair = rendered[i : i + 2]
        pdf.add_page()

        # Thin indigo top strip
        pdf.set_fill_color(*INDIGO)
        pdf.rect(0, 0, 210, 8, "F")

        for slot_num, (chart_title, png) in enumerate(pair):
            slot = SLOTS[slot_num]

            # Divider between the two charts
            if slot_num == 1:
                pdf.set_draw_color(*LIGHT_GRAY)
                pdf.set_line_width(0.3)
                pdf.line(15, DIVIDER_Y, 195, DIVIDER_Y)

            # Chart title
            pdf.set_text_color(*DARK)
            pdf.set_font(font, "B", 11)
            pdf.set_xy(15, slot["title_y"])
            pdf.cell(0, 8, chart_title, ln=True)

            # Accent line
            pdf.set_draw_color(*INDIGO)
            pdf.set_line_width(0.4)
            pdf.line(15, slot["line_y"], 195, slot["line_y"])

            # Chart image
            img_buf = io.BytesIO(png)
            pdf.image(img_buf, x=15, y=slot["img_y"], w=180)

        _footer(pdf, font, page_idx, total_pages, schedule_name)
        page_idx += 1

    return bytes(pdf.output())
