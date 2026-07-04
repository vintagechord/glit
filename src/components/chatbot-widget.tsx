"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Home,
  Loader2,
  LogOut,
  MessageCircle,
  MoreVertical,
  SendHorizontal,
  X,
} from "lucide-react";

import {
  supportChatAdminChannelName,
  supportChatChannelName,
  supportChatConversationTokensStorageKey,
  supportChatStatusLabels,
  supportChatStorageKey,
  type SupportChatBroadcastPayload,
  type SupportChatConversation,
  type SupportChatMessage,
} from "@/lib/support-chat";
import { createClient } from "@/lib/supabase/client";

type ChatView = "home" | "conversations" | "thread";

type ChatApiPayload = {
  conversation: SupportChatConversation | null;
  messages: SupportChatMessage[];
  error?: string;
};

type ChatListApiPayload = {
  conversations?: SupportChatConversation[];
  error?: string;
};

type SendApiPayload = {
  conversation?: SupportChatConversation;
  message?: SupportChatMessage;
  error?: string;
};

type LeaveApiPayload = {
  ok?: boolean;
  leftId?: string | null;
  conversation?: SupportChatConversation;
  message?: SupportChatMessage;
  error?: string;
};

const maxStoredConversationTokens = 50;

const normalizeTokenList = (tokens: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      tokens
        .map((token) => token?.trim() ?? "")
        .filter((token) => token.length >= 20),
    ),
  ).slice(0, maxStoredConversationTokens);

const readStoredConversationTokens = () => {
  if (typeof window === "undefined") return [];

  const tokens: string[] = [];
  try {
    const rawTokens = window.localStorage.getItem(
      supportChatConversationTokensStorageKey,
    );
    if (rawTokens) {
      const parsed = JSON.parse(rawTokens) as unknown;
      if (Array.isArray(parsed)) {
        tokens.push(...parsed.filter((item): item is string => typeof item === "string"));
      } else if (typeof parsed === "string") {
        tokens.push(parsed);
      }
    }

    const legacyToken = window.localStorage.getItem(supportChatStorageKey);
    if (legacyToken) {
      tokens.unshift(legacyToken);
    }
  } catch {
    // Ignore storage failures.
  }

  return normalizeTokenList(tokens);
};

const writeStoredConversationTokens = (
  tokens: string[],
  preferredActiveToken?: string | null,
) => {
  if (typeof window === "undefined") return;

  const normalizedTokens = normalizeTokenList(tokens);
  try {
    if (normalizedTokens.length > 0) {
      window.localStorage.setItem(
        supportChatConversationTokensStorageKey,
        JSON.stringify(normalizedTokens),
      );
    } else {
      window.localStorage.removeItem(supportChatConversationTokensStorageKey);
    }

    const nextActiveToken =
      preferredActiveToken && normalizedTokens.includes(preferredActiveToken)
        ? preferredActiveToken
        : normalizedTokens[0] ?? null;
    if (nextActiveToken) {
      window.localStorage.setItem(supportChatStorageKey, nextActiveToken);
    } else {
      window.localStorage.removeItem(supportChatStorageKey);
    }
  } catch {
    // Ignore storage failures.
  }
};

const formatMessageTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(date);
};

const formatConversationDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(date);
};

const mergeMessage = (
  messages: SupportChatMessage[],
  nextMessage: SupportChatMessage,
) => {
  if (messages.some((message) => message.id === nextMessage.id)) {
    return messages;
  }
  return [...messages, nextMessage].sort(
    (a, b) =>
      new Date(a.createdAt ?? 0).getTime() -
      new Date(b.createdAt ?? 0).getTime(),
  );
};

const sortConversations = (items: SupportChatConversation[]) =>
  [...items].sort(
    (a, b) =>
      new Date(b.lastMessageAt ?? b.updatedAt ?? 0).getTime() -
      new Date(a.lastMessageAt ?? a.updatedAt ?? 0).getTime(),
  );

const upsertConversation = (
  items: SupportChatConversation[],
  nextConversation: SupportChatConversation,
) => {
  const exists = items.some((item) => item.id === nextConversation.id);
  const next = exists
    ? items.map((item) =>
        item.id === nextConversation.id ? nextConversation : item,
      )
    : [nextConversation, ...items];
  return sortConversations(next);
};

const isDocumentVisible = () =>
  typeof document === "undefined" || document.visibilityState === "visible";

