import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadUserMagazineRequests } from "../src/app/mypage/credits/magazine-history";

const userId = "22222222-2222-4222-8222-222222222222";
type QueryError = { code: string; message: string };
type Row = Record<string, unknown>;

function database(responses: Array<{ data: Row[] | null; error: QueryError | null }>) {
  const calls: Array<{ table: string; columns?: string; owner?: string; order?: unknown[]; limit?: number }> = [];
  const client = {
    from(table: string) {
      const call: (typeof calls)[number] = { table };
      calls.push(call);
      const response = responses[calls.length - 1];
      assert.ok(response, "unexpected database request");
      const query = {
        select(columns: string) { call.columns = columns; return query; },
        eq(column: string, value: string) {
          assert.equal(column, "user_id");
          call.owner = value;
          return query;
        },
        order(column: string, options: unknown) { call.order = [column, options]; return query; },
        limit(limit: number) { call.limit = limit; return query; },
        then(resolve: (value: typeof response) => unknown) { return Promise.resolve(response).then(resolve); },
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const missingColumn = {
  code: "42703",
  message: "column magazine_requests.credits_spent does not exist",
};

test("magazine history preserves recorded charges after the migration without another query", async () => {
  const data = [
    { id: "legacy", credits_spent: 1, status: "PUBLISHED" },
    { id: "current", credits_spent: 3, status: "CANCELED" },
  ];
  const { client, calls } = database([{ data, error: null }]);
  assert.deepEqual(await loadUserMagazineRequests(client, userId), data);
  assert.equal(calls.length, 1);
  assert.match(calls[0].columns!, /credits_spent/);
});

test("only a missing charge column restores owner-scoped legacy history at one credit", async () => {
  const data = [{ id: "legacy", album_title: "Saved album", status: "CANCELED" }];
  const { client, calls } = database([
    { data: null, error: missingColumn },
    { data, error: null },
  ]);
  assert.deepEqual(await loadUserMagazineRequests(client, userId), [{ ...data[0], credits_spent: 1 }]);
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[1].columns!, /credits_spent/);
  for (const call of calls) {
    assert.equal(call.table, "magazine_requests");
    assert.equal(call.owner, userId);
    assert.deepEqual(call.order, ["created_at", { ascending: false }]);
    assert.equal(call.limit, 30);
  }
  assert.equal("credits_spent" in data[0], false, "fallback cannot mutate source rows");
});

test("unrelated database errors do not trigger discounted history or suppress the failure", async () => {
  for (const error of [
    { code: "42501", message: "permission denied for table magazine_requests" },
    { code: "42703", message: "column magazine_requests.admin_memo does not exist" },
    { code: "08006", message: "connection failed" },
  ]) {
    const { client, calls } = database([{ data: null, error }]);
    await assert.rejects(loadUserMagazineRequests(client, userId), /Failed to load magazine requests/);
    assert.equal(calls.length, 1);
  }
});

test("a failed legacy read is not presented as empty history", async () => {
  const { client, calls } = database([
    { data: null, error: missingColumn },
    { data: null, error: { code: "42501", message: "permission denied" } },
  ]);
  await assert.rejects(loadUserMagazineRequests(client, userId), /permission denied/);
  assert.equal(calls.length, 2);
});
