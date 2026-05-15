"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthProvider } from "@/context/AuthContext";
import { useAuth } from "@/context/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { ChatProvider } from "@/context/ChatContext";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { Navbar } from "@/components/Navbar";
import { Sidebar } from "@/components/Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>
        <AppShellInner>{children}</AppShellInner>
      </AuthGate>
    </AuthProvider>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const { profile, updateSettings } = useAuth();
  const [isDark, setIsDark] = useState(false);

  // Apply theme from localStorage immediately on mount
  useEffect(() => {
    const saved = localStorage.getItem("httf-theme");
    const dark = saved === "dark";
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  // Sync theme from user profile when it loads
  useEffect(() => {
    const t = profile?.settings?.theme;
    if (!t) return;
    const dark = t === "dark";
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("httf-theme", t);
  }, [profile?.settings?.theme]);

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      const theme = next ? "dark" : "light";
      localStorage.setItem("httf-theme", theme);
      updateSettings({ theme });
      return next;
    });
  };

  // Profile still loading (user authenticated but db fetch not done yet)
  if (!profile) {
    return (
      <div className="flex items-center justify-center h-full bg-white dark:bg-[#212121]">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  // Show full-screen onboarding for new users
  if (!profile.onboarding_completed) {
    return <OnboardingFlow />;
  }

  return (
    <ChatProvider>
      <div className="flex flex-col h-full">
        <Navbar isDark={isDark} onToggleTheme={toggleTheme} />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <div className="flex-1 overflow-hidden">{children}</div>
        </div>
      </div>
    </ChatProvider>
  );
}
