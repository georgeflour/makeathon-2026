"use client";

import { Fragment, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  Loader2,
  Moon,
  Sparkles,
  Sun,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { PALETTES } from "@/lib/palettes";

const STEP_LABELS = ["Welcome", "Appearance", "Charts", "Ready"];

export function OnboardingFlow() {
  const { completeOnboarding } = useAuth();
  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [colorPalette, setColorPalette] = useState("ocean");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Apply theme live so user sees the result while choosing
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => s - 1);

  const finish = async () => {
    setIsSubmitting(true);
    localStorage.setItem("httf-theme", theme);
    await completeOnboarding(displayName, colorPalette, theme);
    setIsSubmitting(false);
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#111]">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-gray-100 dark:border-white/5 px-8 py-4 flex items-center gap-2.5">
        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="text-sm font-semibold text-gray-700 dark:text-white/60">
          Hack to the Future
        </span>
      </header>

      {/* Step bar */}
      <div className="flex-shrink-0 px-8 pt-10 pb-0">
        <div className="max-w-lg mx-auto">
          <StepBar current={step} labels={STEP_LABELS} />
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 overflow-y-auto">
        <div className="w-full max-w-lg">
          {step === 1 && (
            <StepWelcome
              displayName={displayName}
              setDisplayName={setDisplayName}
              onNext={next}
            />
          )}
          {step === 2 && (
            <StepTheme value={theme} onChange={setTheme} onNext={next} onBack={back} />
          )}
          {step === 3 && (
            <StepPalette
              value={colorPalette}
              onChange={setColorPalette}
              onNext={next}
              onBack={back}
            />
          )}
          {step === 4 && (
            <StepReady
              displayName={displayName}
              onFinish={finish}
              onBack={back}
              isSubmitting={isSubmitting}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step bar ──────────────────────────────────────────────────────────────────

function StepBar({ current, labels }: { current: number; labels: string[] }) {
  return (
    <div className="flex items-start">
      {labels.map((label, idx) => {
        const num = idx + 1;
        const done = num < current;
        const active = num === current;
        return (
          <Fragment key={num}>
            <div className="flex flex-col items-center gap-2 flex-shrink-0">
              <div
                className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                  done
                    ? "bg-blue-500 text-white"
                    : active
                    ? "bg-blue-500 text-white ring-4 ring-blue-500/20"
                    : "bg-gray-100 dark:bg-white/8 text-gray-400 dark:text-white/25"
                }`}
              >
                {done ? <Check className="h-4 w-4" strokeWidth={3} /> : num}
              </div>
              <span
                className={`text-xs font-medium whitespace-nowrap transition-colors duration-300 ${
                  active
                    ? "text-gray-900 dark:text-white"
                    : done
                    ? "text-blue-500"
                    : "text-gray-400 dark:text-white/25"
                }`}
              >
                {label}
              </span>
            </div>

            {idx < labels.length - 1 && (
              <div
                className={`flex-1 h-0.5 mt-[18px] mx-3 rounded transition-all duration-500 ${
                  num < current ? "bg-blue-500" : "bg-gray-200 dark:bg-white/8"
                }`}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

// ── Shared nav buttons ────────────────────────────────────────────────────────

function BackBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex-shrink-0 px-5 py-3.5 rounded-xl border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 font-semibold text-sm transition-colors flex items-center gap-2 disabled:opacity-40"
    >
      <ArrowLeft className="h-4 w-4" /> Back
    </button>
  );
}

function NextBtn({ onClick, label = "Continue" }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-blue-500 to-violet-600 text-white font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
    >
      {label} <ArrowRight className="h-4 w-4" />
    </button>
  );
}

// ── Step 1: Welcome ───────────────────────────────────────────────────────────

function StepWelcome({
  displayName,
  setDisplayName,
  onNext,
}: {
  displayName: string;
  setDisplayName: (v: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Welcome aboard 👋</h1>
        <p className="text-gray-500 dark:text-white/50 mt-2 text-sm">
          Let&apos;s personalise your workspace in a few quick steps.
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-white/70">
          What should we call you?
        </label>
        <input
          type="text"
          placeholder="Your name (optional)"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onNext()}
          autoFocus
          className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30 outline-none focus:border-blue-400 dark:focus:border-blue-500 transition-colors text-sm"
        />
      </div>

      <NextBtn onClick={onNext} />
    </div>
  );
}

// ── Step 2: Theme ─────────────────────────────────────────────────────────────

function StepTheme({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: "light" | "dark";
  onChange: (v: "light" | "dark") => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Choose your theme</h1>
        <p className="text-gray-500 dark:text-white/50 mt-2 text-sm">
          You can switch anytime from Settings.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ThemeCard mode="light" selected={value === "light"} onClick={() => onChange("light")} />
        <ThemeCard mode="dark" selected={value === "dark"} onClick={() => onChange("dark")} />
      </div>

      <div className="flex gap-3">
        <BackBtn onClick={onBack} />
        <NextBtn onClick={onNext} />
      </div>
    </div>
  );
}

function ThemeCard({
  mode,
  selected,
  onClick,
}: {
  mode: "light" | "dark";
  selected: boolean;
  onClick: () => void;
}) {
  const d = mode === "dark";
  return (
    <button
      onClick={onClick}
      className={`relative w-full rounded-2xl border-2 overflow-hidden text-left transition-all duration-200 ${
        selected
          ? "border-blue-500 shadow-lg shadow-blue-500/15"
          : "border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20"
      }`}
    >
      {/* App mockup preview */}
      <div className={`h-36 ${d ? "bg-[#212121]" : "bg-gray-50"} overflow-hidden`}>
        {/* Navbar */}
        <div
          className={`h-7 flex items-center gap-1.5 px-3 border-b ${
            d ? "bg-[#171717] border-white/8" : "bg-white border-gray-200"
          }`}
        >
          <div className="h-2.5 w-2.5 rounded bg-gradient-to-br from-blue-500 to-violet-600" />
          <div className={`h-1.5 w-14 rounded-full ${d ? "bg-white/15" : "bg-gray-200"}`} />
          <div className="flex-1" />
          <div className={`h-4 w-4 rounded-full ${d ? "bg-white/10" : "bg-gray-200"}`} />
        </div>
        {/* Body */}
        <div className="flex" style={{ height: "calc(100% - 28px)" }}>
          {/* Sidebar */}
          <div
            className={`w-10 border-r flex flex-col justify-end pb-2 gap-1 px-1.5 ${
              d ? "bg-[#171717] border-white/8" : "bg-white border-gray-200"
            }`}
          >
            <div className={`h-4 w-full rounded-sm ${d ? "bg-white/10" : "bg-gray-200"}`} />
            <div className={`h-4 w-full rounded-sm ${d ? "bg-white/8" : "bg-gray-100"}`} />
          </div>
          {/* Chat area */}
          <div className="flex-1 p-2.5 space-y-1.5">
            <div className={`h-1.5 w-3/4 rounded-full ${d ? "bg-white/12" : "bg-gray-200"}`} />
            <div className={`h-1.5 w-1/2 rounded-full ${d ? "bg-white/8" : "bg-gray-100"}`} />
            <div className={`ml-auto h-6 w-2/3 rounded-xl ${d ? "bg-white/8" : "bg-gray-100"}`} />
            <div className={`h-1.5 w-4/5 rounded-full ${d ? "bg-white/12" : "bg-gray-200"}`} />
            <div className="flex gap-1 mt-2">
              {[60, 85, 50, 70].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-blue-500 opacity-60"
                  style={{ height: `${h * 0.2}px` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Label */}
      <div
        className={`px-4 py-3 flex items-center justify-between ${
          d ? "bg-[#1a1a1a]" : "bg-white"
        }`}
      >
        <div className="flex items-center gap-2">
          {d ? (
            <Moon className="h-4 w-4 text-blue-400" />
          ) : (
            <Sun className="h-4 w-4 text-amber-500" />
          )}
          <span className={`text-sm font-semibold ${d ? "text-white/80" : "text-gray-800"}`}>
            {d ? "Dark" : "Light"}
          </span>
        </div>
        {selected && <Check className="h-4 w-4 text-blue-500" />}
      </div>
    </button>
  );
}

// ── Step 3: Chart palette ─────────────────────────────────────────────────────

function StepPalette({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Pick your chart palette</h1>
        <p className="text-gray-500 dark:text-white/50 mt-2 text-sm">
          Applied to all charts and visualisations.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Object.values(PALETTES).map((palette) => (
          <button
            key={palette.name}
            onClick={() => onChange(palette.name)}
            className={`relative p-4 rounded-xl border-2 text-left transition-all ${
              value === palette.name
                ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10"
                : "border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 bg-white dark:bg-white/[0.02]"
            }`}
          >
            {value === palette.name && (
              <CheckCircle className="absolute top-3 right-3 h-4 w-4 text-blue-500" />
            )}
            <MiniBarChart colors={palette.colors} />
            <p className="text-sm font-semibold text-gray-900 dark:text-white mt-3">
              {palette.label}
            </p>
            <p className="text-xs text-gray-500 dark:text-white/40">{palette.description}</p>
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <BackBtn onClick={onBack} />
        <NextBtn onClick={onNext} />
      </div>
    </div>
  );
}

function MiniBarChart({ colors }: { colors: string[] }) {
  const heights = [55, 85, 45, 75, 60, 90];
  return (
    <div className="flex items-end gap-1 h-10">
      {heights.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{ height: `${h}%`, background: colors[i % colors.length] }}
        />
      ))}
    </div>
  );
}

// ── Step 4: Ready ─────────────────────────────────────────────────────────────

function StepReady({
  displayName,
  onFinish,
  onBack,
  isSubmitting,
}: {
  displayName: string;
  onFinish: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          {displayName.trim() ? `All set, ${displayName.trim()}!` : "All set!"} 🚀
        </h1>
        <p className="text-gray-500 dark:text-white/50 mt-2 text-sm">
          You&apos;re ready to explore SmartRep voicebot data.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: "💬", title: "Natural language", body: "Ask in English or Greek" },
          { icon: "📊", title: "Instant charts", body: "Visualisations generated automatically" },
          { icon: "💾", title: "Saved history", body: "Chats sync to your account" },
        ].map((item) => (
          <div
            key={item.title}
            className="rounded-xl bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/8 p-4"
          >
            <div className="text-2xl mb-2">{item.icon}</div>
            <p className="text-xs font-semibold text-gray-900 dark:text-white mb-0.5">
              {item.title}
            </p>
            <p className="text-xs text-gray-500 dark:text-white/40">{item.body}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <BackBtn onClick={onBack} disabled={isSubmitting} />
        <button
          onClick={onFinish}
          disabled={isSubmitting}
          className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-blue-500 to-violet-600 text-white font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Setting up…
            </>
          ) : (
            <>
              Start exploring <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
