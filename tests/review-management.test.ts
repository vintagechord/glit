import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveManagedOnlineReview, saveManagedStationReview, saveManagedStationReviews, type ManagedStationReviewInput } from "../src/lib/admin/review-management";

const sid = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const stationId = "33333333-3333-4333-8333-333333333333";
const revision = "2026-10-25T00:00:00.000Z";
const trackId = (no: number) => `44444444-4444-4444-8444-44444444444${no}`;
const input: ManagedStationReviewInput = { submissionId: sid, actorUserId: actor, stationId, expectedUpdatedAt: revision, status: "APPROVED", ageRating: "15" };
type Row = Record<string, unknown>;
function fixture({ type = "MV_BROADCAST", code = "KBS", previous = { updated_at: revision, status: "SENT", age_rating: null }, tracks = [], rpcError = null }: { type?: string; code?: string; previous?: Row | null; tracks?: Row[]; rpcError?: { message: string } | null } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      const data = { submissions: { id: sid, type }, station_reviews: previous, stations: { id: stationId, code, name: code }, album_tracks: tracks }[table];
      const result = { data, error: null };
      const query = { select() { return query; }, eq() { return query; }, maybeSingle() { return Promise.resolve(result); }, then(resolve: (value: unknown) => unknown) { return Promise.resolve(result).then(resolve); } };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: rpcError ? null : { completed: true, changed: true, savedCount: Array.isArray(args.p_updates) ? args.p_updates.length : undefined, changeKey: "revision-2", submissionStatus: "IN_PROGRESS", row: { id: "review", status: args.p_status, age_rating: args.p_age_rating, track_results_json: args.p_track_results } }, error: rpcError };
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

test("broadcast saves use one guarded transaction and carry exact displayed station revision", async () => {
  const f = fixture();
  const saved = await saveManagedStationReview(f.db, { ...input, resultNote: "  KBS 결과  " });
  assert.equal(saved.ok, true);
  assert.equal(saved.row?.age_rating, "15");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, "save_station_review_result");
  assert.equal(f.calls[0].args.p_expected_updated_at, revision);
  assert.equal(f.calls[0].args.p_result_note, "KBS 결과");
  assert.deepEqual(f.calls[0].args.p_track_results, []);
});

test("stale review and missing broadcast rating never issue a write", async () => {
  const stale = fixture({ previous: { updated_at: "2026-10-25T00:00:01.000Z" } });
  assert.equal((await saveManagedStationReview(stale.db, input)).errorCode, "CONFLICT");
  assert.equal(stale.calls.length, 0);
  const missing = fixture();
  assert.equal((await saveManagedStationReview(missing.db, { ...input, ageRating: null })).errorCode, "RATING_REQUIRED");
  assert.equal(missing.calls.length, 0);
});

test("omitted rating/memo preserves a final result and reopening clears its grade", async () => {
  const f = fixture({ previous: { updated_at: revision, status: "APPROVED", age_rating: "12", result_note: "유지할 메모" } });
  assert.equal((await saveManagedStationReview(f.db, { ...input, ageRating: undefined })).ok, true);
  assert.equal(f.calls[0].args.p_age_rating, "12");
  assert.equal(f.calls[0].args.p_result_note, "유지할 메모");
  assert.equal((await saveManagedStationReview(f.db, { ...input, status: "NEEDS_FIX", ageRating: "12" })).ok, true);
  assert.equal(f.calls[1].args.p_age_rating, null);
});

test("album progress stays RECEIVED and partial decisions cannot publish an overall final", async () => {
  const tracks = [1, 2].map(no => ({ id: trackId(no), track_no: no }));
  const f = fixture({ type: "ALBUM", tracks });
  assert.equal((await saveManagedStationReview(f.db, { ...input, status: "RECEIVED", ageRating: null, trackResults: tracks.map(t => ({ trackId: t.id, trackNo: t.track_no, status: "PENDING" })) })).ok, true);
  assert.equal(f.calls[0].args.p_status, "RECEIVED");
  assert.equal((await saveManagedStationReview(f.db, { ...input, ageRating: null, trackResults: [{ trackId: trackId(1), trackNo: 1, status: "APPROVED" }] })).ok, true);
  assert.equal(f.calls[1].args.p_status, "SENT");
  assert.equal((f.calls[1].args.p_track_results as Row[])[1].status, "PENDING");
});

test("WBS receives only selected tracks; unknown IDs and excessive finals are rejected", async () => {
  const tracks = [1, 2, 3, 4].map(no => ({ id: trackId(no), track_no: no, broadcast_selected: no <= 3 }));
  const f = fixture({ type: "ALBUM", code: "WBS", tracks });
  const valid = await saveManagedStationReview(f.db, { ...input, ageRating: null, trackResults: tracks.slice(0, 3).map(t => ({ trackId: t.id, trackNo: t.track_no, status: "APPROVED" })) });
  assert.equal(valid.ok, true);
  assert.equal((f.calls[0].args.p_track_results as Row[]).length, 3);
  assert.equal((await saveManagedStationReview(f.db, { ...input, ageRating: null, trackResults: tracks.map(t => ({ trackId: t.id, trackNo: t.track_no, status: "APPROVED" })) })).errorCode, "INVALID_TRACK");
  assert.equal((await saveManagedStationReview(f.db, { ...input, ageRating: null, trackResults: [{ trackId: trackId(5), status: "APPROVED" }] })).errorCode, "INVALID_TRACK");
  assert.equal(f.calls.length, 1);
});

