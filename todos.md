# Hackathon TODOs — Speak With Your Data

## Person 1 — AI & MCP Engineer
Files: `backend/app/azure_agent.py`, `backend/app/mcp_server.py` (new)

- [ ] Spike MCP ↔ Azure AI Foundry connection with a hardcoded test (do this first, hour 1-2)
- [ ] Create `backend/app/mcp_server.py` using `fastmcp` with tools:
  - [ ] `list_columns(dataset_id)` 
  - [ ] `query_data(dataset_id, filters)`
  - [ ] `aggregate(dataset_id, group_by, metric)`
  - [ ] `describe_dataset(dataset_id)`
  - [ ] `generate_chart_config(dataset_id, question)`
- [ ] Modify `azure_agent.py` to connect agent to MCP server
- [ ] Parse structured agent response into `{answer, chart}` shape
- [ ] Configure Azure AI Foundry system prompt to always return a chart spec when relevant
- [ ] Pass full conversation history (not just current message) to the agent

---

## Person 2 — Data & Backend Engineer
Files: `backend/app/routes/upload.py` (new), `backend/app/models.py`, `backend/requirements.txt`

- [ ] Add `pandas` and `fastmcp` to `requirements.txt`
- [ ] Create in-memory session store (dict keyed by `dataset_id`) for pandas DataFrames
- [ ] Add `POST /api/upload` — parse CSV/JSON with pandas, store DataFrame, save metadata to Supabase
- [ ] Add `GET /api/datasets` — list uploaded datasets from Supabase
- [ ] Extend `ChatRequest` model: add `dataset_id: str` and `history: list[{role, content}]`
- [ ] Extend `ChatResponse` model: add `chart: Optional[ChartSpec]`
  - [ ] Define `ChartSpec` model: `{type, data, options}`
- [ ] Update `/api/chat` route to accept `dataset_id` and `history`, pass to agent

---

## Person 3 — Frontend Engineer
Files: `frontend/components/`, `frontend/lib/api.ts`, `frontend/app/page.tsx`

- [ ] Add `FileUpload` component: drag-and-drop CSV/JSON → `POST /api/upload` → store `dataset_id` in state
- [ ] Add dataset switcher dropdown (select active dataset)
- [ ] Update `lib/api.ts`: `sendChatMessage` to include `dataset_id` and `history`, handle new `{answer, chart}` response shape
- [ ] Extend `ChatBox` to pass `dataset_id` + full conversation history on every send
- [ ] Add `ChartPanel` component using Recharts:
  - [ ] `BarChart`
  - [ ] `LineChart`
  - [ ] `PieChart` / `DonutChart`
  - [ ] `AreaChart`
  - [ ] Switch on `chart.type` from API response
- [ ] Render `ChartPanel` inline in the chat when `chart` is present in response
- [ ] Update page layout: file upload at top, chat + chart side by side

---

## Person 4 — DevOps, Integration & Demo
Files: Azure portal, Supabase, `backend/Dockerfile`, Vercel

- [ ] Add `datasets` table to Supabase: `(id uuid, name text, columns jsonb, row_count int, created_at timestamp)`
- [ ] Update `chat_messages` table: add `dataset_id` column
- [ ] Configure Azure AI Foundry agent: wire MCP server endpoint, set chart-aware system prompt
- [ ] Deploy backend to Azure Container Apps (build from existing `Dockerfile`, add new env vars)
- [ ] Deploy frontend to Vercel, set `NEXT_PUBLIC_API_URL` to deployed backend URL
- [ ] First end-to-end integration test (hour 7-8): upload CSV → ask question → get chart
- [ ] Prepare 2-3 sample datasets for the demo
- [ ] Script the 5-minute demo narrative

---

## Build Order

| Hours | Who | What |
|-------|-----|-------|
| 1–2   | P2  | Upload endpoint + data layer (others are blocked on this) |
| 1–2   | P4  | Azure agent config + Supabase schema |
| 3–6   | P1  | MCP tools + agent wiring |
| 3–6   | P2  | Chat route extensions |
| 3–6   | P3  | FileUpload + ChartPanel (stub with mock data first) |
| 7–8   | P4  | End-to-end integration test |
| 7–8   | All | Fix chart JSON ↔ Recharts shape mismatches |

---

## Bonus / If Time Allows

- [ ] Support switching datasets mid-conversation
- [ ] Persist chart history in Supabase alongside chat messages
- [ ] Heatmap chart type
- [ ] Export chart as PNG
