"use client";

import * as React from "react";
import {
  CheckCircle2,
  Loader2,
  MessageCircle,
  RefreshCw,
  SendHorizontal,
  Trash2,
  XCircle,
} from "lucide-react";

import {
  supportChatAdminChannelName,
  supportChatChannelName,
  supportChatStatusLabels,
  type SupportChatConversation,
  type SupportChatMessage,
  type SupportChatStatus,
} from "@/lib/support-chat";
import { createClient } from "@/lib/supabase/client";

type AdminChatClientProps = {
  initialConversations: SupportChatConversation[];
};

type ConversationListPayload = {
  conversations?: SupportChatConversation[];
  error?: string;
};

type ConversationThreadPayload = {
  conversation?: SupportChatConversation;
  messages?: SupportChatMessage[];
  error?: string;
};

type ReplyPayload = {
  conversation?: SupportChatConversation;
  message?: SupportChatMessage;
  error?: string;
};

type DeletePayload = {
  ok?: boolean;
  deletedId?: string;
  error?: string;
};

const statusTone: Record<SupportChatStatus, string> = {
  OPEN: "border-border bg-background text-foreground",
  WAITING_ADMIN: "border-[#111111] bg-[#f2cf27] text-[#111111]",
  WAITING_VISITOR: "border-[#1556a4]/30 bg-[#1556a4]/10 text-[#1556a4]",
  CLOSED: "border-border bg-muted text-muted-foreground",
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
};

const formatTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(date);
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

const getConversationTitle = (conversation: SupportChatConversation) =>
  conversation.guestName ||
  conversation.guestEmail ||
  conversation.guestPhone ||
  "방문자";

