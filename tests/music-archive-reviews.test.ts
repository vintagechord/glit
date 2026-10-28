import { test } from "node:test";
import assert from "node:assert/strict";
import { linkedTrackResult, matchArchiveReviews } from "../src/lib/music-archive/reviews";
import { resolveArchiveReviewEntry } from "../src/lib/music-archive/review-entry";
import { groupedAlbumFixture, groupedLibraryId } from "./fixtures/music-archive-grouped-albums";

test("archive reads the latest exact mapped track result without resetting persisted approval", () => {
  const row = { status: "SENT", track_results_json: [{ track_id: "a", status: "APPROVED" }, { track_id: "b", status: "REJECTED" }], updated_at: "2026-09-08" };
  assert.equal(linkedTrackResult(row, "a").result, "approved");
  assert.equal(linkedTrackResult(row, "b").result, "rejected");
  assert.equal(linkedTrackResult({ ...row, track_results_json: JSON.stringify(row.track_results_json) }, "a").result, "approved");
  assert.deepEqual(row.track_results_json[0], { track_id: "a", status: "APPROVED" });
});
test("completed submission or album result never approves an unmapped version", () => {
  assert.equal(linkedTrackResult({ status: "APPROVED", track_results_json: [{ track_id: "original", title: "Same", status: "APPROVED" }] }, "clean").result, "unknown");
  assert.equal(linkedTrackResult({ status: "COMPLETED" }, "a").result, "unknown");
});

test("a grouped review snapshot reconnects its exact managed provider track before explicit links exist", () => {
  const { library: { data } } = groupedAlbumFixture();
  data.tracks.find(track => track.id === "melon-track:100:1000")!.managed = false;
  const context = { libraryId: groupedLibraryId, releaseId: "melon-release:100" };
  const entry = resolveArchiveReviewEntry(data, context);
  assert.deepEqual(entry.tracks.map(track => track.id), ["genie-track:101:1010"]);
  const original = structuredClone(data);
  const results = matchArchiveReviews(data, [{ id: "saved", status: "COMPLETED", archive_review_context: { ...entry.context, trackIds: entry.tracks.map(track => track.id) } }], groupedLibraryId);
  assert.deepEqual(results, [{ submissionId: "saved", releaseId: "genie-release:101", trackIds: ["genie-track:101:1010"], status: "COMPLETED" }]);
  assert.deepEqual(data, original);
});

test("snapshot matching preserves separate original album scopes and deduplicates only repeated real IDs", () => {
  const { library: { data } } = groupedAlbumFixture();
  const results = matchArchiveReviews(data, [{ id: "saved", status: "SUBMITTED", archive_review_context: { libraryId: groupedLibraryId, releaseId: "melon-release:100", trackIds: ["genie-track:101:1010", "melon-track:100:1000", "genie-track:101:1010", "missing"] } }], groupedLibraryId);
  assert.deepEqual(results.map(scope => [scope.releaseId, scope.trackIds]), [["genie-release:101", ["genie-track:101:1010"]], ["melon-release:100", ["melon-track:100:1000"]]]);
  assert.ok(results.every(scope => scope.trackIds.length > 0), "an exact snapshot never becomes a whole-album scope");
});

test("invalid, empty or foreign saved contexts never fall through to whole-album URL matching", () => {
  const { library: { data } } = groupedAlbumFixture();
  const base = { libraryId: groupedLibraryId, releaseId: "melon-release:100" };
  for (const context of [{ ...base, trackIds: [] }, { ...base, trackIds: ["missing"] }, { ...base, trackIds: null }, { ...base, libraryId: "another-library", trackIds: ["melon-track:100:1000"] }]) {
    assert.deepEqual(matchArchiveReviews(data, [{ id: "saved", status: "COMPLETED", melon_url: data.releases[0].links[0].url, archive_review_context: context }], groupedLibraryId), []);
  }
});

test("saved review snapshots cannot bridge different editions, excluded albums or excluded/merged tracks", () => {
  for (const scenario of ["edition", "album", "excluded", "merged"] as const) {
    const { library: { data } } = groupedAlbumFixture();
    const genie = data.releases.find(release => release.id === "genie-release:101")!;
    const track = data.tracks.find(item => item.id === "genie-track:101:1010")!;
    if (scenario === "edition") genie.version = "Live";
    if (scenario === "album") genie.excluded = true;
    if (scenario === "excluded") track.excluded = true;
    if (scenario === "merged") track.mergedInto = "genie-track:101:1011";
    const context = { libraryId: groupedLibraryId, releaseId: scenario === "edition" ? "melon-release:100" : "genie-release:101", trackIds: [track.id] };
    assert.deepEqual(matchArchiveReviews(data, [{ id: "saved", status: "COMPLETED", melon_url: data.releases[0].links[0].url, archive_review_context: context }], groupedLibraryId), []);
  }
});
