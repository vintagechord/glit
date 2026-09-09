import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatHistoryQuery, loadChatHistory, parseChatHistoryCursor } from "../src/lib/support-chat-history";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const conversationId = id(900);
const rows = Array.from({ length: 305 }, (_, index) => ({ id: id(index + 1), conversation_id: conversationId, sender_type: "VISITOR", sender_user_id: null, sender_name: null, body: `message ${index + 1}`, created_at: "2026-09-10T00:00:00+00:00" }));

function database() {
  let conditions = "";
  const orderings: Array<{ column: string; ascending: boolean }> = [];
  let selectedConversation = "";
  const query = {
    select() { return query; },
    eq(column: string, value: string) { assert.equal(column, "conversation_id"); selectedConversation = value; return query; },
    or(value: string) { conditions = value; return query; },
    order(column: string, options: { ascending: boolean }) { orderings.push({ column, ...options }); return query; },
    async limit(limit: number) {
      assert.equal(selectedConversation, conversationId);
      assert.deepEqual(orderings, [{ column: "created_at", ascending: false }, { column: "id", ascending: false }]);
      const beforeId = /id\.lt\.([^)]*)/.exec(conditions)?.[1];
      return { data: rows.filter(row => !beforeId || row.id < beforeId).slice().reverse().slice(0, limit), error: null };
    },
  };
  return { from: (table: string) => { assert.equal(table, "support_chat_messages"); return query; } } as unknown as SupabaseClient;
}

test("chat reads the latest window and paginates all older messages without same-time duplicates", async () => {
  const latest = await loadChatHistory(database(), conversationId, undefined, 300);
  assert.equal(latest.messages.length, 300);
  assert.equal(latest.messages[0].body, "message 6");
  assert.equal(latest.messages.at(-1)?.body, "message 305");
  assert.ok(latest.earlierCursor);
  const parsed = parseChatHistoryCursor(chatHistoryQuery(latest.earlierCursor));
  const earlier = await loadChatHistory(database(), conversationId, parsed, 300);
  assert.deepEqual(earlier.messages.map(message => message.body), ["message 1", "message 2", "message 3", "message 4", "message 5"]);
  assert.equal(earlier.earlierCursor, null);
  assert.equal(new Set([...earlier.messages, ...latest.messages].map(message => message.id)).size, 305);
});

test("chat cursor rejects malformed partial values before composing a database filter", () => {
  assert.equal(parseChatHistoryCursor(new URLSearchParams()), undefined);
  for (const query of ["before=bad&beforeId=bad", `beforeId=${id(1)}`, `before=2026-09-10T00:00:00Z&beforeId=${id(1)},id.gt.0`]) {
    assert.throws(() => parseChatHistoryCursor(new URLSearchParams(query)));
  }
});
