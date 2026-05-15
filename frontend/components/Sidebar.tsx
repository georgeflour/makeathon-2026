"use client";

import { useCallback, useRef, useState } from "react";
import {
  Check,
  LayoutDashboard,
  MessageSquare,
  Moon,
  Pencil,
  Plus,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useChatContext } from "@/context/ChatContext";

interface SidebarProps {
  isDark: boolean;
  onToggleTheme: () => void;
}

export function Sidebar({ isDark, onToggleTheme }: SidebarProps) {
  const {
    chats,
    activeChatId,
    sidebarWidth,
    setSidebarWidth,
    newChat,
    selectChat,
    renameChat,
    deleteChat,
  } = useChatContext();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const widthRef = useRef(sidebarWidth);
  widthRef.current = sidebarWidth;

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = widthRef.current;
      const handleMove = (ev: MouseEvent) => {
        setSidebarWidth(Math.min(400, Math.max(180, startWidth + ev.clientX - startX)));
      };
      const handleUp = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [setSidebarWidth]
  );

  const handleSelectChat = (id: string) => {
    selectChat(id);
    if (pathname !== "/") router.push("/");
  };

  const handleNewChat = () => {
    newChat();
    if (pathname !== "/") router.push("/");
  };

  const startEdit = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditValue(name);
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) renameChat(editingId, editValue.trim());
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  return (
    <div className="relative flex-shrink-0 h-full flex" style={{ width: sidebarWidth }}>
      <div className="flex-1 flex flex-col h-full bg-gray-100 dark:bg-[#171717] border-r border-gray-200 dark:border-white/5 overflow-hidden select-none">

        {/* Branding */}
        <div className="px-4 pt-4 pb-2 flex items-center gap-2.5">
          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-800 dark:text-white/90 truncate">
            Hack to the Future
          </span>
        </div>

        {/* New chat */}
        <div className="px-2 pb-1">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
          >
            <Plus className="h-4 w-4 flex-shrink-0" />
            New chat
          </button>
        </div>

        {/* Nav links */}
        <div className="px-2 pb-2 space-y-0.5">
          <Link
            href="/"
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
              pathname === "/"
                ? "bg-gray-200 dark:bg-white/10 text-gray-900 dark:text-white"
                : "text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200/60 dark:hover:bg-white/5"
            }`}
          >
            <MessageSquare className="h-4 w-4 flex-shrink-0" />
            Chat
          </Link>
          <Link
            href="/dashboard"
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
              pathname === "/dashboard"
                ? "bg-gray-200 dark:bg-white/10 text-gray-900 dark:text-white"
                : "text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200/60 dark:hover:bg-white/5"
            }`}
          >
            <LayoutDashboard className="h-4 w-4 flex-shrink-0" />
            Dashboard
          </Link>
        </div>

        {/* Section label */}
        {chats.length > 0 && (
          <div className="px-4 pt-2 pb-1">
            <p className="text-[10px] font-medium uppercase tracking-widest text-gray-400 dark:text-white/25">
              Recents
            </p>
          </div>
        )}

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-2">
          {chats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => handleSelectChat(chat.id)}
              className={`group relative flex items-center rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ${
                chat.id === activeChatId
                  ? "bg-gray-200 dark:bg-white/10 text-gray-900 dark:text-white"
                  : "text-gray-600 dark:text-white/50 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200/60 dark:hover:bg-white/5"
              }`}
            >
              {editingId === chat.id ? (
                <div
                  className="flex items-center gap-1 w-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") cancelEdit();
                    }}
                    className="flex-1 bg-transparent outline-none text-sm min-w-0 text-gray-900 dark:text-white"
                  />
                  <button
                    onClick={commitEdit}
                    className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 p-0.5 flex-shrink-0"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="text-gray-400 dark:text-white/40 hover:text-gray-600 dark:hover:text-white/70 p-0.5 flex-shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="flex-1 truncate pr-10">{chat.name}</span>
                  <div className="absolute right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => startEdit(chat.id, chat.name, e)}
                      className="p-1 rounded hover:bg-gray-300/60 dark:hover:bg-white/10 text-gray-400 dark:text-white/40 hover:text-gray-700 dark:hover:text-white"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteChat(chat.id);
                      }}
                      className="p-1 rounded hover:bg-gray-300/60 dark:hover:bg-white/10 text-gray-400 dark:text-white/40 hover:text-red-500 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Theme toggle */}
        <div className="px-2 pb-4 pt-2 border-t border-gray-200 dark:border-white/5">
          <button
            onClick={onToggleTheme}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200/60 dark:hover:bg-white/10 transition-colors"
          >
            {isDark ? (
              <>
                <Sun className="h-4 w-4 flex-shrink-0" />
                Light mode
              </>
            ) : (
              <>
                <Moon className="h-4 w-4 flex-shrink-0" />
                Dark mode
              </>
            )}
          </button>
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize group z-10"
      >
        <div className="h-full w-full group-hover:bg-gray-400/30 dark:group-hover:bg-white/15 transition-colors" />
      </div>
    </div>
  );
}
