import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  type SupportChatConversation,
  type SupportChatMessage,
  type SupportChatPayload,
} from "@/lib/support-chat";
import {
  parseVisitorChatLeavePayload,
  parseVisitorChatMessagePayload,
} from "@/lib/support-chat-request";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { readBoundedJsonBody } from "@/lib/request-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const MAX_CHAT_WRITE_BODY_BYTES = 8 * 1024;
const CHAT_WRITE_LIMIT = 30;
const CHAT_WRITE_WINDOW_MS = 60_000;

const markReadSchema = z
  .object({
    accessToken: z.string().trim().min(20).max(128),
  })
  .strict();

type ConversationRow = {
  id: string;
  access_token: string;
  user_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  status: SupportChatConversation["status"];
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_admin_count: number | null;
  unread_visitor_count: number | null;
  visitor_left_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: SupportChatMessage["senderType"];
  sender_user_id: string | null;
  sender_name: string | null;
  body: string;
  created_at: string | null;
};

const conversationSelect =
  "id, access_token, user_id, guest_name, guest_email, guest_phone, status, last_message_preview, last_message_at, unread_admin_count, unread_visitor_count, visitor_left_at, created_at, updated_at";

const messageSelect =
  "id, conversation_id, sender_type, sender_user_id, sender_name, body, created_at";

