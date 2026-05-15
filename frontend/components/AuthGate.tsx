"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-white dark:bg-[#212121]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!user) return <LoginForm />;

  return <>{children}</>;
}

function LoginForm() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    const err =
      mode === "login"
        ? await signIn(email, password)
        : await signUp(email, password);
    if (err) {
      setError(err);
    } else if (mode === "signup") {
      setSuccess("Account created! Check your email to confirm, then sign in.");
    }
    setIsSubmitting(false);
  };

  return (
    <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-[#1a1a1a] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 mx-auto mb-4 flex items-center justify-center">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            {mode === "login" ? "Welcome back" : "Create account"}
          </h1>
          <p className="text-sm text-gray-500 dark:text-white/40 mt-1">
            SmartRep voicebot analytics
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30 outline-none focus:border-blue-400 dark:focus:border-blue-500 transition-colors text-sm"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30 outline-none focus:border-blue-400 dark:focus:border-blue-500 transition-colors text-sm"
          />

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-3 py-2">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
          {success && (
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-3 py-2">
              <p className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">Check your email</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">
                We sent a confirmation link. Click it, then come back and sign in.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-violet-600 text-white font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 dark:text-white/40 mt-4">
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError(null);
              setSuccess(null);
            }}
            className="text-blue-500 hover:text-blue-600 dark:text-blue-400 font-medium"
          >
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>

        <p className="text-center text-xs text-gray-400 dark:text-white/20 mt-8">
          Hack to the Future × SmartRep.AI · Makeathon 2026
        </p>
      </div>
    </div>
  );
}
