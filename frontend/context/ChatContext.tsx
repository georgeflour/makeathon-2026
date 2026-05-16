"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  sendChatMessage,
  type ChatMessage as ApiChatMessage,
  type ChartSpec,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  chart?: ChartSpec;
}

export interface Chat {
  id: string;
  name: string;
  messages: Message[];
  createdAt: number;
  pinned?: boolean;
}

export interface Report {
  id: string;
  name: string;
  createdAt: number;
  pinned?: boolean;
}

interface ChatContextValue {
  // Chats
  chats: Chat[];
  activeChatId: string | null;
  activeChat: Chat | undefined;
  isLoading: boolean;
  newChat: () => void;
  selectChat: (id: string) => void;
  renameChat: (id: string, name: string) => void;
  deleteChat: (id: string) => Promise<void>;
  sendMessage: (text: string) => void;
  pinChat: (id: string) => void;
  // Reports
  reports: Report[];
  activeReportId: string | null;
  addReport: () => void;
  selectReport: (id: string) => void;
  renameReport: (id: string, name: string) => void;
  deleteReport: (id: string) => Promise<void>;
  pinReport: (id: string) => void;
  // Sidebar
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [mounted, setMounted] = useState(false);
  const activeChatIdRef = useRef<string | null>(null);
  activeChatIdRef.current = activeChatId;

