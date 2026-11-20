import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { SupportChatConversation } from "../src/lib/support-chat";

type Helpers = {
  mergeListedChatTokens?: (current: string[], requested: string[], listed: string[]) => string[];
  mergeListedChatConversations?: (
    current: SupportChatConversation[],
    requested: string[],
    listed: SupportChatConversation[],
  ) => SupportChatConversation[];
};

const conversation = (id: string, accessToken: string) =>
  ({ id, accessToken, lastMessageAt: "2026-11-21T00:00:00Z" }) as SupportChatConversation;

test("a conversation list answered for older tokens keeps a conversation started while it was loading", async () => {
  const { mergeListedChatTokens, mergeListedChatConversations } = (await import("../src/lib/support-chat")) as Helpers;
  assert.equal(typeof mergeListedChatTokens, "function");
  assert.equal(typeof mergeListedChatConversations, "function");

  // A first-time guest's 30-second poll left with no tokens; their first
  // message created token T before the empty answer came back.
  assert.deepEqual(mergeListedChatTokens!(["token-new-0123456789"], [], []), ["token-new-0123456789"]);
  const started = conversation("c-new", "token-new-0123456789");
  assert.deepEqual(mergeListedChatConversations!([started], [], []), [started]);

  // Tokens the request asked about follow the answer: a conversation the
  // server no longer returns (left, or a member's after logout) is dropped.
  assert.deepEqual(
    mergeListedChatTokens!(["token-new-0123456789", "token-kept-0123456789", "token-gone-0123456789"], ["token-kept-0123456789", "token-gone-0123456789"], ["token-kept-0123456789"]),
    ["token-new-0123456789", "token-kept-0123456789"],
  );
  const kept = conversation("c-kept", "token-kept-0123456789");
  const gone = conversation("c-gone", "token-gone-0123456789");
  const refreshed = { ...kept, lastMessageAt: "2026-11-21T00:05:00Z" };
  assert.deepEqual(
    mergeListedChatConversations!([started, kept, gone], ["token-kept-0123456789", "token-gone-0123456789"], [refreshed]),
    [refreshed, started],
  );
  // A member's list also returns conversations the request had no token for.
  const otherDevice = conversation("c-other", "token-other-0123456789");
  assert.deepEqual(mergeListedChatTokens!([], [], ["token-other-0123456789"]), ["token-other-0123456789"]);
  assert.deepEqual(mergeListedChatConversations!([], [], [otherDevice]), [otherDevice]);
});

test("the chat widget merges a list answer into the current tokens instead of replacing them", () => {
  const widget = readFileSync("src/components/chatbot-widget.tsx", "utf8");
  const list = widget.slice(widget.indexOf("const loadConversationList = React.useCallback"), widget.indexOf("const loadConversation = React.useCallback"));
  assert.match(list, /setConversations\(\(current\) =>\s*sortConversations\(mergeListedChatConversations\(current, requestTokens, nextConversations\)\),?\s*\)/);
  assert.match(list, /syncStoredTokensFromConversations\(nextConversations, requestTokens\)/);
  assert.doesNotMatch(list, /setConversations\(nextConversations\)/);
  const sync = widget.slice(widget.indexOf("const syncStoredTokensFromConversations"), widget.indexOf("const clearActiveThread"));
  // Merging inside the state updater sees a token remembered after the request was sent.
  assert.match(sync, /setStoredTokens\(\(current\) => \{[\s\S]*mergeListedChatTokens\(\s*current,\s*requestTokens,/);
  assert.match(sync, /writeStoredConversationTokens\(nextTokens, activeTokenRef\.current\)/);
});