export function AdminChatClient({
  initialConversations,
}: AdminChatClientProps) {
  const supabase = React.useMemo(() => createClient(), []);
  const [conversations, setConversations] = React.useState(
    sortConversations(initialConversations),
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialConversations[0]?.id ?? null,
  );
  const [messages, setMessages] = React.useState<SupportChatMessage[]>([]);
  const [draft, setDraft] = React.useState("");
  const [loadingThread, setLoadingThread] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [savingStatus, setSavingStatus] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const threadRef = React.useRef<HTMLDivElement | null>(null);
  const channelRef = React.useRef<ReturnType<typeof supabase.channel> | null>(
    null,
  );

  const selectedConversation = React.useMemo(
    () =>
      selectedId
        ? conversations.find((conversation) => conversation.id === selectedId) ??
          null
        : null,
    [conversations, selectedId],
  );

  const loadList = React.useCallback(async (options?: { quiet?: boolean }) => {
    if (!options?.quiet) {
      setRefreshing(true);
    }
    try {
      const response = await fetch("/api/admin/chat", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | ConversationListPayload
        | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.error ?? "채팅 목록을 불러오지 못했습니다.");
      }
      setConversations(sortConversations(payload.conversations ?? []));
    } catch (listError) {
      if (!options?.quiet) {
        setError(
          listError instanceof Error
            ? listError.message
            : "채팅 목록을 불러오지 못했습니다.",
        );
      }
    } finally {
      if (!options?.quiet) {
        setRefreshing(false);
      }
    }
  }, []);

  const loadConversation = React.useCallback(
    async (conversationId: string, options?: { quiet?: boolean }) => {
      if (!options?.quiet) {
        setLoadingThread(true);
      }
      setError(null);
      try {
        const params = new URLSearchParams({ conversationId });
        const response = await fetch(`/api/admin/chat?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | ConversationThreadPayload
          | null;
        if (!response.ok || !payload?.conversation) {
          throw new Error(payload?.error ?? "대화를 불러오지 못했습니다.");
        }
        setConversations((current) =>
          upsertConversation(current, payload.conversation!),
        );
        setMessages(payload.messages ?? []);
      } catch (loadError) {
        if (!options?.quiet) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "대화를 불러오지 못했습니다.",
          );
        }
      } finally {
        if (!options?.quiet) {
          setLoadingThread(false);
        }
      }
    },
    [],
  );

  React.useEffect(() => {
    if (!selectedId && conversations[0]) {
      setSelectedId(conversations[0].id);
      return;
    }
    if (
      selectedId &&
      conversations.length > 0 &&
      !conversations.some((conversation) => conversation.id === selectedId)
    ) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations, selectedId]);

  React.useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    void loadConversation(selectedId);
  }, [loadConversation, selectedId]);

  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadList({ quiet: true });
    }, 10000);
    return () => window.clearInterval(intervalId);
  }, [loadList]);

  React.useEffect(() => {
    const channel = supabase
      .channel(supportChatAdminChannelName, {
        config: { broadcast: { self: false } },
      })
      .on("broadcast", { event: "message" }, () => {
        void loadList({ quiet: true });
        if (selectedId) {
          void loadConversation(selectedId, { quiet: true });
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadConversation, loadList, selectedId, supabase]);

  React.useEffect(() => {
    if (!selectedConversation) return;
    const channel = supabase
      .channel(
        supportChatChannelName(
          selectedConversation.id,
          selectedConversation.accessToken,
        ),
        { config: { broadcast: { self: false } } },
      )
      .on("broadcast", { event: "message" }, () => {
        void loadConversation(selectedConversation.id, { quiet: true });
        void loadList({ quiet: true });
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [loadConversation, loadList, selectedConversation, supabase]);

  React.useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, selectedId]);

  const sendReply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedConversation || sending) return;
    const body = draft.trim();
    if (!body) return;

    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          body,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | ReplyPayload
        | null;
      if (!response.ok || !payload?.conversation || !payload.message) {
        throw new Error(payload?.error ?? "답변을 보내지 못했습니다.");
      }

      setConversations((current) =>
        upsertConversation(current, payload.conversation!),
      );
      setMessages((current) => mergeMessage(current, payload.message!));
      setDraft("");
      await channelRef.current?.send({
        type: "broadcast",
        event: "message",
        payload,
      });
    } catch (replyError) {
      setError(
        replyError instanceof Error
          ? replyError.message
          : "답변을 보내지 못했습니다.",
      );
    } finally {
      setSending(false);
    }
  };

  const updateStatus = async (status: SupportChatStatus) => {
    if (!selectedConversation || savingStatus) return;
    setSavingStatus(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          status,
          markRead: true,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | ReplyPayload
        | null;
      if (!response.ok || !payload?.conversation) {
        throw new Error(payload?.error ?? "상태를 변경하지 못했습니다.");
      }
      setConversations((current) =>
        upsertConversation(current, payload.conversation!),
      );
      await channelRef.current?.send({
        type: "broadcast",
        event: "message",
        payload,
      });
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : "상태를 변경하지 못했습니다.",
      );
    } finally {
      setSavingStatus(false);
    }
  };

  const deleteConversation = async (conversation: SupportChatConversation) => {
    if (deletingId) return;

    const confirmed = window.confirm(
      `${getConversationTitle(conversation)} 상담을 삭제할까요?\n삭제한 상담과 메시지는 복구할 수 없습니다.`,
    );
    if (!confirmed) return;

    setDeletingId(conversation.id);
    setError(null);
    try {
      const response = await fetch("/api/admin/chat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id }),
      });
      const payload = (await response.json().catch(() => null)) as
        | DeletePayload
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "상담을 삭제하지 못했습니다.");
      }

      const nextConversations = conversations.filter(
        (item) => item.id !== conversation.id,
      );
      setConversations(nextConversations);
      if (selectedId === conversation.id) {
        setSelectedId(nextConversations[0]?.id ?? null);
        if (nextConversations.length === 0) {
          setMessages([]);
        }
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "상담을 삭제하지 못했습니다.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  const totalUnread = conversations.reduce(
    (sum, conversation) => sum + conversation.unreadAdminCount,
    0,
  );

  return (
    <div className="mt-8 grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-[18px] border-2 border-[#111111] bg-card shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
        <div className="flex items-center justify-between gap-3 border-b-2 border-[#111111] bg-background px-4 py-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-muted-foreground">
              Live Chat
            </p>
            <h2 className="mt-1 text-base font-black text-foreground">
              상담 목록
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void loadList()}
            disabled={refreshing}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-card text-foreground transition hover:-translate-y-0.5 disabled:opacity-50"
            aria-label="채팅 목록 새로고침"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </button>
        </div>

        <div className="flex items-center justify-between border-b border-border/70 px-4 py-2 text-xs font-semibold text-muted-foreground">
          <span>{conversations.length.toLocaleString()}개 대화</span>
          <span>미확인 {totalUnread.toLocaleString()}</span>
        </div>

        <div ref={listRef} className="max-h-[620px] overflow-y-auto">
          {conversations.length > 0 ? (
            conversations.map((conversation) => {
              const active = conversation.id === selectedId;
              return (
                <div
                  key={conversation.id}
                  className={`flex items-stretch border-b border-border/60 transition hover:bg-background ${
                    active ? "bg-[#f2cf27]/18" : "bg-card"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(conversation.id)}
                    className="min-w-0 flex-1 px-4 py-3 text-left"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black text-foreground">
                          {getConversationTitle(conversation)}
                        </span>
                        <span className="mt-1 block truncate text-xs font-semibold text-muted-foreground">
                          {conversation.lastMessagePreview || "새 상담"}
                        </span>
                      </span>
                      {conversation.unreadAdminCount > 0 ? (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#d9362c] px-1 text-[10px] font-black text-white">
                          {conversation.unreadAdminCount}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-3 flex items-center justify-between gap-2">
                      <span
                        className={`rounded-[6px] border px-2 py-1 text-[10px] font-black ${
                          statusTone[conversation.status]
                        }`}
                      >
                        {supportChatStatusLabels[conversation.status]}
                      </span>
                      <span className="text-[10px] font-semibold text-muted-foreground">
                        {formatDateTime(conversation.lastMessageAt)}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center border-l border-border/60 px-2">
                    <button
                      type="button"
                      onClick={() => void deleteConversation(conversation)}
                      disabled={deletingId === conversation.id}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-border bg-background text-muted-foreground transition hover:border-[#d9362c] hover:bg-[#d9362c]/10 hover:text-[#d9362c] disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`${getConversationTitle(conversation)} 상담 삭제`}
                      title="상담 삭제"
                    >
                      {deletingId === conversation.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-4 py-10 text-center text-sm font-semibold text-muted-foreground">
              아직 들어온 상담이 없습니다.
            </div>
          )}
        </div>
      </aside>

      <section className="overflow-hidden rounded-[18px] border-2 border-[#111111] bg-card shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
        {selectedConversation ? (
          <>
            <div className="border-b-2 border-[#111111] bg-[#111111] px-5 py-4 text-white dark:border-[#f2cf27]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/60">
                    Support Room
                  </p>
                  <h2 className="mt-1 text-xl font-black">
                    {getConversationTitle(selectedConversation)}
                  </h2>
                  <p className="mt-1 text-xs font-semibold text-white/70">
                    {[
                      selectedConversation.guestEmail,
                      selectedConversation.guestPhone,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "연락처 미입력"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-[8px] border px-3 py-2 text-xs font-black ${
                      statusTone[selectedConversation.status]
                    }`}
                  >
                    {supportChatStatusLabels[selectedConversation.status]}
                  </span>
                  {selectedConversation.status === "CLOSED" ? (
                    <button
                      type="button"
                      onClick={() => void updateStatus("OPEN")}
                      disabled={savingStatus}
                      className="inline-flex items-center gap-1 rounded-[8px] border border-white/30 px-3 py-2 text-xs font-black text-white transition hover:bg-white hover:text-[#111111]"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      다시 열기
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void updateStatus("CLOSED")}
                      disabled={savingStatus}
                      className="inline-flex items-center gap-1 rounded-[8px] border border-white/30 px-3 py-2 text-xs font-black text-white transition hover:bg-white hover:text-[#111111]"
                    >
                      <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      상담 종료
                    </button>
                  )}
                </div>
              </div>
            </div>

            {error ? (
              <div className="border-b border-red-500/30 bg-red-500/10 px-5 py-3 text-xs font-semibold text-red-600">
                {error}
              </div>
            ) : null}

            <div
              ref={threadRef}
              className="h-[min(58vh,560px)] min-h-[360px] space-y-3 overflow-y-auto bg-background/60 px-5 py-5"
            >
              {loadingThread ? (
                <div className="flex h-full items-center justify-center text-sm font-semibold text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  대화를 불러오는 중입니다.
                </div>
              ) : messages.length > 0 ? (
                messages.map((message) => {
                  const adminMessage = message.senderType === "ADMIN";
                  return (
                    <div
                      key={message.id}
                      className={`flex ${
                        adminMessage ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[78%] rounded-[10px] border-2 px-3 py-2 shadow-[3px_3px_0_rgba(17,17,17,0.16)] ${
                          adminMessage
                            ? "border-[#111111] bg-[#111111] text-white"
                            : "border-[#111111] bg-[#f2cf27] text-[#111111]"
                        }`}
                      >
                        <p className="text-[11px] font-black opacity-70">
                          {message.senderName ||
                            (adminMessage ? "관리자" : "방문자")}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-6">
                          {message.body}
                        </p>
                        <p className="mt-1 text-right text-[10px] font-semibold opacity-65">
                          {formatTime(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex h-full items-center justify-center rounded-[12px] border-2 border-dashed border-border bg-card/70 px-5 text-center text-sm font-semibold text-muted-foreground">
                  메시지가 없습니다.
                </div>
              )}
            </div>

            <form
              onSubmit={sendReply}
              className="border-t-2 border-[#111111] bg-card p-4"
            >
              <div className="flex items-end gap-3">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={selectedConversation.status === "CLOSED"}
                  rows={3}
                  placeholder={
                    selectedConversation.status === "CLOSED"
                      ? "종료된 상담입니다. 다시 열기 후 답변할 수 있습니다."
                      : "관리자 답변을 입력하세요."
                  }
                  className="max-h-36 min-h-16 flex-1 resize-none rounded-[10px] border-2 border-border bg-background px-4 py-3 text-sm font-semibold outline-none focus:border-[#1556a4] disabled:bg-muted disabled:text-muted-foreground"
                />
                <button
                  type="submit"
                  disabled={
                    sending ||
                    !draft.trim() ||
                    selectedConversation.status === "CLOSED"
                  }
                  className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
                  aria-label="관리자 답변 보내기"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <SendHorizontal className="h-5 w-5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex min-h-[520px] flex-col items-center justify-center gap-3 px-5 text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-[14px] border-2 border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[4px_4px_0_#111111]">
              <MessageCircle className="h-7 w-7" aria-hidden="true" />
            </span>
            <h2 className="text-xl font-black text-foreground">
              선택된 상담이 없습니다.
            </h2>
            <p className="max-w-sm text-sm font-semibold leading-6 text-muted-foreground">
              사용자가 사이트 우측 하단 실시간 채팅으로 문의하면 이곳에 대화가
              표시됩니다.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
