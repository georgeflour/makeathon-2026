# Hackathon TODOs — NR2Dashboard (SmartRep x Uni AI)

## Step 0 — Get the Data (do this first, everyone is blocked on it)

- [ ] Clone the data repo: `git clone https://github.com/SmartRepOrg/makeathon-NR2Dashboard`
- [ ] Read `data/schema.md` — memorize the view names and column names
- [ ] Read `data/metrics_dictionary.md` — understand Containment Rate, CSAT, AHT formulas and thresholds
- [ ] Verify `conversations.duckdb` opens: `python -c "import duckdb; print(duckdb.connect('conversations.duckdb').execute('SHOW TABLES').fetchall())"`

---

## Person 1 — AI & MCP Engineer
Files: `backend/app/azure_agent.py`, `backend/app/mcp_server.py` (new)

- [ ] Add `duckdb` and `fastmcp` to `requirements.txt`
- [ ] Create `backend/app/mcp_server.py` with tools:
  - [ ] `run_query(sql: str)` — executes SQL against `conversations.duckdb`, returns rows as JSON
  - [ ] `get_schema()` — returns full contents of `data/schema.md`
  - [ ] `get_metrics()` — returns full contents of `data/metrics_dictionary.md`
- [ ] Write the LLM system prompt — must include `schema.md` + `metrics_dictionary.md` contents, and instruct the model to always return:
  ```json
  { "sql": "...", "chart_type": "bar|line|pie|area", "title": "...", "color_rules": {} }
  ```
  Include the 85% containment rate threshold rule (purple = above, orange = below)
- [ ] Modify `azure_agent.py` to connect agent to MCP server
- [ ] Parse structured agent response into `{ answer, chart }` shape
- [ ] Pass full conversation history to the agent for follow-up questions
- [ ] Test with: "Show me containment rate by intent type this week" → valid SQL + chart type

---

## Person 2 — Data & Backend Engineer
Files: `backend/app/routes/chat.py`, `backend/app/models.py`, `backend/requirements.txt`

- [ ] Add `duckdb` to `requirements.txt`
- [ ] Add `backend/app/query_engine.py`:
  - [ ] `execute_query(sql: str) -> list[dict]` — opens `conversations.duckdb` (read-only), runs query, returns rows
  - [ ] Sanitize: reject any SQL that is not a SELECT statement
- [ ] Extend `ChatRequest` model: add `history: list[dict]` (role + content pairs)
- [ ] Extend `ChatResponse` model: add `chart: Optional[ChartSpec]`
  - [ ] Define `ChartSpec`: `{ type, title, data, color_rules }`
- [ ] Update `/api/chat` route: pass history to agent, execute the returned SQL, return `{ answer, chart }`
- [ ] Add `GET /api/schema` — returns schema.md content (useful for frontend debugging)
- [ ] Add `datasets` table to Supabase: `(id uuid, name text, columns jsonb, row_count int, created_at timestamp)` — register `conversations.duckdb` as the single dataset on startup

---

## Person 3 — Frontend Engineer
Files: `frontend/components/`, `frontend/lib/api.ts`, `frontend/app/page.tsx`

- [ ] Update `lib/api.ts`: `sendChatMessage` to include `history`, handle `{ answer, chart }` response shape
- [ ] Extend `ChatBox` to maintain and pass full conversation history on every send
- [ ] Add `ChartPanel` component using Recharts:
  - [ ] `BarChart` — with optional color rules (e.g. threshold-based coloring)
  - [ ] `LineChart`
  - [ ] `PieChart` / `DonutChart`
  - [ ] Switch on `chart.type` from API response
- [ ] Render `ChartPanel` inline in chat when `chart` is present in the response
- [ ] Update page title and description to reflect NR2Dashboard
- [ ] Update page layout: chat on left, chart panel on right (or chart below each message)
- [ ] Suggested queries shown on first load (e.g. "Show containment rate by intent", "AHT trend last 30 days")

---

## Person 4 — DevOps, Integration & Demo
Files: `backend/Dockerfile`, Azure portal, Supabase, Vercel

- [ ] Copy `conversations.duckdb` into `backend/` so it gets bundled in the Docker image
- [ ] Add to `Dockerfile`: `COPY conversations.duckdb /app/data/conversations.duckdb`
- [ ] Set env var `DUCKDB_PATH=/app/data/conversations.duckdb` in Container App
- [ ] Deploy backend to Azure Container Apps — **set `--min-replicas 1`** (prevents cold-start mid-demo)
- [ ] Deploy frontend to Vercel — set `NEXT_PUBLIC_API_URL` to the Container App URL
- [ ] First end-to-end integration test (hour 5–6): type NL query → get SQL → get chart
- [ ] Prepare 3 demo queries (see Demo Script below)
- [ ] Script the 5-minute demo narrative

---

## Build Order

| Hours | Who | What |
|-------|-----|-------|
| H1 | Everyone | Clone data repo, read schema + metrics docs |
| H1–3 | P1 | LLM prompt + NL → `{sql, chart_type, title}` loop |
| H1–3 | P2 | `execute_query()` + `/api/chat` extended response shape |
| H3–5 | P3 | `ChartPanel` with Recharts (stub with mock data first) |
| H1–2 | P4 | Bundle DuckDB in Dockerfile, set up Azure Container App |
| H5–6 | All | Connect end-to-end: real query → real SQL → real chart |
| H7 | All | Fix SQL errors, chart shape mismatches |
| H8 | P4 | Final deploy, smoke test on live URL, demo rehearsal |

---

## Demo Script (5 min, judges type live)

1. *"Show me containment rate by intent type this week"* → bar chart, 85% threshold coloring
2. *"Now show only the intents below the threshold"* → follow-up question, conversation context
3. *"Show me a pie chart of Greek vs English users"* → pie chart
4. *"How is AHT trending over the last 30 days?"* → line chart
5. Let a judge type their own question

---

## Bonus / If Time Allows

- [ ] Heatmap chart type
- [ ] Export chart as PNG
- [ ] Anomaly detection prompt ("which intents have unusual patterns?")
- [ ] Greek-language query support (test explicitly — the dataset has both languages)
- [ ] Display the generated SQL under each chart (transparency + impressive to judges)