  // Load from Supabase when user is available, fall back to localStorage
  useEffect(() => {
    if (!user) {
      setChats([]);
      setReports([]);
      setActiveChatId(null);
      setActiveReportId(null);
      return;
    }
    (async () => {
      const [{ data: chatRows }, { data: reportRows }] = await Promise.all([
        supabase.from("chat_history").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("report_history").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      ]);
      if (chatRows && chatRows.length > 0) {
        const parsed = chatRows.map((r) => {
          const msgs = (r.messages ?? []) as Message[];
          // Drop a trailing user message with no assistant reply (interrupted request)
          const clean = msgs.length > 0 && msgs[msgs.length - 1].role === "user"
            ? msgs.slice(0, -1)
            : msgs;
          return {
            id: r.id,
            name: r.name,
            messages: clean,
            createdAt: new Date(r.created_at).getTime(),
            pinned: r.pinned ?? false,
          };
        });
        setChats(parsed);
        setActiveChatId(parsed[0].id);
      } else {
        try {
          const saved = localStorage.getItem(`httf-chats-${user.id}`);
          if (saved) {
            const parsed = JSON.parse(saved) as Chat[];
            setChats(parsed);
            if (parsed.length > 0) setActiveChatId(parsed[0].id);
          }
        } catch {}
      }
      if (reportRows && reportRows.length > 0) {
        const parsed = reportRows.map((r) => ({
          id: r.id,
          name: r.name,
          createdAt: new Date(r.created_at).getTime(),
          pinned: r.pinned ?? false,
        }));
        setReports(parsed);
        setActiveReportId(parsed[0].id);
      } else {
        try {
          const saved = localStorage.getItem(`httf-reports-${user.id}`);
          if (saved) {
            const parsed = JSON.parse(saved) as Report[];
            setReports(parsed);
            if (parsed.length > 0) setActiveReportId(parsed[0].id);
          }
        } catch {}
      }
      setMounted(true);
    })();
  // Depend only on user?.id — the user object reference changes on every token
  // refresh, which would re-run this effect and restore deleted chats from DB.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Reset mounted when user changes so localStorage writes don't race with the
  // fresh Supabase load for the new session.
  useEffect(() => {
    setMounted(false);
  }, [user?.id]);

  useEffect(() => {
    if (mounted && user) localStorage.setItem(`httf-chats-${user.id}`, JSON.stringify(chats));
  }, [chats, mounted, user?.id]);

  useEffect(() => {
    if (mounted && user) localStorage.setItem(`httf-reports-${user.id}`, JSON.stringify(reports));
  }, [reports, mounted, user?.id]);

  const syncChat = useCallback(
    async (chat: Chat) => {
      if (!user) return;
      await supabase.from("chat_history").upsert({
        id: chat.id,
        user_id: user.id,
        name: chat.name,
        messages: chat.messages,
        pinned: chat.pinned ?? false,
        created_at: new Date(chat.createdAt).toISOString(),
        updated_at: new Date().toISOString(),
      });
    },
    [user]
  );

  const syncReport = useCallback(
    async (report: Report) => {
      if (!user) return;
      await supabase.from("report_history").upsert({
        id: report.id,
        user_id: user.id,
        name: report.name,
        pinned: report.pinned ?? false,
        created_at: new Date(report.createdAt).toISOString(),
        updated_at: new Date().toISOString(),
      });
    },
    [user]
  );

  // ── Chats ────────────────────────────────────────────────────────────────

  const newChat = useCallback(() => {
    const id = crypto.randomUUID();
    const chat: Chat = { id, name: "New Chat", messages: [], createdAt: Date.now() };
    setChats((prev) => [chat, ...prev]);
    setActiveChatId(id);
    syncChat(chat);
  }, [syncChat]);

  const selectChat = useCallback((id: string) => setActiveChatId(id), []);

  const renameChat = useCallback(
    (id: string, name: string) => {
      setChats((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, name } : c));
        const updated = next.find((c) => c.id === id);
        if (updated) syncChat(updated);
        return next;
      });
    },
    [syncChat]
  );

  const deleteChat = useCallback(
    async (id: string) => {
      setChats((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (activeChatIdRef.current === id) setActiveChatId(next.length > 0 ? next[0].id : null);
        return next;
      });
      if (user) await supabase.from("chat_history").delete().eq("id", id).eq("user_id", user.id);
    },
    [user]
  );

  const pinChat = useCallback(
    (id: string) => {
      setChats((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c));
        const updated = next.find((c) => c.id === id);
        if (updated) syncChat(updated);
        return next;
      });
    },
    [syncChat]
  );

  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  const sendMessage = useCallback(
    async (text: string) => {
      // Use the ref so we always read the current activeChatId, not a stale closure value
      let chatId = activeChatIdRef.current;
      let isNewChat = false;

      if (!chatId) {
        chatId = crypto.randomUUID();
        isNewChat = true;
        const newChatRow: Chat = { id: chatId, name: text.slice(0, 40), messages: [], createdAt: Date.now() };
        setChats((prev) => [newChatRow, ...prev]);
        setActiveChatId(chatId);
        syncChat(newChatRow);
      }

      const currentMessages = isNewChat
        ? []
        : chatsRef.current.find((c) => c.id === chatId)?.messages ?? [];

      const history: ApiChatMessage[] = currentMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };

      const isFirst = currentMessages.length === 0;
      const finalId = chatId;

      setChats((prev) =>
        prev.map((c) =>
          c.id !== finalId
            ? c
            : {
                ...c,
                name: isFirst ? text.slice(0, 40) : c.name,
                messages: [...c.messages, userMsg],
              }
        )
      );

      setIsLoading(true);

      try {
        const data = await sendChatMessage(text, history);
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.answer,
          chart: data.chart,
        };
        setChats((prev) => {
          const next = prev.map((c) =>
            c.id === finalId ? { ...c, messages: [...c.messages, assistantMsg] } : c
          );
          const updated = next.find((c) => c.id === finalId);
          if (updated) syncChat(updated);
          return next;
        });
      } catch (err) {
        const errorMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: err instanceof Error ? err.message : "Something went wrong.",
        };
        setChats((prev) => {
          const next = prev.map((c) =>
            c.id === finalId ? { ...c, messages: [...c.messages, errorMsg] } : c
          );
          const updated = next.find((c) => c.id === finalId);
          if (updated) syncChat(updated);
          return next;
        });
      } finally {
        setIsLoading(false);
      }
    },
    [syncChat]
  );

  // ── Reports ───────────────────────────────────────────────────────────────

  const addReport = useCallback(() => {
    const id = crypto.randomUUID();
    const report: Report = { id, name: "New Report", createdAt: Date.now() };
    setReports((prev) => [report, ...prev]);
    setActiveReportId(id);
    syncReport(report);
  }, [syncReport]);

  const selectReport = useCallback((id: string) => setActiveReportId(id), []);

  const renameReport = useCallback(
    (id: string, name: string) => {
      setReports((prev) => {
        const next = prev.map((r) => (r.id === id ? { ...r, name } : r));
        const updated = next.find((r) => r.id === id);
        if (updated) syncReport(updated);
        return next;
      });
    },
    [syncReport]
  );

  const deleteReport = useCallback(
    async (id: string) => {
      setReports((prev) => {
        const next = prev.filter((r) => r.id !== id);
        if (activeReportId === id) setActiveReportId(next.length > 0 ? next[0].id : null);
        return next;
      });
      if (user) await supabase.from("report_history").delete().eq("id", id).eq("user_id", user.id);
    },
    [activeReportId, user]
  );

  const pinReport = useCallback(
    (id: string) => {
      setReports((prev) => {
        const next = prev.map((r) => (r.id === id ? { ...r, pinned: !r.pinned } : r));
        const updated = next.find((r) => r.id === id);
        if (updated) syncReport(updated);
        return next;
      });
    },
    [syncReport]
  );

  const activeChat = chats.find((c) => c.id === activeChatId);

  return (
    <ChatContext.Provider
      value={{
        chats,
        activeChatId,
        activeChat,
        isLoading,
        newChat,
        selectChat,
        renameChat,
        deleteChat,
        sendMessage,
        pinChat,
        reports,
        activeReportId,
        addReport,
        selectReport,
        renameReport,
        deleteReport,
        pinReport,
        sidebarWidth,
        setSidebarWidth,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}
