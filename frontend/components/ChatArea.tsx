"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { useChatContext } from "@/context/ChatContext";
import { ChartPanel } from "@/components/ChartPanel";

const SUGGESTIONS = [
  { label: "Containment rate by intent", query: "Show me containment rate by intent type" },
  { label: "Daily call volume", query: "Daily call volume over the last 30 days" },
  { label: "Greek vs English callers", query: "Pie chart of Greek vs English callers" },
  { label: "Handle time by segment", query: "Average handle time by customer segment" },
  { label: "Lowest CSAT intents", query: "Which intents have the lowest CSAT?" },
  { label: "Tool success rate", query: "Tool success rate by tool name" },
];

export function ChatArea() {
  const { activeChat, isLoading, sendMessage } = useChatContext();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages = activeChat?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || isLoading) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    sendMessage(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#212121]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          /* Welcome / empty state */
          <div className="flex flex-col items-center justify-center h-full px-4 pb-32">
            <div className="mb-8 text-center">
              <div className="h-12 w-12 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 mx-auto mb-4" />
              <h1 className="text-2xl font-semibold text-gray-900 dark:text-white/90 mb-1">
                How can I help you?
              </h1>
              <p className="text-sm text-gray-500 dark:text-white/35">
                Ask anything about SmartRep voicebot data — in English or Greek.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-xl">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.query}
                  onClick={() => handleSend(s.query)}
                  className="text-left px-4 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] hover:bg-gray-100 dark:hover:bg-white/[0.07] text-sm text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Conversation */
          <div className="max-w-3xl mx-auto w-full px-4 py-8 space-y-6">
            {messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-gray-100 dark:bg-[#2f2f2f] px-4 py-2.5">
                    <p className="text-sm text-gray-900 dark:text-white/90 whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                    </p>
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="flex gap-3">
                  <div className="h-7 w-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 dark:text-white/90 leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </p>
                    {msg.chart && (
                      <div className="mt-4">
                        <ChartPanel chart={msg.chart} />
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            {isLoading && (
              <div className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex-shrink-0 mt-1" />
                <div className="flex items-center gap-1 pt-1.5">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="h-2 w-2 rounded-full bg-gray-400 dark:bg-white/30 animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 px-4 pb-6 pt-2">
        <div className="max-w-3xl mx-auto">
          <div className="relative flex items-end gap-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#2f2f2f] px-4 py-3 focus-within:border-gray-400 dark:focus-within:border-white/25 transition-colors shadow-sm">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder="Message Hack to the Future..."
              className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white/90 placeholder:text-gray-400 dark:placeholder:text-white/25 outline-none resize-none max-h-[200px] leading-relaxed disabled:opacity-50"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              className="flex-shrink-0 h-8 w-8 rounded-lg bg-gray-900 dark:bg-white flex items-center justify-center text-white dark:text-black hover:bg-gray-700 dark:hover:bg-white/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
          </div>
          <p className="text-center text-[11px] text-gray-300 dark:text-white/15 mt-2">
            Hack to the Future · SmartRep × Uni AI Makeathon 2026
          </p>
        </div>
      </div>
    </div>
  );
}
