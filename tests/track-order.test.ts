import assert from "node:assert/strict";
import test from "node:test";

import { getStationReviewTracks, resolveStationTrackResults, sortByTrackNo, summarizeTrackResults } from "../src/lib/track-results";

// The 런치 album as PostgREST returned it: storage order, not album order.
const stored = [2, 1, 4, 5, 6, 7, 3, 8].map((no) => ({ id: `00000000-0000-4000-8000-00000000000${no}`, track_no: no, track_title: `곡 ${no}`, broadcast_selected: false }));

test("station track lists follow the album order regardless of storage order", () => {
  const results = summarizeTrackResults(resolveStationTrackResults([], stored, "NOT_SENT", { code: "MBC", name: "MBC" })).results;
  assert.deepEqual(results.map((track) => track.track_no), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(getStationReviewTracks(stored, { code: "KBS" }).map((track) => track.track_no), [1, 2, 3, 4, 5, 6, 7, 8]);
  const wbs = stored.map((track) => ({ ...track, broadcast_selected: [5, 1, 3].includes(track.track_no) }));
  assert.deepEqual(getStationReviewTracks(wbs, { code: "WBS" }).map((track) => track.track_no), [1, 3, 5]);
  // Saved results in any order are listed by track number too.
  const saved = [{ track_no: 3, status: "APPROVED" }, { track_no: 1, status: "REJECTED" }, { track_no: 2, status: "PENDING" }];
  assert.deepEqual(summarizeTrackResults(saved).results.map((track) => track.track_no), [1, 2, 3]);
});

test("tracks without a number go last and ties keep their order", () => {
  const rows = [{ track_no: null, id: "a" }, { track_no: 2, id: "b" }, { track_no: 1, id: "c" }, { track_no: 2, id: "d" }];
  assert.deepEqual(sortByTrackNo(rows).map((row) => row.id), ["c", "b", "d", "a"]);
  assert.deepEqual(rows.map((row) => row.id), ["a", "b", "c", "d"], "the input is not mutated");
});
