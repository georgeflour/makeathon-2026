"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sparkles, Sun } from "lucide-react";

interface NavbarProps {
  isDark: boolean;
  onToggleTheme: () => void;
}

export function Navbar({ isDark, onToggleTheme }: NavbarProps) {
  const pathname = usePathname();

  return (
    <nav className="flex-shrink-0 h-12 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-[#171717] flex items-center px-4 gap-1">
      {/* Brand */}
      <div className="flex items-center gap-2 mr-3">
        <div className="h-6 w-6 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
        <span className="text-sm font-semibold text-gray-800 dark:text-white/90 hidden sm:block">
          Hack to the Future
        </span>
      </div>

      {/* Underline tabs — stretch to full navbar height so border-b sits at the bottom */}
      <div className="flex self-stretch mr-auto">
        <Link
          href="/"
          className={`self-stretch flex items-center px-3 text-sm font-medium border-b-2 transition-colors ${
            pathname === "/"
              ? "text-blue-600 dark:text-blue-400 border-blue-500"
              : "text-gray-500 dark:text-white/50 border-transparent hover:text-gray-800 dark:hover:text-white/80"
          }`}
        >
          AI Assistant
        </Link>
        <Link
          href="/dashboard"
          className={`self-stretch flex items-center px-3 text-sm font-medium border-b-2 transition-colors ${
            pathname === "/dashboard"
              ? "text-blue-600 dark:text-blue-400 border-blue-500"
              : "text-gray-500 dark:text-white/50 border-transparent hover:text-gray-800 dark:hover:text-white/80"
          }`}
        >
          Dashboard
        </Link>
      </div>

      {/* Theme toggle — far right */}
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
