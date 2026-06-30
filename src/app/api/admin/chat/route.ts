import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  type SupportChatConversation,
  type SupportChatMessage,
  type SupportChatStatus,
} from "@/lib/support-chat";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const replySchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

const statusSchema = z.object({
  conversationId: z.string().uuid(),
  status: z.enum(["OPEN", "WAITING_ADMIN", "WAITING_VISITOR", "CLOSED"]),
  markRead: z.boolean().optional(),
});

const deleteSchema = z.object({
  conversationId: z.string().uuid(),
});

type ConversationRow = {
  id: string;
  access_token: string;
  user_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  status: SupportChatStatus;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_admin_count: number | null;
  unread_visitor_count: number | null;
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
  "id, access_token, user_id, guest_name, guest_email, guest_phone, status, last_message_preview, last_message_at, unread_admin_count, unread_visitor_count, created_at, updated_at";

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

async function requireAdmin() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "로그인이 필요합니다.", status: 401 as const, user: null };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return { error: "관리자 권한이 필요합니다.", status: 403 as const, user: null };
  }

  return {
    error: null,
    status: 200 as const,
    user: { id: user.id, email: user.email ?? null, name: profile.name ?? null },
  };
}

async function listConversations() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_chat_conversations")
    .select(conversationSelect)
    .order("last_message_at", { ascending: false })
    .limit(120);

  if (error) throw error;
  return ((data ?? []) as ConversationRow[]).map(mapConversation);
}

async function loadMessages(conversationId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_chat_messages")
    .select(messageSelect)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(300);

  if (error) throw error;
  return ((data ?? []) as MessageRow[]).map(mapMessage);
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const conversationId = request.nextUrl.searchParams.get("conversationId");
  const markRead = request.nextUrl.searchParams.get("markRead") === "admin";
  const admin = createAdminClient();

  try {
    if (!conversationId) {
      return NextResponse.json({ conversations: await listConversations() });
    }

    const query = markRead
      ? admin
          .from("support_chat_conversations")
          .update({ unread_admin_count: 0 })
          .eq("id", conversationId)
          .select(conversationSelect)
      : admin
          .from("support_chat_conversations")
          .select(conversationSelect)
          .eq("id", conversationId);

    const { data, error } = await query.maybeSingle();

    if (error || !data) {
      throw error ?? new Error("conversation missing");
    }

    return NextResponse.json({
      conversation: mapConversation(data as ConversationRow),
      messages: await loadMessages(conversationId),
    });
  } catch (error) {
    console.error("[admin-chat][get] error", error);
    return NextResponse.json(
      { error: "채팅 정보를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const parsed = replySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "답변 내용을 확인해주세요." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: conversation, error: conversationError } = await admin
    .from("support_chat_conversations")
    .select(conversationSelect)
    .eq("id", parsed.data.conversationId)
    .maybeSingle();

  if (conversationError || !conversation) {
    return NextResponse.json(
      { error: "대화방을 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const { data: message, error: messageError } = await admin
    .from("support_chat_messages")
    .insert({
      conversation_id: parsed.data.conversationId,
      sender_type: "ADMIN",
      sender_user_id: auth.user.id,
      sender_name: auth.user.name || auth.user.email || "관리자",
      body: parsed.data.body,
    })
    .select(messageSelect)
    .maybeSingle();

  if (messageError || !message) {
    console.error("[admin-chat][post] insert message error", messageError);
    return NextResponse.json(
      { error: "답변을 저장하지 못했습니다." },
      { status: 500 },
    );
  }

  const preview = parsed.data.body.slice(0, 120);
  const { data: updated, error: updateError } = await admin
    .from("support_chat_conversations")
    .update({
      status: "WAITING_VISITOR",
      last_message_preview: preview,
      last_message_at: message.created_at,
      unread_visitor_count:
        ((conversation as ConversationRow).unread_visitor_count ?? 0) + 1,
      unread_admin_count: 0,
    })
    .eq("id", parsed.data.conversationId)
    .select(conversationSelect)
    .maybeSingle();

  if (updateError || !updated) {
    console.error("[admin-chat][post] update conversation error", updateError);
    return NextResponse.json(
      { error: "대화 상태를 저장하지 못했습니다." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    conversation: mapConversation(updated as ConversationRow),
    message: mapMessage(message as MessageRow),
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const parsed = statusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "상태 변경 값을 확인해주세요." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const updatePayload: Record<string, unknown> = {
    status: parsed.data.status,
  };
  if (parsed.data.markRead) {
    updatePayload.unread_admin_count = 0;
  }

  const { data, error } = await admin
    .from("support_chat_conversations")
    .update(updatePayload)
    .eq("id", parsed.data.conversationId)
    .select(conversationSelect)
    .maybeSingle();

  if (error || !data) {
    console.error("[admin-chat][patch] update error", error);
    return NextResponse.json(
      { error: "상태를 변경하지 못했습니다." },
      { status: 500 },
    );
  }

  return NextResponse.json({ conversation: mapConversation(data as ConversationRow) });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "삭제할 상담을 확인해주세요." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("support_chat_conversations")
    .delete()
    .eq("id", parsed.data.conversationId);

  if (error) {
    console.error("[admin-chat][delete] error", error);
    return NextResponse.json(
      { error: "상담을 삭제하지 못했습니다." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    deletedId: parsed.data.conversationId,
  });
}