test("transaction conflicts and missing migration errors are safe actionable errors", async () => {
  const f = fixture({ rpcError: { message: "REVIEW_CONFLICT" } });
  const result = await saveManagedStationReview(f.db, input);
  assert.equal(result.errorCode, "CONFLICT");
  assert.match(result.error ?? "", /최신 내용/);
});

test("online review normalizes legacy 18 rating and requires displayed submission revision", async () => {
  const f = fixture();
  assert.equal((await saveManagedOnlineReview(f.db, { submissionId: sid, actorUserId: actor, expectedUpdatedAt: revision, rating: "18" })).ok, true);
  assert.equal(f.calls[0].name, "save_online_review_result");
  assert.equal(f.calls[0].args.p_rating, "19");
  assert.equal(f.calls[0].args.p_expected_updated_at, revision);
  assert.equal((await saveManagedOnlineReview(f.db, { submissionId: sid, actorUserId: actor, expectedUpdatedAt: "", rating: "15" })).ok, false);
  assert.equal(f.calls.length, 1);
});

test("WBS legacy unknown selection accepts three final IDs plus other pending form rows", async () => {
  const tracks = [1, 2, 3, 4].map(no => ({ id: trackId(no), track_no: no, broadcast_selected: null }));
  const f = fixture({ type: "ALBUM", code: "WBS", tracks });
  const saved = await saveManagedStationReview(f.db, { ...input, ageRating: null, status: "SENT", trackResults: tracks.map(t => ({ trackId: t.id, trackNo: t.track_no, status: t.track_no <= 3 ? "APPROVED" : "PENDING" })) });
  assert.equal(saved.ok, true);
  assert.equal(f.calls[0].args.p_status, "APPROVED");
  assert.equal((f.calls[0].args.p_track_results as Row[]).length, 3);
});


test("explicit overall changes replace stale per-track decisions instead of reverting the selected state", async () => {
  const tracks = [1, 2].map(no => ({ id: trackId(no), track_no: no }));
  const old = tracks.map(t => ({ trackId: t.id, trackNo: t.track_no, status: "APPROVED" as const }));
  const f = fixture({ type: "ALBUM", tracks, previous: { updated_at: revision, status: "APPROVED", track_results_json: old } });
  for (const status of ["NOT_SENT", "SENT", "REJECTED", "NEEDS_FIX"] as const) {
    const saved = await saveManagedStationReview(f.db, { ...input, status, ageRating: null, trackResults: old, applyOverallStatus: true });
    assert.equal(saved.ok, true);
    assert.equal(f.calls.at(-1)?.args.p_status, status);
    assert.ok((f.calls.at(-1)?.args.p_track_results as Row[]).every(t => t.status === (status === "REJECTED" ? "REJECTED" : "PENDING")));
  }
});

test("bulk validates every revision before one RPC, preserves notes, and forces the requested overall decision", async () => {
  const tracks = [1, 2].map(no => ({ id: trackId(no), track_no: no }));
  const f = fixture({ type: "ALBUM", tracks, previous: { updated_at: revision, status: "APPROVED", result_note: "기존 안내", track_results_json: tracks.map(t => ({track_id:t.id, track_no:t.track_no,status:"REJECTED"})) } });
  const stations = [stationId, "55555555-5555-4555-8555-555555555555"].map(stationId => ({stationId,expectedUpdatedAt:revision}));
  const saved = await saveManagedStationReviews(f.db, { actorUserId: actor, submissionId: sid, stations, status: "APPROVED" });
  assert.equal(saved.ok,true);assert.equal(saved.savedCount,2);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,"save_station_review_results_bulk");
  const entries = f.calls[0].args.p_updates as Row[];
  assert.ok(entries.every(row=>row.resultNote === "기존 안내" && row.status === "APPROVED"));
  assert.ok(entries.every(row=>(row.trackResults as Row[]).every(t=>t.status === "APPROVED")));
  const stale = await saveManagedStationReviews(f.db,{actorUserId:actor,submissionId:sid,stations:[stations[0],{...stations[1],expectedUpdatedAt:null}],status:"SENT"});
  assert.equal(stale.ok,false);assert.equal(stale.errorCode,"CONFLICT");assert.equal(f.calls.length,1);
  const duplicate = await saveManagedStationReviews(f.db,{actorUserId:actor,submissionId:sid,stations:[stations[0],stations[0]],status:"SENT"});
  assert.equal(duplicate.ok,false);assert.equal(f.calls.length,1);
});
