"use client";

import { useEffect, useState } from "react";
import { ChatProvider } from "@/context/ChatContext";
import { Sidebar } from "@/components/Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("httf-theme");
    const dark = saved === "dark";
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("httf-theme", next ? "dark" : "light");
      return next;
    });
  };

  return (
    <ChatProvider>
      <div className="flex h-full w-full overflow-hidden">
        <Sidebar isDark={isDark} onToggleTheme={toggleTheme} />
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </ChatProvider>
  );
}
