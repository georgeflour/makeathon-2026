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
}

interface ChatContextValue {
  chats: Chat[];
  activeChatId: string | null;
  activeChat: Chat | undefined;
  isLoading: boolean;
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
  newChat: () => void;
  selectChat: (id: string) => void;
  renameChat: (id: string, name: string) => void;
  deleteChat: (id: string) => void;
  sendMessage: (text: string) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("httf-chats");
      if (saved) {
        const parsed = JSON.parse(saved) as Chat[];
        setChats(parsed);
        if (parsed.length > 0) setActiveChatId(parsed[0].id);
      }
    } catch {}
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) localStorage.setItem("httf-chats", JSON.stringify(chats));
  }, [chats, mounted]);

  const newChat = useCallback(() => {
    const id = crypto.randomUUID();
    setChats((prev) => [
      { id, name: "New Chat", messages: [], createdAt: Date.now() },
      ...prev,
    ]);
    setActiveChatId(id);
  }, []);

  const selectChat = useCallback((id: string) => {
    setActiveChatId(id);
  }, []);

  const renameChat = useCallback((id: string, name: string) => {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }, []);

  const deleteChat = useCallback(
    (id: string) => {
      setChats((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (activeChatId === id) {
          setActiveChatId(next.length > 0 ? next[0].id : null);
        }
        return next;
      });
    },
    [activeChatId]
  );

  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  const sendMessage = useCallback(
    async (text: string) => {
      let chatId = activeChatId;
      let isNewChat = false;

      if (!chatId) {
        chatId = crypto.randomUUID();
        isNewChat = true;
        setChats((prev) => [
          { id: chatId!, name: text.slice(0, 40), messages: [], createdAt: Date.now() },
          ...prev,
        ]);
        setActiveChatId(chatId);
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
        setChats((prev) =>
          prev.map((c) =>
            c.id === finalId ? { ...c, messages: [...c.messages, assistantMsg] } : c
          )
        );
      } catch (err) {
        const errorMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: err instanceof Error ? err.message : "Something went wrong.",
        };
        setChats((prev) =>
          prev.map((c) =>
            c.id === finalId ? { ...c, messages: [...c.messages, errorMsg] } : c
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [activeChatId]
  );

  const activeChat = chats.find((c) => c.id === activeChatId);

  return (
    <ChatContext.Provider
      value={{
        chats,
        activeChatId,
        activeChat,
        isLoading,
        sidebarWidth,
        setSidebarWidth,
        newChat,
        selectChat,
        renameChat,
        deleteChat,
        sendMessage,
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
