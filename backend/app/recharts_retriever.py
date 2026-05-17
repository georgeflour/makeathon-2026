"""
recharts_retriever.py
=====================
Runtime module — loaded by langgraph_agent.py.
Queries the Supabase `recharts_docs` table using pgvector cosine similarity.

The table must exist and be populated by build_recharts_rag.py first.
"""

from __future__ import annotations

from functools import lru_cache

from openai import AzureOpenAI
from supabase import create_client, Client

from app.config import settings

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
TABLE_NAME      = "recharts_docs"
EMBEDDING_MODEL = settings.AZURE_EMBEDDING_DEPLOYMENT_NAME or "text-embedding-3-small"

# Per chart_hint — source path fragments to prioritise when re-ranking results.
# These map to actual file paths inside the recharts/recharts repo.
_HINT_PRIORITY_PATHS: dict[str, list[str]] = {
    "bar":        ["BarChart", "Bar.tsx", "Bar.ts", "storybook/stories/Bar"],
    "line":       ["LineChart", "Line.tsx", "Line.ts", "storybook/stories/Line"],
    "area":       ["AreaChart", "Area.tsx", "Area.ts", "storybook/stories/Area"],
    "pie":        ["PieChart", "Pie.tsx", "Pie.ts", "storybook/stories/Pie"],
    "donut":      ["PieChart", "Pie.tsx", "storybook/stories/Pie"],
    "scatter":    ["ScatterChart", "Scatter.tsx", "storybook/stories/Scatter"],
    "heatmap":    ["CartesianGrid", "Cell.tsx", "storybook/stories/Scatter"],
    "kpi":        ["Text.tsx", "Label.tsx"],
    "stacked_bar":["BarChart", "Bar.tsx", "storybook/stories/Bar"],
    "grouped_bar":["BarChart", "Bar.tsx", "storybook/stories/Bar"],
    "stacked_area":["AreaChart", "Area.tsx", "storybook/stories/Area"],
    "radar":      ["RadarChart", "Radar.tsx", "storybook/stories/Radar"],
    "radial":     ["RadialBarChart", "RadialBar.tsx"],
    "funnel":     ["FunnelChart", "Funnel.tsx"],
    "errorbar":   ["ErrorBar.tsx", "ComposedChart"],
    "boxplot":    ["ComposedChart", "ErrorBar.tsx"],
    "composed":   ["ComposedChart"],
}


# ---------------------------------------------------------------------------
# Lazy singletons
# ---------------------------------------------------------------------------
@lru_cache(maxsize=1)
def _sb() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


@lru_cache(maxsize=1)
def _oai() -> AzureOpenAI:
    return AzureOpenAI(
        azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
        api_key=settings.AZURE_OPENAI_API_KEY,
        api_version="2024-02-15-preview",
    )


def _embed(text: str) -> list[float]:
    resp = _oai().embeddings.create(model=EMBEDDING_MODEL, input=[text])
    return resp.data[0].embedding


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def retrieve_recharts_docs(
    query:      str,
    chart_hint: str = "bar",
    k:          int = 5,
    k_fetch:    int = 20,
) -> str:
    """
    Embed the query, run cosine similarity search in Supabase,
    re-rank by chart_hint relevance, return top-k chunks as a string.

    Returns empty string on any failure (graceful degradation).
    """
    try:
        query_embedding = _embed(query)
    except Exception as e:
        print(f"[recharts_retriever] Embedding failed: {e}")
        return ""

    try:
        result = _sb().rpc(
            "match_recharts_docs",
            {
                "query_embedding": query_embedding,
                "match_count":     k_fetch,
            }
        ).execute()
        rows = result.data or []
    except Exception as e:
        print(f"[recharts_retriever] Supabase query failed: {e}")
        return ""

    if not rows:
        return ""

    # Re-rank: priority paths for this chart type float to the top
    priority = _HINT_PRIORITY_PATHS.get(chart_hint, [])

    def _rank(row: dict) -> int:
        src = row.get("source", "")
        return 0 if any(p in src for p in priority) else 1

    rows.sort(key=_rank)
    top = rows[:k]

    sections = []
    for row in top:
        src   = row.get("source", "unknown")
        text  = row.get("content", "").strip()
        score = row.get("similarity", 0)
        sections.append(f"### [{src}] (similarity: {score:.2f})\n{text}")

    return "\n\n---\n\n".join(sections)


def is_built() -> bool:
    """Return True if the recharts_docs table exists and has rows."""
    try:
        result = _sb().table(TABLE_NAME).select("id").limit(1).execute()
        return bool(result.data)
    except Exception:
        return False