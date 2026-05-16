"use client";

import { useCallback, useRef, useState } from "react";
import { Check, FilePlus, LogOut, Pencil, Pin, PinOff, Plus, Settings, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useChatContext } from "@/context/ChatContext";
import { useAuth } from "@/context/AuthContext";

export function Sidebar() {
  const {
    chats, activeChatId, newChat, selectChat, renameChat, deleteChat, pinChat,
    reports, activeReportId, addReport, selectReport, renameReport, deleteReport, pinReport,
    sidebarWidth, setSidebarWidth, isSidebarOpen, setIsSidebarOpen,
  } = useChatContext();
  const { profile, signOut } = useAuth();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const isDashboard = pathname === "/dashboard";

  const goToChat = (id: string) => {
    selectChat(id);
    if (pathname === "/settings") router.push("/");
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const goToNewChat = () => {
    newChat();
    if (pathname === "/settings") router.push("/");
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const handleAddReport = () => {
    addReport();
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const handleSelectReport = (id: string) => {
    selectReport(id);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };
  const widthRef = useRef(sidebarWidth);
  widthRef.current = sidebarWidth;

  // ── Resize ────────────────────────────────────────────────────────────────

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = widthRef.current;
      const handleMove = (ev: MouseEvent) =>
        setSidebarWidth(Math.min(400, Math.max(180, startWidth + ev.clientX - startX)));
      const handleUp = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [setSidebarWidth]
  );

  // ── Inline rename ─────────────────────────────────────────────────────────

  const startEdit = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditValue(name);
  };

  const commitEdit = (rename: (id: string, name: string) => void) => {
    if (editingId && editValue.trim()) rename(editingId, editValue.trim());
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  // ── Section label ─────────────────────────────────────────────────────────

  function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
      <div className="px-4 pt-3 pb-1">
        <p className="text-[10px] font-medium uppercase tracking-widest text-gray-400 dark:text-white/25">
          {children}
        </p>
      </div>
    );
  }

  // ── Item list ─────────────────────────────────────────────────────────────

  function ItemList({
    items,
    activeId,
    onSelect,
    onRename,
    onDelete,
    onPin,
  }: {
    items: { id: string; name: string; pinned?: boolean }[];
    activeId: string | null;
    onSelect: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    onPin: (id: string) => void;
  }) {
    return (
      <>
        {items.map((item) => (
          <div
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={`group relative flex items-center rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ${
              item.id === activeId
                ? "bg-gray-200 dark:bg-white/10 text-gray-900 dark:text-white"
                : "text-gray-600 dark:text-white/50 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200/60 dark:hover:bg-white/5"
            }`}
          >
            {editingId === item.id ? (
              <div
                className="flex items-center gap-1 w-full"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit(onRename);
                    if (e.key === "Escape") cancelEdit();
                  }}
                  className="flex-1 bg-transparent outline-none text-sm min-w-0 text-gray-900 dark:text-white"
                />
                <button
                  onClick={() => commitEdit(onRename)}
                  className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 p-0.5 flex-shrink-0"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={cancelEdit}
                  className="text-gray-400 dark:text-white/40 hover:text-gray-600 p-0.5 flex-shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                <span className="flex-1 truncate pr-14">{item.name}</span>
                <div className="absolute right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); onPin(item.id); }}
                    title={item.pinned ? "Unpin" : "Pin"}
                    className="p-1 rounded hover:bg-gray-300/60 dark:hover:bg-white/10 text-gray-400 dark:text-white/40 hover:text-blue-500 dark:hover:text-blue-400"
                  >
                    {item.pinned
                      ? <PinOff className="h-3 w-3" />
                      : <Pin className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={(e) => startEdit(item.id, item.name, e)}
                    className="p-1 rounded hover:bg-gray-300/60 dark:hover:bg-white/10 text-gray-400 dark:text-white/40 hover:text-gray-700 dark:hover:text-white"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                    className="p-1 rounded hover:bg-gray-300/60 dark:hover:bg-white/10 text-gray-400 dark:text-white/40 hover:text-red-500 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </>
    );
  }

  // ── Split helpers ─────────────────────────────────────────────────────────

  const pinnedChats = chats.filter((c) => c.pinned);
  const recentChats = chats.filter((c) => !c.pinned);
  const pinnedReports = reports.filter((r) => r.pinned);
  const recentReports = reports.filter((r) => !r.pinned);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Mobile Backdrop */}
      {isSidebarOpen && (
        <div
          className="md:hidden absolute inset-0 z-20 bg-black/50 transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <div
        className={`absolute md:relative flex-shrink-0 h-full z-30 flex transition-all duration-300 ease-in-out overflow-hidden ${
          isSidebarOpen 
            ? "translate-x-0 w-[var(--sidebar-width)]" 
            : "-translate-x-full w-[var(--sidebar-width)] md:translate-x-0 md:w-0"
        }`}
        style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
      >
        <div 
          className="flex-1 flex flex-col h-full bg-gray-100 dark:bg-[#171717] border-r border-gray-200 dark:border-white/5 overflow-hidden select-none w-[var(--sidebar-width)]"
        >

        {isDashboard ? (
          /* ── Dashboard mode ─────────────────────────────── */
          <>
            <div className="px-2 pt-3 pb-1">
              <button
                onClick={handleAddReport}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
              >
                <FilePlus className="h-4 w-4 flex-shrink-0" />
                Add report
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pb-4">
              {pinnedReports.length > 0 && (
                <>
                  <SectionLabel>Pinned</SectionLabel>
                  <div className="px-2 space-y-0.5">
                    <ItemList
                      items={pinnedReports}
                      activeId={activeReportId}
                      onSelect={handleSelectReport}
                      onRename={renameReport}
                      onDelete={deleteReport}
                      onPin={pinReport}
                    />
                  </div>
                </>
              )}

              {recentReports.length > 0 && (
                <>
                  <SectionLabel>Previous reports</SectionLabel>
                  <div className="px-2 space-y-0.5">
                    <ItemList
                      items={recentReports}
                      activeId={activeReportId}
                      onSelect={handleSelectReport}
                      onRename={renameReport}
                      onDelete={deleteReport}
                      onPin={pinReport}
                    />
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          /* ── AI Assistant mode ──────────────────────────── */
          <>
            <div className="px-2 pt-3 pb-1">
              <button
                onClick={goToNewChat}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
              >
                <Plus className="h-4 w-4 flex-shrink-0" />
                New chat
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pb-4">
              {pinnedChats.length > 0 && (
                <>
                  <SectionLabel>Pinned</SectionLabel>
                  <div className="px-2 space-y-0.5">
                    <ItemList
                      items={pinnedChats}
                      activeId={activeChatId}
                      onSelect={goToChat}
                      onRename={renameChat}
                      onDelete={deleteChat}
                      onPin={pinChat}
                    />
                  </div>
                </>
              )}

              {recentChats.length > 0 && (
                <>
                  <SectionLabel>Recents</SectionLabel>
                  <div className="px-2 space-y-0.5">
                    <ItemList
                      items={recentChats}
                      activeId={activeChatId}
                      onSelect={goToChat}
                      onRename={renameChat}
                      onDelete={deleteChat}
                      onPin={pinChat}
                    />
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ── Bottom: settings + user profile ──────────────── */}
        <UserSection profile={profile} signOut={signOut} setIsSidebarOpen={setIsSidebarOpen} />

      </div>

      {/* Resize handle (desktop only) */}
      <div
        onMouseDown={startResize}
        className="hidden md:block absolute top-0 right-0 w-1 h-full cursor-col-resize group z-10"
      >
        <div className="h-full w-full group-hover:bg-gray-400/30 dark:group-hover:bg-white/15 transition-colors" />
      </div>
    </div>
    </>
  );
}

function UserSection({
  profile,
  signOut,
  setIsSidebarOpen,
}: {
  profile: ReturnType<typeof useAuth>["profile"];
  signOut: () => void;
  setIsSidebarOpen: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const initials = profile?.display_name
    ? profile.display_name.slice(0, 2).toUpperCase()
    : (profile?.email?.slice(0, 2).toUpperCase() ?? "?");
  const displayName = profile?.display_name ?? profile?.email ?? "";

  return (
    <div className="flex-shrink-0 border-t border-gray-200 dark:border-white/5 pt-1 pb-2 px-2 space-y-0.5">
      {/* Settings link */}
      <Link
        href="/settings"
        onClick={() => {
          if (window.innerWidth < 768) setIsSidebarOpen(false);
        }}
        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
          pathname === "/settings"
            ? "bg-gray-200 dark:bg-white/10 text-gray-900 dark:text-white"
            : "text-gray-600 dark:text-white/50 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-white/10"
        }`}
      >
        <Settings className="h-4 w-4 flex-shrink-0" />
        Settings
      </Link>

      <div className="group flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-200/60 dark:hover:bg-white/5 transition-colors">
        {profile?.avatar_url ? (
          <img
            src={profile.avatar_url}
            className="h-7 w-7 rounded-full flex-shrink-0 object-cover border border-gray-200 dark:border-white/10 shadow-sm"
            alt={displayName}
          />
        ) : (
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 shadow-sm">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-900 dark:text-white truncate leading-tight">
            {displayName}
          </p>
          {profile?.display_name && (
            <p className="text-[10px] text-gray-500 dark:text-white/30 truncate leading-tight">
              {profile.email}
            </p>
          )}
        </div>
        <button
          onClick={signOut}
          title="Sign out"
          className="opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-300/60 dark:hover:bg-white/10 text-gray-400 dark:text-white/40 hover:text-red-500 dark:hover:text-red-400 flex-shrink-0"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
