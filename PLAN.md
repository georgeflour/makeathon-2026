# NR2Dashboard — Hackathon Plan

## The Challenge (SmartRep x Uni AI)

Build a system that turns natural-language questions into dashboard components, powered by a fixed pre-built dataset of ~10K banking voicebot conversations.

**Flow:** NL question → SQL on `conversations.duckdb` → chart

The dataset is immutable. Every team uses the same file. There is no file upload.

---

## Step 0 — Get the Data

The `makeathon-NR2Dashboard` submodule is empty because `.gitmodules` is missing. Clone it directly:

```powershell
git clone https://github.com/SmartRepOrg/makeathon-NR2Dashboard
```

Then read these two files carefully — they go into the LLM system prompt:
- `data/schema.md` — column dictionary for all DuckDB views
- `data/metrics_dictionary.md` — canonical definitions for Containment Rate, CSAT, AHT, etc.

---

## What to Use: DuckDB, not JSONL

Use `conversations.duckdb` exclusively. It has flat SQL-ready views pre-built. The `conversations.jsonl` is the same data as raw nested JSON — skip it entirely.

---

## Architecture: SQL + Chart Inference

The LLM receives a natural-language question and returns structured JSON. The backend executes the SQL. The frontend renders the chart.

```
User types NL question
    → LLM receives: question + schema.md + metrics_dictionary.md
    → LLM returns: { sql, chart_type, title, color_rules }
    → Backend runs SQL on conversations.duckdb (DuckDB Python lib)
    → Returns { data[], chart_type, title } to frontend
    → Recharts renders the chart
```

### Why not the other architectures

| Architecture | Verdict |
|---|---|
| Tool-Calling | Requires defining every chart as an MCP tool — more setup, less flexible |
| Spec Generation (Vega-Lite) | Extra frontend lib, slower to ship |
| SQL + Chart Inference | Pairs naturally with DuckDB, clean JSON contract — **use this** |
| Code Generation | Biggest blast radius, risky in 1 day |

---

## What to Build vs Skip

### Strip from todos.md — no longer needed
- `POST /api/upload` — there is no upload
- CSV/JSON parsing with pandas — data is already in DuckDB
- In-memory session store — one static DuckDB file, read-only
- Dataset switcher dropdown — single fixed dataset

### Build instead
- LLM prompt: NL → `{ sql, chart_type, title, color_rules }`
- `execute_query(sql)` on `conversations.duckdb`
- MCP tools: `run_query(sql)`, `get_schema()`, `get_metrics()`
- `ChartPanel` component (bar, line, pie — switch on `chart_type`)
- Chat interface where judges type queries and see charts inline

---

## 1-Day Build Order

| Hours | Who | What |
|-------|-----|-------|
| H1 | Everyone | Clone data repo, read `schema.md` + `metrics_dictionary.md`, understand the views |
| H1–3 | P1 | LLM system prompt + NL → `{sql, chart_type, title}` loop. This is the core. |
| H1–3 | P2 | `execute_query(sql)` against `conversations.duckdb`, wire into `/api/chat` |
| H3–5 | P3 | `ChartPanel` with Recharts (bar, line, pie) — stub with mock data first |
| H5–6 | All | Connect end-to-end: real query → real data → real chart |
| H7 | P4 | Bundle DuckDB file into Docker image, deploy backend + frontend |
| H8 | All | Demo rehearsal: Greek query, English query, follow-up question |

---

## LLM System Prompt (core of the whole thing)

The system prompt must include the full contents of `schema.md` and `metrics_dictionary.md` so the model knows exact column names, metric formulas, and thresholds.

Minimum response shape to parse:

```json
{
  "sql": "SELECT intent, AVG(containment) FROM convos GROUP BY intent",
  "chart_type": "bar",
  "title": "Containment Rate by Intent",
  "color_rules": { "threshold": 0.85, "above": "purple", "below": "orange" }
}
```

The 85% containment rate threshold (purple = above, orange = below) is a SmartRep-specific detail from the challenge — make sure it's in the prompt.

---

## Deployment

### Backend — Azure Container Apps

Bundle `conversations.duckdb` directly into the Docker image. No blob storage, no server, no auth needed for the data file.

```dockerfile
# Add to existing Dockerfile
COPY makeathon-NR2Dashboard/conversations.duckdb /app/data/conversations.duckdb
```

```powershell
az acr build --registry makeathon2026acr --image backend:latest .

az containerapp create `
  --name makeathon-backend `
  --resource-group <rg> `
  --image makeathon2026acr.azurecr.io/backend:latest `
  --min-replicas 1 `
  --target-port 8000 `
  --ingress external `
  --env-vars SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... AZURE_AI_PROJECT_ENDPOINT=... AZURE_AGENT_ID=... AZURE_AGENT_VERSION=...
```

`--min-replicas 1` is important — prevents cold-start restarts mid-demo.

### Frontend — Vercel

Root directory: `frontend`
Env var: `NEXT_PUBLIC_API_URL` = deployed Azure Container App URL

Push to GitHub → Vercel auto-deploys.

---

## Rules & Constraints (from SmartRep)

| Allowed | Not Allowed |
|---|---|
| Use dataset as-is | Hard-coded lookup tables (`if query contains X → return Y`) |
| Metric definitions from `metrics_dictionary.md` | Modifying or regenerating the dataset |
| Pretrained & API-served LLMs | Bringing in external data sources |
| Pre-trained NL-to-SQL adapters | |

---

## Demo Script (5 min)

1. Open the live URL
2. Type: *"Show me containment rate by intent type this week"* → bar chart with 85% threshold coloring
3. Follow-up: *"Now show only the intents below the threshold"* → conversation context kicks in
4. Type in Greek: *"Δείξε μου πίτα γράφημα Ελληνόφωνων vs Αγγλόφωνων χρηστών"* → pie chart
5. Type: *"How is AHT trending over the last 30 days?"* → line chart

The judges should be able to type their own queries live.
