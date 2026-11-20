import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAdminDashboard } from "../src/lib/admin/dashboard-summary";

type Op = [string, ...unknown[]];

/** Answers every dashboard query; count queries for albums waiting on a station get `partial`. */
function fakeDb(partial: number | null) {
  const db = {
    from(table: string) {
      const ops: Op[] = [];
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "neq", "in", "is", "not", "or", "gte", "order", "limit"]) {
        chain[op] = (...args: unknown[]) => { ops.push([op, ...args]); return chain; };
      }
      const answer = () => {
        // The partial-notice filter: albums moved on with the button, and result
        // mails sent while a station result was open (both in one or() list).
        const waitingOnStation = table === "submissions" &&
          ops.some(([op, filters]) => op === "or" && String(filters).includes("partial_result_notified_at.not.is.null"));
        if (waitingOnStation) return partial === null ? { count: null, data: null, error: { message: "down" } } : { count: partial, data: null, error: null };
        return { count: 0, data: [], error: null };
      };
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve);
      return chain;
    },
  } as unknown as SupabaseClient;
  return db;
}

test("the dashboard counts the albums sent on with a station still pending", async () => {
  const dashboard = await loadAdminDashboard(fakeDb(3), new Date("2026-11-16T03:00:00Z"));
  assert.equal(dashboard.partialNotices, 3);
  assert.deepEqual(dashboard.failedSections, []);
});

test("a failed count is reported instead of shown as zero", async () => {
  const dashboard = await loadAdminDashboard(fakeDb(null), new Date("2026-11-16T03:00:00Z"));
  assert.equal(dashboard.partialNotices, null);
  assert.ok(dashboard.failedSections.includes("처리 현황"));
});
