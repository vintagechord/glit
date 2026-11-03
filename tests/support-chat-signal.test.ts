import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  readSupportChatAdminSignal,
  supportChatAdminChannelName,
  toSupportChatAdminSignal,
  type SupportChatConversation,
} from "../src/lib/support-chat";

const read = (path: string) => readFileSync(path, "utf8");
const conversationId = "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

test("admin channel signals carry only the conversation id", () => {
  const conversation = {
    id: conversationId,
    accessToken: "secret-access-token-value-1234",
    guestEmail: "guest@example.test",
    guestPhone: "010-0000-0000",
  } as SupportChatConversation;

  const signal = toSupportChatAdminSignal({ conversation });
  assert.deepEqual(signal, { conversationId });
  assert.doesNotMatch(JSON.stringify(signal), /secret-access-token|guest@|010-/);
  assert.deepEqual(toSupportChatAdminSignal({ deletedId: conversationId }), {
    conversationId,
  });
  assert.equal(toSupportChatAdminSignal({}), null);
});

test("admin channel receivers ignore anything but an id signal", () => {
  assert.deepEqual(readSupportChatAdminSignal({ conversationId }), {
    conversationId,
  });
  assert.equal(readSupportChatAdminSignal({ conversation: { id: conversationId } }), null);
  assert.equal(readSupportChatAdminSignal({ conversationId: "not-a-uuid" }), null);
  assert.equal(readSupportChatAdminSignal(null), null);
});

test("the shared channel left the topic old bundles broadcast tokens on", () => {
  assert.notEqual(supportChatAdminChannelName, "support-chat:admin");
});

test("chat clients send only signals on the shared admin channel", () => {
  for (const path of [
    "src/components/chatbot-widget.tsx",
    "src/features/chat/admin-chat-client.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /adminChannelRef\.current\?\.send\(\{\s*type: "broadcast",\s*event: "message",\s*payload: signal,/);
    assert.match(source, /handleAdminSignal\(event\.payload\)/);
  }
});

test("visitor chat routes hide member conversations from other viewers", () => {
  const route = read("src/app/api/chat/route.ts");
  assert.match(route, /const isVisibleToViewer = /);
  assert.equal(route.match(/isVisibleToViewer\(/g)?.length, 3);
  assert.equal(route.match(/\.or\(viewerOwnershipFilter\(viewerUserId\)\)/g)?.length, 2);
});