const getConversationPreview = (conversation: SupportChatConversation) =>
  conversation.lastMessagePreview || "새 문의를 시작했습니다.";

export function ChatbotWidget() {
  const pathname = usePathname();
  const supabase = React.useMemo(() => createClient(), []);
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<ChatView>("home");
  const [showHours, setShowHours] = React.useState(false);
  const [loadingList, setLoadingList] = React.useState(false);
  const [loadingThread, setLoadingThread] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [storedTokens, setStoredTokens] = React.useState<string[]>([]);
  const [activeToken, setActiveToken] = React.useState<string | null>(null);
  const [conversation, setConversation] =
    React.useState<SupportChatConversation | null>(null);
  const [conversations, setConversations] = React.useState<
    SupportChatConversation[]
  >([]);
  const [messages, setMessages] = React.useState<SupportChatMessage[]>([]);
  const [draft, setDraft] = React.useState("");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const threadRef = React.useRef<HTMLDivElement | null>(null);
  const channelRef = React.useRef<ReturnType<typeof supabase.channel> | null>(
    null,
  );
  const adminChannelRef = React.useRef<ReturnType<typeof supabase.channel> | null>(
    null,
  );
  const storedTokensRef = React.useRef<string[]>([]);
  const activeTokenRef = React.useRef<string | null>(null);
  const activeConversationIdRef = React.useRef<string | null>(null);
  const conversationsRef = React.useRef<SupportChatConversation[]>([]);
  const listRequestIdRef = React.useRef(0);
  const threadRequestIdRef = React.useRef(0);

  const normalizedPathname = pathname.startsWith("/en/")
    ? pathname.replace(/^\/en(?=\/)/, "")
    : pathname;
  const hiddenRoute =
    normalizedPathname.startsWith("/admin") ||
    normalizedPathname.startsWith("/pay/inicis") ||
    normalizedPathname === "/login" ||
    normalizedPathname === "/signup" ||
    normalizedPathname === "/forgot-password" ||
    normalizedPathname === "/reset-password";
  const activeConversationId = conversation?.id ?? null;
  const totalUnread = conversations.reduce(
    (sum, item) => sum + item.unreadVisitorCount,
    0,
  );

  React.useEffect(() => {
    storedTokensRef.current = storedTokens;
  }, [storedTokens]);

  React.useEffect(() => {
    activeTokenRef.current = activeToken;
  }, [activeToken]);

  React.useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  React.useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const rememberAccessToken = React.useCallback(
    (token: string, options?: { active?: boolean }) => {
      setStoredTokens((current) => {
        const nextTokens = normalizeTokenList([token, ...current]);
        writeStoredConversationTokens(
          nextTokens,
          options?.active === false ? activeTokenRef.current : token,
        );
        return nextTokens;
      });
      if (options?.active !== false) {
        setActiveToken(token);
      }
    },
    [],
  );

  const forgetAccessToken = React.useCallback((token: string) => {
    setStoredTokens((current) => {
      const nextTokens = current.filter((item) => item !== token);
      writeStoredConversationTokens(
        nextTokens,
        activeTokenRef.current === token ? nextTokens[0] ?? null : activeTokenRef.current,
      );
      return nextTokens;
    });
    if (activeTokenRef.current === token) {
      setActiveToken(null);
    }
  }, []);

  const syncStoredTokensFromConversations = React.useCallback(
    (items: SupportChatConversation[]) => {
      const nextTokens = normalizeTokenList(
        items.map((item) => item.accessToken),
      );
      setStoredTokens(nextTokens);
      writeStoredConversationTokens(nextTokens, activeTokenRef.current);
    },
    [],
  );

  const clearActiveThread = React.useCallback(() => {
    setConversation(null);
    setActiveToken(null);
    setMessages([]);
    setDraft("");
    setMenuOpen(false);
  }, []);

  const loadConversationList = React.useCallback(
    async (options?: { quiet?: boolean; tokens?: string[] }) => {
      const requestId = ++listRequestIdRef.current;
      if (!options?.quiet) {
        setLoadingList(true);
      }
      setError(null);
      try {
        const params = new URLSearchParams({ list: "1" });
        for (const token of options?.tokens ?? storedTokensRef.current) {
          params.append("accessToken", token);
        }
        const response = await fetch(`/api/chat?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | ChatListApiPayload
          | null;
        if (!response.ok || !payload) {
          throw new Error(payload?.error ?? "채팅 목록을 불러오지 못했습니다.");
        }
        if (requestId !== listRequestIdRef.current) return;
        const nextConversations = sortConversations(payload.conversations ?? []);
        setConversations(nextConversations);
        syncStoredTokensFromConversations(nextConversations);
      } catch (loadError) {
        if (!options?.quiet && requestId === listRequestIdRef.current) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "채팅 목록을 불러오지 못했습니다.",
          );
        }
      } finally {
        if (!options?.quiet && requestId === listRequestIdRef.current) {
          setLoadingList(false);
        }
      }
    },
    [syncStoredTokensFromConversations],
  );

  const loadConversation = React.useCallback(
    async (
      token?: string | null,
      options?: { quiet?: boolean; markRead?: boolean },
    ) => {
      if (!token) return;

      const requestId = ++threadRequestIdRef.current;
      if (!options?.quiet) {
        setLoadingThread(true);
      }
      setError(null);
      try {
        const params = new URLSearchParams({ accessToken: token });
        if (options?.markRead) {
          params.set("markRead", "visitor");
        }
        const response = await fetch(`/api/chat?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | ChatApiPayload
          | null;
        if (!response.ok || !payload) {
          throw new Error(payload?.error ?? "채팅 내역을 불러오지 못했습니다.");
        }
        if (requestId !== threadRequestIdRef.current) return;
        if (payload.conversation) {
          setConversation(payload.conversation);
          setConversations((current) =>
            upsertConversation(current, payload.conversation!),
          );
          rememberAccessToken(payload.conversation.accessToken);
        } else {
          forgetAccessToken(token);
          if (activeTokenRef.current === token) {
            clearActiveThread();
          }
        }
        setMessages(payload.messages ?? []);
      } catch (loadError) {
        if (!options?.quiet && requestId === threadRequestIdRef.current) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "채팅 내역을 불러오지 못했습니다.",
          );
        }
      } finally {
        if (!options?.quiet && requestId === threadRequestIdRef.current) {
          setLoadingThread(false);
        }
      }
    },
    [clearActiveThread, forgetAccessToken, rememberAccessToken],
  );

  const applyBroadcastPayload = React.useCallback(
    (payload?: SupportChatBroadcastPayload | null) => {
      if (!payload) return false;

      if (payload.deletedId) {
        const deletedConversation = conversationsRef.current.find(
          (item) => item.id === payload.deletedId,
        );
        if (deletedConversation) {
          forgetAccessToken(deletedConversation.accessToken);
        }
        setConversations((current) =>
          current.filter((item) => item.id !== payload.deletedId),
        );
        if (payload.deletedId === activeConversationIdRef.current) {
          clearActiveThread();
          setView("conversations");
        }
        return Boolean(deletedConversation);
      }

      const nextConversation = payload.conversation;
      const knownConversation =
        nextConversation &&
        (storedTokensRef.current.includes(nextConversation.accessToken) ||
          nextConversation.accessToken === activeTokenRef.current);

      if (nextConversation && knownConversation) {
        if (nextConversation.visitorLeftAt) {
          forgetAccessToken(nextConversation.accessToken);
          setConversations((current) =>
            current.filter((item) => item.id !== nextConversation.id),
          );
        } else {
          setConversations((current) =>
            upsertConversation(current, nextConversation),
          );
          if (nextConversation.accessToken === activeTokenRef.current) {
            setConversation(nextConversation);
          }
        }
      }

      if (
        payload.message &&
        payload.message.conversationId === activeConversationIdRef.current
      ) {
        setMessages((current) => mergeMessage(current, payload.message!));
      }

      return Boolean(knownConversation || payload.message);
    },
    [clearActiveThread, forgetAccessToken],
  );

  const handleConversationBroadcast = React.useCallback(
    (payload?: SupportChatBroadcastPayload | null) => {
      const handled = applyBroadcastPayload(payload);
      const conversationId =
        payload?.message?.conversationId ?? payload?.conversation?.id ?? null;

      if (
        conversationId &&
        conversationId === activeConversationIdRef.current &&
        activeTokenRef.current &&
        open &&
        view === "thread" &&
        isDocumentVisible()
      ) {
        void loadConversation(activeTokenRef.current, {
          quiet: true,
          markRead: true,
        });
      } else if (!handled && (open || storedTokensRef.current.length > 0)) {
        void loadConversationList({ quiet: true });
      }
    },
    [applyBroadcastPayload, loadConversation, loadConversationList, open, view],
  );

  const broadcastChatUpdate = React.useCallback(
    async (payload: SupportChatBroadcastPayload) => {
      const broadcast = {
        type: "broadcast" as const,
        event: "message",
        payload,
      };
      await Promise.allSettled(
        [channelRef.current, adminChannelRef.current]
          .filter(Boolean)
          .map((channel) => channel!.send(broadcast)),
      );
    },
    [],
  );

  React.useEffect(() => {
    if (hiddenRoute) return;

    const tokens = readStoredConversationTokens();
    setStoredTokens(tokens);
    if (tokens.length > 0) {
      setActiveToken(tokens[0]);
      void loadConversationList({ quiet: true, tokens });
    }
  }, [hiddenRoute, loadConversationList]);

  React.useEffect(() => {
    if (hiddenRoute || (!open && storedTokens.length === 0)) return;

    const channel = supabase
      .channel(supportChatAdminChannelName, {
        config: { broadcast: { self: false } },
      })
      .on("broadcast", { event: "message" }, (event) => {
        handleConversationBroadcast(
          event.payload as SupportChatBroadcastPayload | undefined,
        );
      })
      .subscribe();
    adminChannelRef.current = channel;
    return () => {
      adminChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [
    handleConversationBroadcast,
    hiddenRoute,
    open,
    storedTokens.length,
    supabase,
  ]);

  React.useEffect(() => {
    if (!activeConversationId || !activeToken || hiddenRoute) return;
    const channel = supabase
      .channel(supportChatChannelName(activeConversationId, activeToken), {
        config: { broadcast: { self: false } },
      })
      .on("broadcast", { event: "message" }, (event) => {
        handleConversationBroadcast(
          event.payload as SupportChatBroadcastPayload | undefined,
        );
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [
    activeConversationId,
    activeToken,
    handleConversationBroadcast,
    hiddenRoute,
    supabase,
  ]);

  React.useEffect(() => {
    if (hiddenRoute || (!open && storedTokens.length === 0)) return;

    const intervalId = window.setInterval(() => {
      if (!isDocumentVisible()) return;
      void loadConversationList({ quiet: true });
      if (open && view === "thread" && activeTokenRef.current) {
        void loadConversation(activeTokenRef.current, {
          quiet: true,
          markRead: true,
        });
      }
    }, 30000);

    const handleVisibilityChange = () => {
      if (!isDocumentVisible()) return;
      void loadConversationList({ quiet: true });
      if (open && view === "thread" && activeTokenRef.current) {
        void loadConversation(activeTokenRef.current, {
          quiet: true,
          markRead: true,
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    hiddenRoute,
    loadConversation,
    loadConversationList,
    open,
    storedTokens.length,
    view,
  ]);

  React.useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, open, view]);

  React.useEffect(() => {
    setOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      setMenuOpen(false);
      return;
    }
    setOpen(true);
    void loadConversationList();
    if (view === "thread" && activeTokenRef.current) {
      void loadConversation(activeTokenRef.current, {
        quiet: true,
        markRead: true,
      });
    }
  };

  const startNewConversation = () => {
    clearActiveThread();
    setError(null);
    setView("thread");
  };

  const openConversation = (nextConversation: SupportChatConversation) => {
    setConversation(nextConversation);
    setMessages([]);
    setError(null);
    setMenuOpen(false);
    setView("thread");
    rememberAccessToken(nextConversation.accessToken);
    void loadConversation(nextConversation.accessToken, { markRead: true });
  };

  const goBackFromThread = () => {
    setMenuOpen(false);
    setView(conversations.length > 0 ? "conversations" : "home");
  };

  const sendMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(activeToken ? { accessToken: activeToken } : {}),
          body,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | SendApiPayload
        | null;
      if (!response.ok || !payload?.conversation || !payload.message) {
        throw new Error(payload?.error ?? "메시지를 보내지 못했습니다.");
      }

      setConversation(payload.conversation);
      setConversations((current) =>
        upsertConversation(current, payload.conversation!),
      );
      rememberAccessToken(payload.conversation.accessToken);
      setMessages((current) => mergeMessage(current, payload.message!));
      setDraft("");
      setView("thread");

      await broadcastChatUpdate({
        conversation: payload.conversation,
        message: payload.message,
      });
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "메시지를 보내지 못했습니다.",
      );
    } finally {
      setSending(false);
    }
  };

  const leaveConversation = async () => {
    setMenuOpen(false);

    if (!activeToken || !conversation) {
      clearActiveThread();
      setView(conversations.length > 0 ? "conversations" : "home");
      return;
    }

    const confirmed = window.confirm(
      "이 채팅창을 나가면 사용자 대화 목록에서 사라집니다. 채팅창을 나갈까요?",
    );
    if (!confirmed) return;

    setLeaving(true);
    setError(null);
    try {
      const response = await fetch("/api/chat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: activeToken }),
      });
      const payload = (await response.json().catch(() => null)) as
        | LeaveApiPayload
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "채팅창을 나가지 못했습니다.");
      }

      if (payload.conversation || payload.message) {
        await broadcastChatUpdate({
          conversation: payload.conversation,
          message: payload.message,
        });
      }

      const leftId = payload.leftId ?? conversation.id;
      const nextConversations = conversations.filter((item) => item.id !== leftId);
      setConversations(nextConversations);
      forgetAccessToken(activeToken);
      clearActiveThread();
      setView(nextConversations.length > 0 ? "conversations" : "home");
    } catch (leaveError) {
      setError(
        leaveError instanceof Error
          ? leaveError.message
          : "채팅창을 나가지 못했습니다.",
      );
    } finally {
      setLeaving(false);
    }
  };

  if (hiddenRoute) {
    return null;
  }

  const statusLabel = conversation
    ? supportChatStatusLabels[conversation.status] ?? conversation.status
    : "새 문의";
  const latestConversation = conversations[0] ?? null;

  const renderHeaderCloseButton = () => (
    <button
      type="button"
      onClick={() => setOpen(false)}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
      aria-label="채팅 닫기"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  const renderBottomNav = () => (
    <div className="grid h-[72px] shrink-0 grid-cols-2 border-t border-border/70 bg-card/95">
      <button
        type="button"
        onClick={() => {
          setMenuOpen(false);
          setView("home");
        }}
        className={`flex min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-black transition ${
          view === "home" ? "text-foreground" : "text-muted-foreground"
        }`}
        aria-label="채팅 홈"
      >
        <Home className="h-5 w-5" aria-hidden="true" />
        <span>홈</span>
      </button>
      <button
        type="button"
        onClick={() => {
          setMenuOpen(false);
          setView("conversations");
          void loadConversationList();
        }}
        className={`relative flex min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-black transition ${
          view === "conversations" ? "text-foreground" : "text-muted-foreground"
        }`}
        aria-label="대화 목록"
      >
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        {totalUnread > 0 ? (
          <span className="absolute right-[calc(50%-23px)] top-3 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#d9362c] px-1 text-[9px] font-black text-white">
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        ) : null}
        <span>대화</span>
      </button>
    </div>
  );

  const renderHome = () => (
    <>
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border-2 border-[#111111] bg-[#f2cf27] text-sm font-black text-[#111111] shadow-[3px_3px_0_#111111]">
            ON
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black text-foreground">
              온사이드
            </h2>
            <button
              type="button"
              onClick={() => setShowHours((current) => !current)}
              className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-muted-foreground transition hover:text-foreground"
            >
              운영시간 보기
              <ChevronRight
                className={`h-3.5 w-3.5 transition ${
                  showHours ? "rotate-90" : ""
                }`}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
        {renderHeaderCloseButton()}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5" ref={listRef}>
        {showHours ? (
          <div className="mb-3 flex items-center gap-2 rounded-[8px] border border-border bg-background px-3 py-2 text-xs font-bold text-muted-foreground">
            <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />
            평일 오전 10:00-오후 8:00 운영해요.
          </div>
        ) : null}

        <section className="rounded-[12px] border-2 border-[#111111] bg-card p-4 shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:shadow-[4px_4px_0_#f2cf27]">
          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-background text-[11px] font-black">
              ON
            </div>
            <div className="min-w-0 text-sm font-semibold leading-6 text-foreground">
              <p className="font-black">안녕하세요. 온사이드입니다.</p>
              <p className="mt-2">
                음반·뮤직비디오 심의 신청, 결제, 진행 상황, 제휴 문의까지
                필요한 내용을 편하게 남겨주세요.
              </p>
              <p className="mt-2 text-muted-foreground">
                상담 시간 외 문의도 남길 수 있으며, 운영 시간에 순차적으로
                답변드립니다.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={startNewConversation}
            className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-[#222222] dark:border-[#f2cf27]"
          >
            문의하기
            <SendHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        </section>

        <div className="mt-4 flex items-center justify-center gap-2 text-xs font-bold text-muted-foreground">
          <Clock3 className="h-4 w-4" aria-hidden="true" />
          오전 10:00부터 운영해요
        </div>

        {latestConversation ? (
          <button
            type="button"
            onClick={() => openConversation(latestConversation)}
            className="mt-4 w-full rounded-[10px] border border-border bg-background px-4 py-3 text-left transition hover:border-[#111111]"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="text-xs font-black text-muted-foreground">
                최근 대화
              </span>
              <span className="text-[11px] font-bold text-muted-foreground">
                {formatConversationDate(latestConversation.lastMessageAt)}
              </span>
            </span>
            <span className="mt-2 block truncate text-sm font-bold text-foreground">
              {getConversationPreview(latestConversation)}
            </span>
          </button>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-[8px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600">
            {error}
          </div>
        ) : null}
      </div>
    </>
  );

  const renderConversations = () => (
    <>
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5">
        <div>
          <h2 className="text-xl font-black text-foreground">대화</h2>
          <p className="mt-1 text-xs font-bold text-muted-foreground">
            이전 문의와 답변을 확인할 수 있습니다.
          </p>
        </div>
        {renderHeaderCloseButton()}
      </div>

      {error ? (
        <div className="mx-5 mb-3 rounded-[8px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600">
          {error}
        </div>
      ) : null}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {loadingList ? (
          <div className="flex h-40 items-center justify-center text-sm font-semibold text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            대화를 불러오는 중입니다.
          </div>
        ) : conversations.length > 0 ? (
          <div className="divide-y divide-border/70">
            {conversations.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => openConversation(item)}
                className="flex w-full items-start gap-3 px-1 py-3 text-left transition hover:bg-background"
              >
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[11px] font-black">
                  ON
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-sm font-black text-foreground">
                      온사이드
                    </span>
                    <span className="truncate text-xs font-bold text-muted-foreground">
                      {formatConversationDate(item.lastMessageAt)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-muted-foreground">
                    {getConversationPreview(item)}
                  </p>
                </div>
                {item.unreadVisitorCount > 0 ? (
                  <span className="mt-2 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#d9362c] px-1 text-[10px] font-black text-white">
                    {item.unreadVisitorCount > 99 ? "99+" : item.unreadVisitorCount}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex h-56 flex-col items-center justify-center rounded-[10px] border border-dashed border-border bg-background px-5 text-center">
            <MessageCircle className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-black text-foreground">
              아직 대화가 없습니다.
            </p>
            <p className="mt-1 text-xs font-semibold leading-5 text-muted-foreground">
              새 문의를 시작하면 이곳에서 과거 대화를 다시 볼 수 있습니다.
            </p>
          </div>
        )}
      </div>

      <div className="shrink-0 px-5 pb-4">
        <button
          type="button"
          onClick={startNewConversation}
          className="mx-auto flex h-12 items-center justify-center gap-2 rounded-full border-2 border-[#111111] bg-[#111111] px-6 text-sm font-black text-white shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 dark:border-[#f2cf27] dark:shadow-[3px_3px_0_#f2cf27]"
        >
          새 문의하기
          <SendHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </>
  );

  const renderThread = () => (
    <>
      <div className="relative flex items-center justify-between gap-3 border-b border-border/70 bg-card px-3 py-3">
        <button
          type="button"
          onClick={goBackFromThread}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-foreground transition hover:bg-muted"
          aria-label="대화 목록으로 돌아가기"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-foreground">
            온사이드
          </p>
          <p className="mt-0.5 truncate text-xs font-bold text-muted-foreground">
            {conversation ? statusLabel : "새 문의 작성 중"}
          </p>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-foreground transition hover:bg-muted"
            aria-label="채팅 설정"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <MoreVertical className="h-5 w-5" aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-11 z-20 w-44 overflow-hidden rounded-[8px] border border-border bg-popover py-1 text-popover-foreground shadow-xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => void leaveConversation()}
                disabled={leaving}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold text-[#d9362c] transition hover:bg-red-500/10 disabled:opacity-60"
              >
                {leaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                )}
                채팅창 나가기
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                창 닫기
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-background px-4 py-2">
        <span className="inline-flex items-center gap-2 text-xs font-black text-foreground">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {statusLabel}
        </span>
        <span className="text-[11px] font-semibold text-muted-foreground">
          평일 10:00-20:00
        </span>
      </div>

      {error ? (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-600">
          {error}
        </div>
      ) : null}

      <div
        ref={threadRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-background/70 px-4 py-4"
      >
        {loadingThread ? (
          <div className="flex h-full min-h-[220px] items-center justify-center text-sm font-semibold text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            대화를 불러오는 중입니다.
          </div>
        ) : messages.length > 0 ? (
          messages.map((message) => {
            if (message.senderType === "SYSTEM") {
              return (
                <div key={message.id} className="flex justify-center">
                  <div className="max-w-[82%] rounded-full bg-muted px-3 py-1 text-center text-[11px] font-bold text-muted-foreground">
                    {message.body}
                  </div>
                </div>
              );
            }

            const mine = message.senderType === "VISITOR";
            return (
              <div
                key={message.id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[82%] rounded-[10px] border-2 px-3 py-2 text-sm shadow-[3px_3px_0_rgba(17,17,17,0.18)] ${
                    mine
                      ? "border-[#111111] bg-[#f2cf27] text-[#111111]"
                      : "border-border bg-card text-foreground"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words font-semibold leading-5">
                    {message.body}
                  </p>
                  <p
                    className={`mt-1 text-right text-[10px] font-semibold ${
                      mine ? "text-[#111111]/62" : "text-muted-foreground"
                    }`}
                  >
                    {formatMessageTime(message.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="space-y-3">
            <div className="w-fit max-w-[88%] rounded-[10px] border-2 border-border bg-card px-3 py-2 text-sm shadow-[3px_3px_0_rgba(17,17,17,0.12)]">
              <p className="font-black text-foreground">온사이드 상담</p>
              <p className="mt-1 font-semibold leading-6 text-muted-foreground">
                새 문의 내용을 입력하면 관리자에게 바로 전달됩니다.
              </p>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={sendMessage} className="border-t-2 border-[#111111] bg-card p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            placeholder="메시지를 입력하세요."
            className="max-h-28 min-h-12 flex-1 resize-none rounded-[8px] border-2 border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-[#1556a4]"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
            aria-label="메시지 보내기"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <SendHorizontal className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </form>
    </>
  );

  return (
    <>
      {open ? (
        <div
          className="fixed bottom-4 right-3 z-50 flex h-[min(720px,calc(100vh-var(--site-header-height,76px)-20px))] w-[min(430px,calc(100vw-24px))] flex-col overflow-hidden rounded-[22px] border-2 border-[#111111] bg-card shadow-[7px_7px_0_#111111] dark:border-[#f2cf27] dark:shadow-[7px_7px_0_#f2cf27] sm:bottom-6 sm:right-6"
          role="dialog"
          aria-label="온사이드 실시간 채팅"
        >
          {view === "thread" ? (
            renderThread()
          ) : (
            <>
              <div className="min-h-0 flex flex-1 flex-col bg-card">
                {view === "home" ? renderHome() : renderConversations()}
              </div>
              {renderBottomNav()}
            </>
          )}
        </div>
      ) : null}

      {!open ? (
        <button
          type="button"
          onClick={toggleOpen}
          className="fixed bottom-5 right-4 z-50 inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#111111] bg-white p-0 text-sm font-black text-[#111111] shadow-[5px_5px_0_rgba(17,17,17,0.28)] transition hover:-translate-y-0.5 dark:border-white dark:bg-white dark:text-[#111111] dark:shadow-[5px_5px_0_rgba(255,255,255,0.22)] sm:bottom-6 sm:right-6 sm:w-auto sm:gap-2 sm:rounded-[12px] sm:px-4 sm:py-3"
          aria-label="실시간 채팅 열기"
        >
          {totalUnread > 0 ? (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#111111] bg-[#d9362c] px-1 text-[10px] font-black text-white">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          ) : null}
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
          <span className="hidden sm:inline">실시간 채팅</span>
        </button>
      ) : null}
    </>
  );
}
