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
}

export interface ChatResponse {
  answer: string;
  chart?: ChartSpec;
}

export async function sendChatMessage(
  message: string,
  history: ChatMessage[]
): Promise<ChatResponse> {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown error");
    throw new Error(err || "Failed to send message");
  }

  return res.json();
}

export async function getHealth() {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) throw new Error("Failed to get health status");
  return res.json();
}
