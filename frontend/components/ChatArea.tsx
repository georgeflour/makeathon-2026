"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Sparkles, Copy, Check, Pencil } from "lucide-react";
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
  const { activeChat, isLoading, sendMessage, editMessage } = useChatContext();
  const [input, setInput] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

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

  const startEditing = (msgId: string, content: string) => {
    setEditingMessageId(msgId);
    setEditValue(content);
    // Focus after render
    setTimeout(() => {
      if (editRef.current) {
        editRef.current.focus();
        editRef.current.style.height = "auto";
        editRef.current.style.height = `${editRef.current.scrollHeight}px`;
      }
    }, 0);
  };

  const handleEditSubmit = () => {
    if (!editingMessageId) return;
    editMessage(editingMessageId, editValue);
    setEditingMessageId(null);
    setEditValue("");
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#212121]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 pb-32">
            <div className="mb-8 text-center">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 mx-auto mb-4 flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
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
          <div className="max-w-3xl mx-auto w-full px-4 py-8 space-y-6">
            {messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex justify-end group">
                  <div className="flex flex-col items-end gap-1.5 max-w-[80%]">
                    {editingMessageId === msg.id ? (
                      <div className="w-full min-w-[300px] flex flex-col gap-2 bg-gray-50 dark:bg-[#2f2f2f] rounded-2xl p-3 border border-gray-200 dark:border-white/10">
                        <textarea
                          ref={editRef}
                          value={editValue}
                          onChange={(e) => {
                            setEditValue(e.target.value);
                            e.target.style.height = "auto";
                            e.target.style.height = `${e.target.scrollHeight}px`;
                          }}
                          className="w-full bg-transparent text-sm text-gray-900 dark:text-white/90 outline-none resize-none leading-relaxed"
                          rows={1}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setEditingMessageId(null)}
                            className="px-3 py-1 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleEditSubmit}
                            disabled={!editValue.trim() || isLoading}
                            className="px-3 py-1 rounded-lg text-xs font-medium bg-gray-900 dark:bg-white text-white dark:text-black hover:opacity-90 disabled:opacity-50"
                          >
                            Save & Submit
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="rounded-2xl rounded-tr-sm bg-gray-100 dark:bg-[#2f2f2f] px-4 py-2.5">
                          <p className="text-sm text-gray-900 dark:text-white/90 whitespace-pre-wrap leading-relaxed">
                            {msg.content}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEditing(msg.id, msg.content)}
                            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-white/60"
                            title="Edit message"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => navigator.clipboard.writeText(msg.content)}
                            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-white/60"
                            title="Copy message"
                          >
                            <CopyAction text={msg.content} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="flex gap-3 group">
                  <div className="h-7 w-7 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex-shrink-0 mt-0.5 flex items-center justify-center">
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <p className="text-sm text-gray-800 dark:text-white/90 leading-relaxed whitespace-pre-wrap flex-1">
                        {msg.content}
                      </p>
                      <button
                        onClick={() => navigator.clipboard.writeText(msg.content)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-gray-600 dark:hover:text-white/60 mt-[-2px]"
                        title="Copy message"
                      >
                        <CopyAction text={msg.content} />
                      </button>
                    </div>
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
                <div className="h-7 w-7 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex-shrink-0 mt-1 flex items-center justify-center">
                  <Sparkles className="h-3.5 w-3.5 text-white" />
                </div>
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
          <div className="flex items-center gap-2 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#2f2f2f] px-4 py-3 focus-within:border-gray-400 dark:focus-within:border-white/25 transition-colors shadow-sm">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder="How can I help you today?"
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
          <div className="text-center mt-2 space-y-0.5">
            <p className="text-[11px] text-gray-400 dark:text-white/25">
              Hack to the Future AI can make mistakes. Always verify important information.
            </p>
            <p className="text-[11px] text-gray-300 dark:text-white/15 font-medium">
              Hack to the Future x SmartRep.AI
            </p>
            <p className="text-[11px] text-gray-300 dark:text-white/15">
              Makeathon 2026
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div onClick={(e) => { e.stopPropagation(); handleCopy(); }}>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </div>
  );
}