const mapConversation = (row: ConversationRow): SupportChatConversation => ({
  id: row.id,
  accessToken: row.access_token,
  userId: row.user_id,
  guestName: row.guest_name,
  guestEmail: row.guest_email,
  guestPhone: row.guest_phone,
  status: row.status,
  lastMessagePreview: row.last_message_preview,
  lastMessageAt: row.last_message_at,
  unreadAdminCount: row.unread_admin_count ?? 0,
  unreadVisitorCount: row.unread_visitor_count ?? 0,
  visitorLeftAt: row.visitor_left_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapMessage = (row: MessageRow): SupportChatMessage => ({
  id: row.id,
  conversationId: row.conversation_id,
  senderType: row.sender_type,
  senderUserId: row.sender_user_id,
  senderName: row.sender_name,
  body: row.body,
  createdAt: row.created_at,
});

const makeAccessToken = () => randomBytes(24).toString("base64url");

const enforceVisitorWriteLimit = (request: NextRequest) => {
  const result = consumeRateLimit({
    namespace: "support-chat-write",
    identifier: getRequestIdentifier(request.headers),
    limit: CHAT_WRITE_LIMIT,
    windowMs: CHAT_WRITE_WINDOW_MS,
  });
  if (result.allowed) return null;
  return NextResponse.json(
    { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
    {
      status: 429,
      headers: { "Retry-After": String(result.retryAfterSeconds) },
    },
  );
};

const readVisitorWritePayload = async (request: NextRequest) => {
  const body = await readBoundedJsonBody(request, MAX_CHAT_WRITE_BODY_BYTES);
  if (body.ok) return { value: body.value, response: null };
  return {
    value: null,
    response: NextResponse.json(
      {
        error:
          body.reason === "too_large"
            ? "메시지 요청 크기가 너무 큽니다."
            : "메시지 내용을 확인해주세요.",
      },
      { status: body.reason === "too_large" ? 413 : 400 },
    ),
  };
};

const normalizeAccessTokens = (values: string[]) =>
  Array.from(
    new Set(
      values
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter((value) => value.length >= 20 && value.length <= 128),
    ),
  ).slice(0, 50);

async function getViewer() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, profile: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, phone")
    .eq("user_id", user.id)
    .maybeSingle();

  return { user, profile };
}

async function loadMessages(conversationId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_chat_messages")
    .select(messageSelect)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    throw error;
  }

  return ((data ?? []) as MessageRow[]).map(mapMessage);
}

async function buildPayload(row: ConversationRow): Promise<SupportChatPayload> {
  return {
    conversation: mapConversation(row),
    messages: await loadMessages(row.id),
  };
}

async function listVisitorConversations(params: {
  userId?: string | null;
  accessTokens: string[];
}) {
  const admin = createAdminClient();
  const conversations = new Map<string, SupportChatConversation>();

  if (params.userId) {
    const { data, error } = await admin
      .from("support_chat_conversations")
      .select(conversationSelect)
      .eq("user_id", params.userId)
      .is("visitor_left_at", null)
      .order("last_message_at", { ascending: false })
      .limit(80);

    if (error) {
      throw error;
    }

    for (const row of (data ?? []) as ConversationRow[]) {
      conversations.set(row.id, mapConversation(row));
    }
  }

  if (params.accessTokens.length > 0) {
    const { data, error } = await admin
      .from("support_chat_conversations")
      .select(conversationSelect)
      .in("access_token", params.accessTokens)
      .is("visitor_left_at", null)
      .order("last_message_at", { ascending: false })
      .limit(80);

    if (error) {
      throw error;
    }

    for (const row of (data ?? []) as ConversationRow[]) {
      conversations.set(row.id, mapConversation(row));
    }
  }

  return [...conversations.values()]
    .sort(
      (a, b) =>
        new Date(b.lastMessageAt ?? b.updatedAt ?? 0).getTime() -
        new Date(a.lastMessageAt ?? a.updatedAt ?? 0).getTime(),
    )
    .slice(0, 80);
}

export async function GET(request: NextRequest) {
  // Bearer-like visitor tokens must never enter URLs, referrers or edge logs.
  const tokenCandidate = request.headers.get("x-support-chat-token")?.trim();
  const token =
    tokenCandidate && tokenCandidate.length >= 20 && tokenCandidate.length <= 128
      ? tokenCandidate
      : null;
  const listMode = request.nextUrl.searchParams.get("list") === "1";
  const accessTokens = normalizeAccessTokens([
    request.headers.get("x-support-chat-tokens") ?? "",
  ]);
  const { user } = await getViewer();
  const admin = createAdminClient();

  if (listMode) {
    try {
      return NextResponse.json({
        conversations: await listVisitorConversations({
          userId: user?.id ?? null,
          accessTokens,
        }),
      });
    } catch (error) {
      console.error("[support-chat][list] conversation error", error);
      return NextResponse.json(
        { error: "채팅 목록을 불러오지 못했습니다." },
        { status: 500 },
      );
    }
  }

  let conversationResult;
  if (token) {
    conversationResult = await admin
      .from("support_chat_conversations")
      .select(conversationSelect)
      .eq("access_token", token)
      .is("visitor_left_at", null)
      .maybeSingle();
  } else if (user) {
    conversationResult = await admin
      .from("support_chat_conversations")
      .select(conversationSelect)
      .eq("user_id", user.id)
      .is("visitor_left_at", null)
      .neq("status", "CLOSED")
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  } else {
    return NextResponse.json({ conversation: null, messages: [] });
  }

  if (conversationResult.error) {
    console.error("[support-chat][get] conversation error", conversationResult.error);
    return NextResponse.json(
      { error: "채팅 내역을 불러오지 못했습니다." },
      { status: 500 },
    );
  }

  if (!conversationResult.data) {
    return NextResponse.json({ conversation: null, messages: [] });
  }

  try {
    return NextResponse.json(
      await buildPayload(conversationResult.data as ConversationRow),
    );
  } catch (error) {
    console.error("[support-chat][get] messages error", error);
    return NextResponse.json(
      { error: "채팅 메시지를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const limitResponse = enforceVisitorWriteLimit(request);
  if (limitResponse) return limitResponse;

  const payload = await readVisitorWritePayload(request);
  if (payload.response) return payload.response;
  const parsed = markReadSchema.safeParse(payload.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "읽음 처리할 채팅방을 확인해주세요." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_chat_conversations")
    .update({ unread_visitor_count: 0 })
    .eq("access_token", parsed.data.accessToken)
    .is("visitor_left_at", null)
    .select(conversationSelect)
    .maybeSingle();

  if (error) {
    console.error("[support-chat][patch] read update error", {
      code: error.code,
    });
    return NextResponse.json(
      { error: "채팅 읽음 상태를 저장하지 못했습니다." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    conversation: data ? mapConversation(data as ConversationRow) : null,
  });
}

export async function POST(request: NextRequest) {
  const limitResponse = enforceVisitorWriteLimit(request);
  if (limitResponse) return limitResponse;

  const payload = await readVisitorWritePayload(request);
  if (payload.response) return payload.response;
  const parsed = parseVisitorChatMessagePayload(payload.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "메시지 내용을 확인해주세요." },
      { status: 400 },
    );
  }

  const { user, profile } = await getViewer();
  const admin = createAdminClient();
  const accessToken = parsed.data.accessToken;
  let conversation: ConversationRow | null = null;

  if (accessToken) {
    const { data, error } = await admin
      .from("support_chat_conversations")
      .select(conversationSelect)
      .eq("access_token", accessToken)
      .is("visitor_left_at", null)
      .maybeSingle();
    if (error) {
      console.error("[support-chat][post] load conversation error", error);
      return NextResponse.json(
        { error: "채팅방을 확인하지 못했습니다." },
        { status: 500 },
      );
    }
    conversation = data as ConversationRow | null;
  }

  if (!conversation) {
    const { data, error } = await admin
      .from("support_chat_conversations")
      .insert({
        access_token: makeAccessToken(),
        user_id: user?.id ?? null,
        guest_name: profile?.name || null,
        guest_email: user?.email || null,
        guest_phone: profile?.phone || null,
        status: "WAITING_ADMIN",
      })
      .select(conversationSelect)
      .maybeSingle();

    if (error || !data) {
      console.error("[support-chat][post] create conversation error", error);
      return NextResponse.json(
        { error: "채팅방을 만들지 못했습니다." },
        { status: 500 },
      );
    }
    conversation = data as ConversationRow;
  }

  const senderName =
    profile?.name?.trim() ||
    user?.email ||
    conversation.guest_name ||
    "방문자";

  const { data: message, error: messageError } = await admin
    .from("support_chat_messages")
    .insert({
      conversation_id: conversation.id,
      sender_type: "VISITOR",
      sender_user_id: user?.id ?? null,
      sender_name: senderName,
      body: parsed.data.body,
    })
    .select(messageSelect)
    .maybeSingle();

  if (messageError || !message) {
    console.error("[support-chat][post] insert message error", messageError);
    return NextResponse.json(
      { error: "메시지를 저장하지 못했습니다." },
      { status: 500 },
    );
  }

  const preview = parsed.data.body.slice(0, 120);
  const { data: updated, error: updateError } = await admin
    .from("support_chat_conversations")
    .update({
      user_id: conversation.user_id ?? user?.id ?? null,
      guest_name: conversation.guest_name || profile?.name || null,
      guest_email: conversation.guest_email || user?.email || null,
      guest_phone: conversation.guest_phone || profile?.phone || null,
      status: "WAITING_ADMIN",
      last_message_preview: preview,
      last_message_at: message.created_at,
      unread_admin_count: (conversation.unread_admin_count ?? 0) + 1,
      unread_visitor_count: 0,
    })
    .eq("id", conversation.id)
    .select(conversationSelect)
    .maybeSingle();

  if (updateError || !updated) {
    console.error("[support-chat][post] update conversation error", updateError);
    return NextResponse.json(
      { error: "채팅방 상태를 저장하지 못했습니다." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    conversation: mapConversation(updated as ConversationRow),
    message: mapMessage(message as MessageRow),
  });
}

export async function DELETE(request: NextRequest) {
  const limitResponse = enforceVisitorWriteLimit(request);
  if (limitResponse) return limitResponse;

  const payload = await readVisitorWritePayload(request);
  if (payload.response) return payload.response;
  const parsed = parseVisitorChatLeavePayload(payload.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "나갈 채팅방을 확인해주세요." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: conversation, error: conversationError } = await admin
    .from("support_chat_conversations")
    .select(conversationSelect)
    .eq("access_token", parsed.data.accessToken)
    .is("visitor_left_at", null)
    .maybeSingle();

  if (conversationError) {
    console.error("[support-chat][delete] load conversation error", conversationError);
    return NextResponse.json(
      { error: "채팅방을 확인하지 못했습니다." },
      { status: 500 },
    );
  }

  if (!conversation) {
    return NextResponse.json({ ok: true, leftId: null });
  }

  const systemBody = "사용자가 상담을 나갔습니다.";
  const { data: message, error: messageError } = await admin
    .from("support_chat_messages")
    .insert({
      conversation_id: (conversation as ConversationRow).id,
      sender_type: "SYSTEM",
      sender_user_id: null,
      sender_name: "시스템",
      body: systemBody,
    })
    .select(messageSelect)
    .maybeSingle();

  if (messageError || !message) {
    console.error("[support-chat][delete] insert system message error", messageError);
    return NextResponse.json(
      { error: "채팅방 나가기를 저장하지 못했습니다." },
      { status: 500 },
    );
  }

  const { data: updated, error: updateError } = await admin
    .from("support_chat_conversations")
    .update({
      status: "CLOSED",
      visitor_left_at: new Date().toISOString(),
      last_message_preview: systemBody,
      last_message_at: message.created_at,
      unread_admin_count:
        ((conversation as ConversationRow).unread_admin_count ?? 0) + 1,
      unread_visitor_count: 0,
    })
    .eq("id", (conversation as ConversationRow).id)
    .select(conversationSelect)
    .maybeSingle();

  if (updateError || !updated) {
    console.error("[support-chat][delete] update conversation error", updateError);
    return NextResponse.json(
      { error: "채팅방 나가기를 저장하지 못했습니다." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    leftId: (conversation as ConversationRow).id,
    conversation: mapConversation(updated as ConversationRow),
    message: mapMessage(message as MessageRow),
  });
}
