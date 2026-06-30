"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import {
  Loader2,
  MessageCircle,
  SendHorizontal,
  X,
} from "lucide-react";

import {
  supportChatChannelName,
  supportChatStatusLabels,
  supportChatStorageKey,
  type SupportChatConversation,
  type SupportChatMessage,
} from "@/lib/support-chat";
import { createClient } from "@/lib/supabase/client";

type ChatApiPayload = {
  conversation: SupportChatConversation | null;
  messages: SupportChatMessage[];
  error?: string;
};

type SendApiPayload = {
  conversation?: SupportChatConversation;
  message?: SupportChatMessage;
  error?: string;
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

export function ChatbotWidget() {
  const pathname = usePathname();
  const supabase = React.useMemo(() => createClient(), []);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [accessToken, setAccessToken] = React.useState<string | null>(null);
  const [conversation, setConversation] =
    React.useState<SupportChatConversation | null>(null);
  const [messages, setMessages] = React.useState<SupportChatMessage[]>([]);
  const [draft, setDraft] = React.useState("");
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const channelRef = React.useRef<ReturnType<typeof supabase.channel> | null>(
    null,
  );

  const hiddenRoute =
    pathname.startsWith("/admin") || pathname.startsWith("/pay/inicis");

  const loadConversation = React.useCallback(
    async (
      token?: string | null,
      options?: { quiet?: boolean; markRead?: boolean },
    ) => {
      if (!options?.quiet) {
        setLoading(true);
      }
      setError(null);
      try {
        const params = new URLSearchParams();
        if (token) {
          params.set("accessToken", token);
        }
        if (options?.markRead) {
          params.set("markRead", "visitor");
        }
        const query = params.toString();
        const response = await fetch(`/api/chat${query ? `?${query}` : ""}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | ChatApiPayload
          | null;
        if (!response.ok || !payload) {
          throw new Error(payload?.error ?? "채팅 내역을 불러오지 못했습니다.");
        }
        if (payload.conversation) {
          setConversation(payload.conversation);
          setAccessToken(payload.conversation.accessToken);
          window.localStorage.setItem(
            supportChatStorageKey,
            payload.conversation.accessToken,
          );
        } else if (token) {
          setConversation(null);
          setAccessToken(null);
          window.localStorage.removeItem(supportChatStorageKey);
        }
        setMessages(payload.messages ?? []);
      } catch (loadError) {
        if (!options?.quiet) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "채팅 내역을 불러오지 못했습니다.",
          );
        }
      } finally {
        if (!options?.quiet) {
          setLoading(false);
        }
      }
    },
    [],
  );

  React.useEffect(() => {
    if (hiddenRoute) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(supportChatStorageKey);
    } catch {
      // Ignore storage failures.
    }
    if (stored) {
      setAccessToken(stored);
    }
    void loadConversation(stored, { quiet: true });
  }, [hiddenRoute, loadConversation]);

  React.useEffect(() => {
    if (!conversation || !accessToken) return;
    const channel = supabase
      .channel(supportChatChannelName(conversation.id, accessToken), {
        config: { broadcast: { self: false } },
      })
      .on("broadcast", { event: "message" }, () => {
        void loadConversation(accessToken, {
          quiet: true,
          markRead: open,
        });
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [accessToken, conversation, loadConversation, open, supabase]);

  React.useEffect(() => {
    if (!accessToken || hiddenRoute) return;
    const intervalId = window.setInterval(() => {
      void loadConversation(accessToken, { quiet: true });
    }, 15000);
    return () => window.clearInterval(intervalId);
  }, [accessToken, hiddenRoute, loadConversation]);

  React.useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, open]);

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        void loadConversation(accessToken, {
          quiet: true,
          markRead: true,
        });
      }
      return next;
    });
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
          accessToken,
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
      setAccessToken(payload.conversation.accessToken);
      window.localStorage.setItem(
        supportChatStorageKey,
        payload.conversation.accessToken,
      );
      setMessages((current) => mergeMessage(current, payload.message!));
      setDraft("");

      await channelRef.current?.send({
        type: "broadcast",
        event: "message",
        payload,
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

  if (hiddenRoute) {
    return null;
  }

  const statusLabel = conversation
    ? supportChatStatusLabels[conversation.status] ?? conversation.status
    : "상담 가능";

  return (
    <>
      {open ? (
        <div
          className="fixed bottom-5 right-4 z-50 flex max-h-[calc(100vh-var(--site-header-height,76px)-24px)] w-[min(380px,calc(100vw-32px))] flex-col overflow-hidden rounded-[12px] border-2 border-[#111111] bg-card shadow-[7px_7px_0_#111111] dark:border-[#f2cf27] dark:shadow-[7px_7px_0_#f2cf27] sm:bottom-6 sm:right-6"
          role="dialog"
          aria-label="실시간 채팅"
        >
          <div className="flex items-center justify-between gap-3 border-b-2 border-[#111111] bg-[#111111] px-4 py-3 text-white dark:border-[#f2cf27]">
            <div className="min-w-0">
              <p className="text-sm font-black">온사이드 실시간 채팅</p>
              <p className="mt-0.5 text-[11px] font-semibold text-white/70">
                관리자와 바로 대화할 수 있습니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-white/30 text-white transition hover:bg-white hover:text-[#111111]"
              aria-label="채팅 닫기"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-background px-4 py-2">
            <span className="inline-flex items-center gap-2 text-xs font-black text-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {statusLabel}
            </span>
            <span className="text-[11px] font-semibold text-muted-foreground">
              보통 영업시간 내 답변
            </span>
          </div>

          <div
            ref={listRef}
            className="min-h-[300px] flex-1 space-y-3 overflow-y-auto bg-background/60 px-4 py-4"
          >
            {loading ? (
              <div className="flex h-32 items-center justify-center text-sm font-semibold text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                채팅을 불러오는 중입니다.
              </div>
            ) : messages.length > 0 ? (
              messages.map((message) => {
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
                    문의 내용을 바로 남겨주세요. 로그인 상태라면 이후에도 대화
                    내역을 이어서 확인할 수 있습니다.
                  </p>
                </div>
              </div>
            )}
          </div>

          {error ? (
            <div className="border-t border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-600">
              {error}
            </div>
          ) : null}

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
        </div>
      ) : null}

      {!open ? (
        <button
          type="button"
          onClick={toggleOpen}
          className="fixed bottom-5 right-4 z-50 inline-flex min-h-12 items-center gap-2 rounded-[12px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-3 text-sm font-black text-[#111111] shadow-[5px_5px_0_#111111] transition hover:-translate-y-0.5 dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27] sm:bottom-6 sm:right-6"
        >
          {conversation?.unreadVisitorCount ? (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#111111] bg-[#d9362c] px-1 text-[10px] font-black text-white">
              {conversation.unreadVisitorCount}
            </span>
          ) : null}
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
          실시간 채팅
        </button>
      ) : null}
    </>
  );
}
