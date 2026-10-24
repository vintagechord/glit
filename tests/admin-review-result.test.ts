import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { completeMvReviewFlow } from "../src/lib/admin/mv-review-flow";

test("review saves use one atomic RPC and leave failure handling to the database transaction", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  let fail = true;
  const client = {
    from() { throw Error("split writes are forbidden"); },
    async rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return fail ? { data: null, error: { message: "private fixture DB response" } }
        : { data: { completed: true, changed: false, stationCount: 1, resultStatus: "APPROVED" }, error: null };
    },
  } as unknown as SupabaseClient;
  const input = { actorUserId: "admin-fixture", rating: "15", resultStatus: "APPROVED" };
  const failed = await completeMvReviewFlow(client, "submission-fixture", input);
  assert.equal(failed.completed, false);
  assert.doesNotMatch(failed.error ?? "", /private fixture/);
  fail = false;
  const retry = await completeMvReviewFlow(client, "submission-fixture", input);
  assert.equal(retry.completed, true);
  assert.equal(retry.changed, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, "save_submission_review_result");
  assert.equal((calls[0].args as Record<string, unknown>).p_actor_user_id, "admin-fixture");
  assert.equal((calls[0].args as Record<string, unknown>).p_set_result_memo, false);
});
