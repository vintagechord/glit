import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  type SupportChatConversation,
  type SupportChatMessage,
  type SupportChatPayload,
} from "@/lib/support-chat";
import { parseVisitorChatMessagePayload } from "@/lib/support-chat-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

const makeAccessToken = () => randomBytes(24).toString("base64url");

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

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("accessToken")?.trim();
  const markVisitorRead =
    request.nextUrl.searchParams.get("markRead") === "visitor";
  const { user } = await getViewer();
  const admin = createAdminClient();

  let conversationResult;
  if (token) {
    conversationResult = await admin
      .from("support_chat_conversations")
      .select(conversationSelect)
      .eq("access_token", token)
      .maybeSingle();
  } else if (user) {
    conversationResult = await admin
      .from("support_chat_conversations")
      .select(conversationSelect)
      .eq("user_id", user.id)
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
    let conversation = conversationResult.data as ConversationRow;
    if (markVisitorRead && conversation.unread_visitor_count) {
      const { data: updated, error: updateError } = await admin
        .from("support_chat_conversations")
        .update({ unread_visitor_count: 0 })
        .eq("id", conversation.id)
        .select(conversationSelect)
        .maybeSingle();

      if (updateError) {
        console.error("[support-chat][get] read update error", updateError);
      } else if (updated) {
        conversation = updated as ConversationRow;
      }
    }

    return NextResponse.json(await buildPayload(conversation));
  } catch (error) {
    console.error("[support-chat][get] messages error", error);
    return NextResponse.json(
      { error: "채팅 메시지를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const parsed = parseVisitorChatMessagePayload(
    await request.json().catch(() => null),
  );
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
