import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";

import type { SupportChatMessage } from "../src/lib/support-chat";
import { chatRouteFixture } from "./fixtures/support-chat-route";

const adminId = "5c9e2f7a-1b3d-4c8e-9f0a-2b4c6d8e0f12";
const adminEmail = "admin-login@example.test";
const conversationId = "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const visitorToken = "visitor-access-token-0123456789";

const guestConversation = {
  id: conversationId, access_token: visitorToken, user_id: null, guest_name: null, guest_email: null, guest_phone: null,
  status: "WAITING_VISITOR", last_message_preview: "답변드립니다", last_message_at: "2026-11-21T00:00:02Z",
  unread_admin_count: 0, unread_visitor_count: 1, visitor_left_at: null, created_at: "2026-11-21T00:00:00Z", updated_at: "2026-11-21T00:00:02Z",
};

const message = (senderType: SupportChatMessage["senderType"], values: Partial<SupportChatMessage>): SupportChatMessage => ({
  id: `message-${senderType.toLowerCase()}`, conversationId, senderType, senderUserId: null, senderName: null, body: "본문", createdAt: "2026-11-21T00:00:01Z", ...values,
});

test("visitors get only the visitor view of a message: no staff account name, e-mail or user id", async () => {
  const { toVisitorChatMessage } = await import("../src/lib/support-chat");
  assert.equal(typeof toVisitorChatMessage, "function");
  const reply = message("ADMIN", { senderUserId: adminId, senderName: adminEmail, body: "답변드립니다" });
  assert.deepEqual(toVisitorChatMessage(reply), { ...reply, senderUserId: null, senderName: null });
  const own = message("VISITOR", { senderName: "방문자" });
  assert.deepEqual(toVisitorChatMessage(own), own, "the visitor's own message is theirs to see");
});

test("a guest reading a conversation never receives the replying admin's login e-mail or user id", async () => {
  const chat = await chatRouteFixture("src/app/api/chat/route");
  chat.state.conversation = guestConversation;
  chat.state.history = [
    message("VISITOR", { id: "m1", senderName: "방문자", body: "문의드립니다" }),
    // A row stored before the fix: a nameless admin's reply carried the login e-mail.
    message("ADMIN", { id: "m2", senderUserId: adminId, senderName: adminEmail, body: "답변드립니다" }),
    message("SYSTEM", { id: "m3", senderName: "시스템", body: "사용자가 상담을 나갔습니다." }),
  ];
  const response = await chat.GET(new NextRequest("https://example.test/api/chat", { headers: { "x-support-chat-token": visitorToken } }));
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, new RegExp(adminEmail.replace(/[.]/g, "\\.")));
  assert.doesNotMatch(text, new RegExp(adminId));
  const payload = JSON.parse(text) as { messages: SupportChatMessage[] };
  assert.deepEqual(payload.messages.map((item) => item.body), ["문의드립니다", "답변드립니다", "사용자가 상담을 나갔습니다."]);
  const reply = payload.messages.find((item) => item.senderType === "ADMIN")!;
  assert.equal(reply.senderUserId, null);
  assert.equal(reply.senderName, null);
});

test("an admin reply stores the profile name or 관리자, never the admin's login e-mail", async () => {
  for (const [name, stored] of [["", "관리자"], ["   ", "관리자"], [null, "관리자"], ["온사이드 매니저", "온사이드 매니저"]] as const) {
    const chat = await chatRouteFixture("src/app/api/admin/chat/route");
    chat.state.user = { id: adminId, email: adminEmail };
    chat.state.profile = { role: "admin", name };
    chat.state.conversation = guestConversation;
    const response = await chat.POST(new NextRequest("https://example.test/api/admin/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, body: "답변드립니다" }),
    }));
    assert.equal(response.status, 200, `profile name ${JSON.stringify(name)}`);
    const insert = chat.inserts.find((item) => item.table === "support_chat_messages")!;
    assert.equal(insert.values.sender_name, stored, `profile name ${JSON.stringify(name)}`);
    assert.doesNotMatch(JSON.stringify(insert.values), /admin-login@/);
  }
});

test("the admin reply broadcast on the visitor's conversation channel carries the visitor view of the message", () => {
  const client = readFileSync("src/features/chat/admin-chat-client.tsx", "utf8");
  assert.match(client, /const visitorPayload = \{\s*\.\.\.payload,\s*message: payload\.message && toVisitorChatMessage\(payload\.message\),?\s*\};/);
  assert.match(client, /channelRef\.current\?\.send\(\{\s*type: "broadcast",\s*event: "message",\s*payload: visitorPayload,\s*\}\)/);
});
