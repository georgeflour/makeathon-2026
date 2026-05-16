"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";
import { sendChatMessage, type ChatMessage, type ChartSpec } from "@/lib/api";
import { ChartPanel } from "@/components/ChartPanel";

const SUGGESTED_QUERIES = [
  "Show me containment rate by intent type",
  "Daily call volume over the last 30 days",
  "Pie chart of Greek vs English callers",
  "Average handle time by customer segment",
  "Which intents have the lowest CSAT?",
  "Tool success rate by tool name",
];

interface Message {
  role: "user" | "assistant";
  content: string;
  chart?: ChartSpec;
}

export function ChatBox() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const buildHistory = (msgs: Message[]): ChatMessage[] =>
    msgs.map((m) => ({ role: m.role, content: m.content }));

  const handleSend = async (text?: string) => {
    const userMsg = (text ?? input).trim();
    if (!userMsg) return;

    setInput("");
    const updatedMessages = [...messages, { role: "user" as const, content: userMsg }];
    setMessages(updatedMessages);
    setIsLoading(true);
    setError("");

    try {
      const data = await sendChatMessage(userMsg, buildHistory(messages));
      setMessages([
        ...updatedMessages,
        { role: "assistant", content: data.answer, chart: data.chart },
      ]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-4">
      {messages.length === 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {SUGGESTED_QUERIES.map((q) => (
            <button
              key={q}
              onClick={() => handleSend(q)}
              className="text-left text-xs rounded-lg border bg-card px-3 py-2 text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="w-full rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b bg-muted/30">
          <h3 className="font-semibold text-lg">NR2Dashboard</h3>
          <p className="text-sm text-muted-foreground">
            Ask anything about your voicebot data — in English or Greek.
          </p>
        </div>

        <div className="flex-1 p-4 min-h-[320px] max-h-[600px] overflow-y-auto space-y-4 bg-background">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm italic">
              No messages yet. Type a question or pick a suggestion above.
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`flex w-full ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] ${msg.role === "user" ? "w-fit" : "w-full"}`}>
                  <div
                    className={`rounded-2xl px-4 py-2 ${msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-sm ml-auto w-fit"
                        : "bg-muted text-foreground rounded-tl-sm border"
                      }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  {msg.chart && <ChartPanel chart={msg.chart} />}
                </div>
              </div>
            ))
          )}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Analysing data...</span>
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

          <div ref={bottomRef} />
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
              placeholder="e.g. Show containment rate by intent this week..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
