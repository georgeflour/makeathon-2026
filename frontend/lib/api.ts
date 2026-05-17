const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface ColorRules {
  threshold: number;
  above: string;
  below: string;
}

export interface ChartSpec {
  type: "bar" | "line" | "pie" | "area" | "kpi";
  title: string;
  data: Array<{ label?: string; value?: number; x?: string; y?: number }> | { value: number };
  sql: string;
  explanation?: string;
  color_rules?: ColorRules;
  suggestions?: string[];
}

export interface Widget {
  id: string;
  name: string;
  chart: ChartSpec;
}

/**
 * A history entry sent to the backend.
 * For assistant messages that produced a chart, include the chart so the
 * backend can inject it as structured context into the agent's prompt,
 * enabling follow-up questions like "why is that intent low?".
 */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  chart?: ChartSpec; // only present on assistant turns that rendered a chart
}

export interface ChatResponse {
  answer: string;
  chart?: ChartSpec;
}

export async function sendChatMessage(
  message: string,
  history: ChatMessage[]
): Promise<ChatResponse> {
  const res = await fetch(`/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown error");
    throw new Error(err || "Failed to send message");
  }

  // Backend returns SSE — read the stream and return the "final" event's data
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No reader available");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let eventType = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6).trim());
        if (eventType === "final") return data as ChatResponse;
        if (eventType === "error") throw new Error(data.message);
        eventType = "";
      }
    }
  }

  throw new Error("Stream ended without a final response");
}

export async function getHealth() {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) throw new Error("Failed to get health status");
  return res.json();
}

// ---------------------------------------------------------------------------
// Scheduled reports
// ---------------------------------------------------------------------------

export interface ScheduledReport {
  id: string;
  name: string;
  widget_ids: string[];
  frequency: "daily" | "weekly";
  day_of_week?: number | null;  // 0=Mon … 6=Sun
  hour: number;
  email: string;
  enabled: boolean;
  next_run_at?: string | null;
  last_run_at?: string | null;
  created_at?: string;
}

async function _schedulerFetch(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
}

export async function getSchedules(token: string): Promise<ScheduledReport[]> {
  const res = await _schedulerFetch("/api/schedules", token);
  if (!res.ok) throw new Error("Failed to fetch schedules");
  return res.json();
}

export async function createSchedule(
  token: string,
  data: Omit<ScheduledReport, "id" | "enabled" | "next_run_at" | "last_run_at" | "created_at">
): Promise<ScheduledReport> {
  const res = await _schedulerFetch("/api/schedules", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create schedule");
  return res.json();
}

export async function toggleSchedule(
  token: string,
  id: string,
  enabled: boolean
): Promise<ScheduledReport> {
  const res = await _schedulerFetch(`/api/schedules/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error("Failed to update schedule");
  return res.json();
}

export async function deleteSchedule(token: string, id: string): Promise<void> {
  const res = await _schedulerFetch(`/api/schedules/${id}`, token, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) throw new Error("Failed to delete schedule");
}
