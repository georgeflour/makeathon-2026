const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function sendChatMessage(message: string) {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
  
  if (!res.ok) {
    throw new Error("Failed to send message");
  }
  
  return res.json();
}

export async function getHealth() {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) {
    throw new Error("Failed to get health status");
  }
  return res.json();
}
