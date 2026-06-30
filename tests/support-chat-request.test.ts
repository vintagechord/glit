import assert from "node:assert/strict";
import test from "node:test";

import { parseVisitorChatMessagePayload } from "../src/lib/support-chat-request";

test("visitor chat payload accepts first message without access token", () => {
  const parsed = parseVisitorChatMessagePayload({
    accessToken: null,
    body: "  문의합니다  ",
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.accessToken, undefined);
    assert.equal(parsed.data.body, "문의합니다");
  }
});

test("visitor chat payload rejects blank body", () => {
  const parsed = parseVisitorChatMessagePayload({
    accessToken: null,
    body: "   ",
  });

  assert.equal(parsed.success, false);
});

test("visitor chat payload rejects malformed access token", () => {
  const parsed = parseVisitorChatMessagePayload({
    accessToken: "short",
    body: "문의합니다",
  });

  assert.equal(parsed.success, false);
});
