"use client";

import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { sendChatMessage } from "@/lib/api";

export function ChatBox() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setIsLoading(true);
    setError("");

    try {
      const data = await sendChatMessage(userMsg);
      setMessages((prev) => [...prev, { role: "assistant", content: data.answer }]);
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto border rounded-xl shadow-sm bg-card overflow-hidden flex flex-col">
      <div className="p-4 border-b bg-muted/30">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          Azure AI Agent
        </h3>
        <p className="text-sm text-muted-foreground">Ask me anything about your project.</p>
      </div>
      
      <div className="flex-1 p-4 min-h-[300px] max-h-[400px] overflow-y-auto space-y-4 flex flex-col bg-background">
        {messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm italic">
            No messages yet. Start a conversation!
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex w-full ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-muted text-foreground rounded-tl-sm border"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))
        )}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted text-foreground border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Thinking...</span>
            </div>
          </div>
        )}
        
        {error && (
          <div className="flex justify-center">
            <div className="bg-destructive/10 text-destructive text-sm px-3 py-1 rounded-full">
              {error}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-muted/30 border-t">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
        >
          <input
            type="text"
            className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
            placeholder="Type your message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}
