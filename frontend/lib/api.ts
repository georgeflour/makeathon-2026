const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

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
