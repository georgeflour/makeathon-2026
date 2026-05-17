"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sparkles, Sun, Menu, Grid3X3 } from "lucide-react";
import { useChatContext } from "@/context/ChatContext";

interface NavbarProps {
  isDark: boolean;
  onToggleTheme: () => void;
}

export function Navbar({ isDark, onToggleTheme }: NavbarProps) {
  const pathname = usePathname();
  const { isSidebarOpen, setIsSidebarOpen, isRightSidebarOpen, setIsRightSidebarOpen } = useChatContext();
  const isDashboard = pathname === "/dashboard";

  return (
    <nav className="flex-shrink-0 h-12 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-[#171717] flex items-center px-4 gap-1">
      <button
        onClick={() => setIsSidebarOpen((prev) => !prev)}
        title={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
        className="p-1.5 mr-2 rounded-lg text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Brand */}
      <div className="flex items-center gap-2 mr-3">
        <div className="h-6 w-6 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center flex-shrink-0">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="text-sm font-semibold text-gray-800 dark:text-white/90 hidden sm:block">
          Hack to the Future
        </span>
      </div>

      {/* Nav tabs */}
      <div className="flex self-stretch mr-auto">
        <Link
          href="/"
          className={`self-stretch flex items-center px-2 sm:px-3 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
            pathname === "/"
              ? "text-blue-600 dark:text-blue-400 border-blue-500"
              : "text-gray-500 dark:text-white/50 border-transparent hover:text-gray-800 dark:hover:text-white/80"
          }`}
        >
          AI Assistant
        </Link>
        <Link
          href="/dashboard"
          className={`self-stretch flex items-center px-2 sm:px-3 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
            pathname === "/dashboard"
              ? "text-blue-600 dark:text-blue-400 border-blue-500"
              : "text-gray-500 dark:text-white/50 border-transparent hover:text-gray-800 dark:hover:text-white/80"
          }`}
        >
          Dashboard
        </Link>
      </div>

      {/* Right Sidebar toggle (Dashboard only) */}
      {isDashboard && (
        <button
          onClick={() => setIsRightSidebarOpen((prev) => !prev)}
          title={isRightSidebarOpen ? "Hide widgets" : "Show widgets"}
          className={`p-2 rounded-lg transition-colors ${
            isRightSidebarOpen
              ? "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-500/10"
              : "text-gray-400 dark:text-white/40 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10"
          }`}
        >
          <Grid3X3 className="h-4 w-4" />
        </button>
      )}

      {/* Theme toggle */}
      <button
        onClick={onToggleTheme}
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        className="p-2 rounded-lg text-gray-400 dark:text-white/40 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </nav>
  );
}
