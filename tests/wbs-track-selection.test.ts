import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { saveWbsTrackSelection } from "../src/lib/admin/wbs-track-selection";
import { getStationReviewTracks } from "../src/lib/track-results";

const sid = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const lunchTracks = ["오늘 밤도 안녕", "Ghost", "Like a Coffee", "비, 바람", "Samba Love", "Harmony", "Goodnight Means Goodbye", "Love or Fate"]
  .map((title, index) => ({ id: id(index + 1), track_no: index + 1, track_title: title, broadcast_selected: false }));

type Op = [string, ...unknown[]];
function fakeDb(fixture: { type?: string; tracks?: typeof lunchTracks; wbsResults?: unknown[]; noWbs?: boolean }) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const answer = (table: string, ops: Op[]) => {
    if (table === "submissions") return { data: { id: sid, type: fixture.type ?? "ALBUM" } };
    if (table === "album_tracks" && !ops.some(([op]) => op === "update")) return { data: fixture.tracks ?? lunchTracks };
    if (table === "station_reviews") return { data: fixture.noWbs ? [{ track_results_json: [], station: { code: "KBS", name: "KBS" } }] : [{ track_results_json: fixture.wbsResults ?? [], station: { code: "WBS", name: "WBS 원음방송" } }] };
    return { data: null };
  };
  const db = {
    from(table: string) {
      const call = { table, ops: [] as Op[] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "order", "update", "insert"]) chain[op] = (...args: unknown[]) => { call.ops.push([op, ...args]); return chain; };
      chain.maybeSingle = async () => ({ error: null, ...answer(table, call.ops) });
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, ...answer(table, call.ops) }).then(resolve);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

test("three chosen songs become the 원음방송 targets; other songs are only unmarked", async () => {
  const { db, calls } = fakeDb({});
  const result = await saveWbsTrackSelection(db, { submissionId: sid, trackIds: [id(1), id(3), id(5)], actorUserId: "admin" });
  assert.deepEqual(result, { ok: true, changed: true, selected: 3 });
  const updates = calls.filter((call) => call.table === "album_tracks" && call.ops.some(([op]) => op === "update"));
  assert.equal(updates.length, 1, "nothing was selected before, so only the chosen songs are set");
  assert.deepEqual(updates[0].ops.find(([op]) => op === "update"), ["update", { broadcast_selected: true }]);
  assert.deepEqual(updates[0].ops.find(([op]) => op === "in"), ["in", "id", [id(1), id(3), id(5)]]);
  assert.ok(updates[0].ops.some(([op, column, value]) => op === "eq" && column === "submission_id" && value === sid));
  assert.equal(calls.some((call) => call.table === "album_tracks" && call.ops.some(([op]) => op === "delete")), false, "tracks are never deleted");
  const event = calls.find((call) => call.table === "submission_events")?.ops.find(([op]) => op === "insert")?.[1] as { message: string };
  assert.match(event.message, /원음방송 심의곡을 3곡으로 지정했습니다: 1\. 오늘 밤도 안녕, 3\. Like a Coffee, 5\. Samba Love/);

  // What the WBS row then shows.
  const marked = lunchTracks.map((track) => ({ ...track, broadcast_selected: [1, 3, 5].includes(track.track_no) }));
  assert.deepEqual(getStationReviewTracks(marked, { code: "WBS" }).map((track) => track.track_no), [1, 3, 5]);
  assert.equal(getStationReviewTracks(marked, { code: "KBS" }).length, 8);
});

test("changing the selection clears the songs left out", async () => {
  const tracks = lunchTracks.map((track) => ({ ...track, broadcast_selected: [1, 2, 3].includes(track.track_no) }));
  const { db, calls } = fakeDb({ tracks });
  await saveWbsTrackSelection(db, { submissionId: sid, trackIds: [id(1), id(3), id(4)], actorUserId: "admin" });
  const updates = calls.filter((call) => call.table === "album_tracks" && call.ops.some(([op]) => op === "update"));
  assert.deepEqual(updates.map((call) => [call.ops.find(([op]) => op === "update")?.[1], call.ops.find(([op]) => op === "in")?.[2]]), [
    [{ broadcast_selected: false }, [id(2)]],
    [{ broadcast_selected: true }, [id(4)]],
  ]);
});

test("refusals: more than three songs, short albums, no WBS review, songs with saved WBS results", async () => {
  assert.equal((await saveWbsTrackSelection(fakeDb({}).db, { submissionId: sid, trackIds: [id(1), id(2), id(3), id(4)], actorUserId: "a" })).ok, false);
  assert.equal((await saveWbsTrackSelection(fakeDb({}).db, { submissionId: sid, trackIds: [], actorUserId: "a" })).ok, false);
  assert.equal((await saveWbsTrackSelection(fakeDb({ tracks: lunchTracks.slice(0, 3) }).db, { submissionId: sid, trackIds: [id(1)], actorUserId: "a" })).ok, false);
  assert.equal((await saveWbsTrackSelection(fakeDb({ noWbs: true }).db, { submissionId: sid, trackIds: [id(1)], actorUserId: "a" })).ok, false);
  assert.equal((await saveWbsTrackSelection(fakeDb({ type: "MV_BROADCAST" }).db, { submissionId: sid, trackIds: [id(1)], actorUserId: "a" })).ok, false);
  assert.equal((await saveWbsTrackSelection(fakeDb({}).db, { submissionId: sid, trackIds: ["99999999-9999-4999-8999-999999999999"], actorUserId: "a" })).ok, false);
  const decided = fakeDb({ wbsResults: [{ track_id: id(8), track_no: 8, status: "APPROVED" }] });
  const refused = await saveWbsTrackSelection(decided.db, { submissionId: sid, trackIds: [id(1), id(2), id(3)], actorUserId: "a" });
  assert.equal(refused.ok, false);
  assert.equal(decided.calls.some((call) => call.ops.some(([op]) => op === "update")), false);
  // Keeping the decided song is allowed.
  assert.equal((await saveWbsTrackSelection(fakeDb({ wbsResults: [{ track_id: id(8), track_no: 8, status: "APPROVED" }] }).db, { submissionId: sid, trackIds: [id(1), id(3), id(8)], actorUserId: "a" })).ok, true);
});
