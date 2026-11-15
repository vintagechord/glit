import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { setPartialResultNotice } from "../src/lib/admin/partial-result-notice";

const sid = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-11-16T03:00:00.000Z");

type Op = [string, ...unknown[]];
type Fixture = {
  type?: string;
  status?: string;
  payment?: string;
  marked?: string | null;
  reviews?: Array<{ status: string; station: { name: string; code: string } }>;
  updateMisses?: boolean;
};

// 2026-11: every station but TBS has announced its result.
const tbsPending = [
  { status: "APPROVED", station: { name: "KBS", code: "KBS" } },
  { status: "REJECTED", station: { name: "MBC", code: "MBC" } },
  { status: "SENT", station: { name: "TBS", code: "TBS" } },
];

function fakeDb(fixture: Fixture) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const answer = (table: string, ops: Op[]) => {
    if (table === "submissions" && ops.some(([op]) => op === "update")) return { data: fixture.updateMisses ? null : { id: sid } };
    if (table === "submissions") {
      return { data: {
        id: sid, type: fixture.type ?? "ALBUM", status: fixture.status ?? "IN_PROGRESS",
        payment_status: fixture.payment ?? "PAID", partial_result_notified_at: fixture.marked ?? null,
      } };
    }
    if (table === "station_reviews") return { data: fixture.reviews ?? tbsPending };
    return { data: null };
  };
  const db = {
    from(table: string) {
      const call = { table, ops: [] as Op[] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "not", "update", "insert"]) chain[op] = (...args: unknown[]) => { call.ops.push([op, ...args]); return chain; };
      chain.maybeSingle = async () => ({ error: null, ...answer(table, call.ops) });
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, ...answer(table, call.ops) }).then(resolve);
      return chain;
    },
  } as unknown as SupabaseClient;
  const updates = () => calls.filter((call) => call.table === "submissions" && call.ops.some(([op]) => op === "update"));
  const events = () => calls.filter((call) => call.table === "submission_events")
    .map((call) => call.ops.find(([op]) => op === "insert")?.[1] as { event_type: string; message: string; actor_user_id: string });
  return { db, updates, events };
}

test("an album with one station still pending is sent on, and its review status is left alone", async () => {
  const { db, updates, events } = fakeDb({});
  const result = await setPartialResultNotice(db, { submissionId: sid, closed: true, actorUserId: "admin", now });
  assert.deepEqual(result, { ok: true, changed: true });

  assert.equal(updates().length, 1);
  // Only the mark: the application stays IN_PROGRESS and its results are untouched.
  assert.deepEqual(updates()[0].ops.find(([op]) => op === "update"), ["update", { partial_result_notified_at: now.toISOString() }]);
  assert.ok(updates()[0].ops.some(([op, column, value]) => op === "eq" && column === "id" && value === sid));
  // A result saved for the last station in the meantime must not be overridden.
  assert.ok(updates()[0].ops.some(([op, column, value]) => op === "eq" && column === "status" && value === "IN_PROGRESS"));

  assert.equal(events().length, 1);
  assert.equal(events()[0].event_type, "ADMIN_STATUS");
  assert.equal(events()[0].actor_user_id, "admin");
  assert.match(events()[0].message, /결과 통보 완료/);
  assert.match(events()[0].message, /TBS/, "the station still pending is on record");
  assert.doesNotMatch(events()[0].message, /KBS|MBC/);
});

test("it refuses anything that is not a paid album in review with a station result", async () => {
  const refused: Fixture[] = [
    { type: "MV_BROADCAST" },
    { type: "MV_DISTRIBUTION" },
    { payment: "PAYMENT_PENDING" },
    { payment: "REFUNDED" },
    { status: "PRE_REVIEW" },
    // Every station decided: the normal result mail moves it on.
    { status: "RESULT_READY" },
    { reviews: [{ status: "SENT", station: { name: "KBS", code: "KBS" } }, { status: "NEEDS_FIX", station: { name: "MBC", code: "MBC" } }] },
    { reviews: [] },
  ];
  for (const fixture of refused) {
    const { db, updates, events } = fakeDb(fixture);
    const result = await setPartialResultNotice(db, { submissionId: sid, closed: true, actorUserId: "admin", now });
    assert.equal(result.ok, false, JSON.stringify(fixture));
    assert.equal(updates().length, 0, JSON.stringify(fixture));
    assert.equal(events().length, 0, JSON.stringify(fixture));
  }
  assert.equal((await setPartialResultNotice(fakeDb({}).db, { submissionId: "not-an-id", closed: true, actorUserId: "admin", now })).ok, false);
});

test("sending the same album on twice changes nothing", async () => {
  const { db, updates, events } = fakeDb({ marked: "2026-11-15T00:00:00.000Z" });
  assert.deepEqual(await setPartialResultNotice(db, { submissionId: sid, closed: true, actorUserId: "admin", now }), { ok: true, changed: false });
  assert.equal(updates().length, 0);
  assert.equal(events().length, 0);
});

test("the operator can put the album back into review", async () => {
  const { db, updates, events } = fakeDb({ marked: "2026-11-15T00:00:00.000Z" });
  assert.deepEqual(await setPartialResultNotice(db, { submissionId: sid, closed: false, actorUserId: "admin", now }), { ok: true, changed: true });
  assert.deepEqual(updates()[0].ops.find(([op]) => op === "update"), ["update", { partial_result_notified_at: null }]);
  assert.match(events()[0].message, /심의 진행 중/);

  // Nothing to undo.
  const idle = fakeDb({});
  assert.deepEqual(await setPartialResultNotice(idle.db, { submissionId: sid, closed: false, actorUserId: "admin", now }), { ok: true, changed: false });
  assert.equal(idle.updates().length, 0);
  assert.equal(idle.events().length, 0);
});

test("a result saved for the last station while the button was pressed wins", async () => {
  const { db, events } = fakeDb({ updateMisses: true });
  const result = await setPartialResultNotice(db, { submissionId: sid, closed: true, actorUserId: "admin", now });
  assert.equal(result.ok, false);
  assert.equal(events().length, 0);
});
