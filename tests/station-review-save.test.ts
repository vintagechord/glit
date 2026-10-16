import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveStationReview, resolveStationStatusForSave } from "../src/lib/admin/station-review-save";
import { getStationReviewTracks, normalizeTrackResults, resolveStationTrackResults } from "../src/lib/track-results";

test("admin camelCase track numbers and titles survive normalization", () => {
  assert.deepEqual(normalizeTrackResults([{ trackNo: 2, status: "APPROVED" }], [
    { id: "two", track_no: 2, track_title: "두 번째 곡" },
  ]), [{ track_id: null, track_no: 2, title: "두 번째 곡", status: "APPROVED" }]);
});

test("legacy overall approvals populate tracks without approving partially reviewed albums", () => {
  const album = [{ id: "one", track_no: 1 }, { id: "two", track_no: 2 }];
  assert.deepEqual(resolveStationTrackResults([], album, "APPROVED").map(t => t.status), ["APPROVED", "APPROVED"]);
  assert.deepEqual(resolveStationTrackResults([{ track_id: "one", status: "APPROVED" }], album, "APPROVED").map(t => t.status), ["APPROVED", "PENDING"]);
  assert.deepEqual(resolveStationTrackResults([{ track_id: "other", track_no: 1, status: "APPROVED" }], album, "APPROVED").map(t => t.status), ["PENDING", "PENDING"]);
});

test("track decisions control status while correction requests remain actionable", () => {
  assert.equal(resolveStationStatusForSave("APPROVED", [{ status: "APPROVED" }, { status: "PENDING" }]), "SENT");
  assert.equal(resolveStationStatusForSave("SENT", [{ status: "REJECTED" }]), "REJECTED");
  assert.equal(resolveStationStatusForSave("NEEDS_FIX", [{ status: "APPROVED" }]), "NEEDS_FIX");
  assert.equal(resolveStationStatusForSave("APPROVED", [{ status: "APPROVED" }, { status: "REJECTED" }, { status: "PENDING" }]), "SENT");
});

test("unknown WBS targets do not inherit overall approval or infer arbitrary songs", () => {
  const tracks = [1, 2, 3, 4].map(track_no => ({ id: `track-${track_no}`, track_no }));
  const station = { code: "WBS" };
  assert.deepEqual(resolveStationTrackResults([], tracks, "APPROVED", station).map(track => track.status), ["PENDING", "PENDING", "PENDING", "PENDING"]);
  const finals = [1, 2, 4].map(no => ({ track_id: `track-${no}`, status: "APPROVED" }));
  assert.deepEqual(getStationReviewTracks(tracks, station, finals).map(track => track.track_no), [1, 2, 4]);
  assert.deepEqual(resolveStationTrackResults(finals, tracks, "APPROVED", station).map(track => track.status), ["APPROVED", "APPROVED", "APPROVED"]);
  assert.equal(getStationReviewTracks(tracks, station, [1, 2, 4].map(no => ({ track_no: no, status: "APPROVED" }))).length, 4, "numbers alone cannot prove targets");
  assert.deepEqual(resolveStationTrackResults([1, 2, 3, 4].map(no => ({ track_id: `track-${no}`, status: "APPROVED" })), tracks, "APPROVED", station).map(track => track.status), ["PENDING", "PENDING", "PENDING", "PENDING"]);
});

test("only WBS uses the three explicitly selected tracks of a longer album", () => {
  const tracks = [1, 2, 3, 4].map(track_no => ({ track_no, broadcast_selected: track_no <= 3 }));
  assert.deepEqual(getStationReviewTracks(tracks, { code: "WBS" }).map(t => t.track_no), [1, 2, 3]);
  assert.equal(getStationReviewTracks(tracks, { code: "KBS" }).length, 4);
  assert.equal(getStationReviewTracks(tracks.map(t => ({ ...t, broadcast_selected: null })), { code: "WBS" }).length, 4);
});

function fixture(columns: string[], failure = false) {
  const writes: Record<string, unknown>[] = [];
  const attempts: Record<string, unknown>[] = [];
  const original = { id: "review", submission_id: "submission", station_id: "station", status: "SENT", result_note: null, updated_at: "old", track_results_json: [] };
  const current: Record<string, unknown> = { ...original };
  const client = { from() { return { update(payload: Record<string, unknown>) {
    const query = { eq() { return query; }, async select() {
      attempts.push(payload);
      const missing = Object.keys(payload).find(key => key.startsWith("track_results") && !columns.includes(key));
      if (missing) return { data: null, error: { code: "PGRST204", message: `Could not find the '${missing}' column` } };
      if (failure) return { data: null, error: { code: "42501", message: "permission denied" } };
      Object.assign(current, payload);
      writes.push(payload);
      return { data: [{ ...current, track_results: payload.track_results_json ?? payload.track_results }], error: null };
    } };
    return query;
  } }; } } as unknown as SupabaseClient;
  return { client, original, current, writes, attempts };
}

const input = { reviewId: "review", submissionId: "submission", stationId: "station", status: "APPROVED" as const, resultNote: "확인 완료", trackResults: [{ track_no: 1, status: "APPROVED" }] };

test("canonical and legacy schemas persist status, note and tracks in the same successful write", async () => {
  for (const columns of [["track_results_json"], ["track_results"], ["track_results_json", "track_results"]]) {
    const f = fixture(columns);
    const result = await saveStationReview(f.client, input);
    assert.equal(result.error, undefined);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].status, "APPROVED");
    assert.equal(f.writes[0].result_note, "확인 완료");
    assert.ok(f.writes[0][columns[0]]);
    assert.equal(result.row?.status, "APPROVED");
  }
});

test("missing track columns and database failures never publish a standalone approval", async () => {
  for (const f of [fixture([]), fixture(["track_results_json", "track_results"], true)]) {
    const result = await saveStationReview(f.client, input);
    assert.ok(result.error);
    assert.deepEqual(f.current, f.original);
    assert.equal(f.writes.length, 0);
    assert.ok(f.attempts.every(attempt => "track_results_json" in attempt || "track_results" in attempt));
  }
});
