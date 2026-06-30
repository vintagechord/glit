import { redirect } from "next/navigation";

import { AdminChatClient } from "@/features/chat/admin-chat-client";
import {
  type SupportChatConversation,
  type SupportChatStatus,
} from "@/lib/support-chat";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "실시간 채팅 관리",
};

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

async function requireAdminPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/admin/chat")}`);
  }

  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) {
    console.error("[admin-chat-page] admin check failed", error);
  }

  if (isAdmin !== true) {
    redirect("/");
  }
}

export default async function AdminChatPage() {
  await requireAdminPage();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_chat_conversations")
    .select("*")
    .order("last_message_at", { ascending: false })
    .limit(120);

  const conversations = ((data ?? []) as ConversationRow[]).map(
    mapConversation,
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Admin
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        실시간 채팅 관리
      </h1>
      <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
        사이트 우측 하단 실시간 채팅으로 들어온 문의를 확인하고 관리자 답변을
        보냅니다.
      </p>

      {error ? (
        <div className="mt-6 rounded-2xl border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600">
          채팅 목록을 불러오지 못했습니다. ({error.message})
        </div>
      ) : null}

      <AdminChatClient initialConversations={conversations} />
    </div>
  );
}
