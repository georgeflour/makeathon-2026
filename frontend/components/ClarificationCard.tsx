"use client";

// frontend/components/ClarificationCard.tsx
// Rendered inside ChatArea when the Enchanted Prompt agent returns
// intent="needs_clarification". Shows the agent's question, three
// suggested answers (A / B / C chips), and a freeform textarea.
// Calls onSubmit(answer) when the user picks a suggestion or types their own.

import { useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";

export interface ClarificationPayload {
    type: "clarification";
    question: string;
    suggestions: string[];
}

interface Props {
    payload: ClarificationPayload;
    onSubmit: (answer: string) => void;
    disabled?: boolean;
}

const CHIP_LABELS = ["A", "B", "C"];

export function ClarificationCard({ payload, onSubmit, disabled = false }: Props) {
    const [selected, setSelected] = useState<string | null>(null);
    const [custom, setCustom] = useState("");
    const [submitted, setSubmitted] = useState(false);

    const activeAnswer = custom.trim() || selected;

    const handleSelect = (suggestion: string) => {
        if (disabled || submitted) return;
        setSelected(suggestion === selected ? null : suggestion);
        setCustom("");
    };

    const handleCustomChange = (val: string) => {
        setCustom(val);
        if (val.trim()) setSelected(null);
    };

    const handleSubmit = () => {
        if (!activeAnswer || disabled || submitted) return;
        setSubmitted(true);
        onSubmit(activeAnswer);
    };

    return (
        <div className="w-full rounded-2xl rounded-tl-sm border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] overflow-hidden">
            {/* Agent header */}
            <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3 border-b border-gray-100 dark:border-white/[0.06]">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex-shrink-0">
                    <Sparkles className="h-3 w-3 text-white" />
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">
                    Enchanted Prompt
                </span>
            </div>

            {/* Question */}
            <div className="px-4 pt-3 pb-3">
                <p className="text-[15px] text-gray-800 dark:text-white/90 leading-7">
                    {payload.question}
                </p>
            </div>

            {/* Suggestions */}
            {payload.suggestions.length > 0 && (
                <div className="px-4 pb-3 flex flex-col gap-2">
                    <p className="text-[11px] uppercase tracking-widest text-gray-400 dark:text-white/25 font-semibold">
                        Suggested answers
                    </p>
                    {payload.suggestions.slice(0, 3).map((suggestion, i) => (
                        <button
                            key={i}
                            disabled={disabled || submitted}
                            onClick={() => handleSelect(suggestion)}
                            className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors
                ${selected === suggestion
                                    ? "border-violet-400 dark:border-violet-500 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300"
                                    : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-gray-700 dark:text-white/70 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/[0.06]"
                                }
                disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                            <span
                                className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] font-bold
                  ${selected === suggestion
                                        ? "bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300"
                                        : "bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/40"
                                    }`}
                            >
                                {CHIP_LABELS[i] ?? i + 1}
                            </span>
                            <span className="leading-snug">{suggestion}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Divider */}
            <div className="mx-4 flex items-center gap-3 pb-3">
                <div className="h-px flex-1 bg-gray-200 dark:bg-white/[0.06]" />
                <span className="text-[11px] text-gray-400 dark:text-white/25 flex-shrink-0">
                    or type your own
                </span>
                <div className="h-px flex-1 bg-gray-200 dark:bg-white/[0.06]" />
            </div>

            {/* Custom input + send */}
            <div className="px-4 pb-4">
                <div className="flex items-end gap-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2f2f2f] px-3 py-2.5 focus-within:border-gray-400 dark:focus-within:border-white/25 transition-colors">
                    <textarea
                        rows={1}
                        disabled={disabled || submitted}
                        value={custom}
                        onChange={(e) => {
                            handleCustomChange(e.target.value);
                            e.target.style.height = "auto";
                            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSubmit();
                            }
                        }}
                        placeholder="Describe what you meant…"
                        className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white/90 placeholder:text-gray-400 dark:placeholder:text-white/25 outline-none resize-none max-h-[120px] leading-relaxed disabled:opacity-50"
                    />
                    <button
                        disabled={!activeAnswer || disabled || submitted}
                        onClick={handleSubmit}
                        className="flex-shrink-0 h-7 w-7 rounded-lg bg-gray-900 dark:bg-white flex items-center justify-center text-white dark:text-black hover:bg-gray-700 dark:hover:bg-white/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                        <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Helper — parse a clarification payload from an assistant message string.
// Returns null if the string is not a valid clarification payload.
// ---------------------------------------------------------------------------
export function parseClarification(content: string): ClarificationPayload | null {
    try {
        const trimmed = content.trim();
        if (!trimmed.startsWith("{")) return null;
        const parsed = JSON.parse(trimmed);
        if (
            parsed?.type === "clarification" &&
            typeof parsed.question === "string" &&
            Array.isArray(parsed.suggestions)
        ) {
            return parsed as ClarificationPayload;
        }
    } catch {
        // not JSON — normal message
    }
    return null;
}