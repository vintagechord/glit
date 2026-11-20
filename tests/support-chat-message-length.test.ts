import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";

import { parseVisitorChatMessagePayload } from "../src/lib/support-chat-request";
import { runEnglishPack } from "./fixtures/english-pack-runtime";
import { chatRouteFixture } from "./fixtures/support-chat-route";

const chatLibrary = () => import("../src/lib/support-chat") as Promise<Record<string, unknown>>;

test("a chat message may hold 2,000 characters; a longer one is refused with that limit instead of a vague error", async () => {
  const { supportChatMessageMaxLength, supportChatMessageTooLongError } = await chatLibrary();
  const { visitorChatMessageRefusal } = await import("../src/lib/support-chat-request") as Record<string, unknown>;
  assert.equal(supportChatMessageMaxLength, 2000);
  assert.equal(typeof supportChatMessageTooLongError, "string");
  assert.match(supportChatMessageTooLongError as string, /2,000자/);
  assert.equal(typeof visitorChatMessageRefusal, "function");
  const refusal = visitorChatMessageRefusal as (error: unknown) => string;

  assert.equal(parseVisitorChatMessagePayload({ body: "가".repeat(2000) }).success, true);
  const tooLong = parseVisitorChatMessagePayload({ body: `  ${"가".repeat(2001)}  ` });
  assert.equal(tooLong.success, false);
  assert.equal(refusal(tooLong.error), supportChatMessageTooLongError);
  const blank = parseVisitorChatMessagePayload({ body: "   " });
  assert.equal(refusal(blank.error), "메시지 내용을 확인해주세요.");
  const badToken = parseVisitorChatMessagePayload({ accessToken: "short", body: "문의" });
  assert.equal(refusal(badToken.error), "메시지 내용을 확인해주세요.");
});

test("the chat API tells the visitor the 2,000-character limit when a pasted message is too long", async () => {
  const { supportChatMessageTooLongError } = await chatLibrary();
  const chat = await chatRouteFixture("src/app/api/chat/route");
  // 2,500 Hangul characters stay under the 8 KB request cap, so the body check answers.
  const response = await chat.POST(new NextRequest("https://example.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: "가사 ".repeat(834) }),
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, supportChatMessageTooLongError);
  assert.equal(chat.inserts.length, 0);
});

test("the chat widget stops an over-long message before sending and keeps the draft", () => {
  const widget = readFileSync("src/components/chatbot-widget.tsx", "utf8");
  const sendMessage = widget.slice(widget.indexOf("const sendMessage = async"), widget.indexOf("const loadEarlier = async"));
  const guard = sendMessage.search(/if \(body\.length > supportChatMessageMaxLength\) \{\s*setError\(supportChatMessageTooLongError\);\s*return;\s*\}/);
  assert.ok(guard > 0, "sendMessage checks the length limit");
  assert.ok(guard < sendMessage.indexOf("setSending(true)"), "the check runs before the message is sent");
  assert.ok(guard < sendMessage.indexOf("setDrafts("), "the draft is kept so it can be split");
  assert.doesNotMatch(widget, /maxLength=\{/, "a pasted message must not be cut off silently");
});

test("the length message is translated on English pages", async () => {
  const { supportChatMessageTooLongError } = await chatLibrary();
  const { translateValue } = runEnglishPack<{ translateValue: (value: string) => string }>(["translateValue"]);
  const english = translateValue(String(supportChatMessageTooLongError));
  assert.match(english, /^Messages can be up to 2,000 characters\./);
  assert.doesNotMatch(english, /[가-힣]/);
});
