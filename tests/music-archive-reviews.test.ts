import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { archiveReviewProgress, isArchiveDraftSubmission, linkedTrackResult, matchArchiveReviews, unreviewedArchiveTracks } from "../src/lib/music-archive/reviews";
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

test("archive progress follows current station decisions while retaining pending results", () => {
  const album_tracks = [{ id: "original", track_no: 1, track_title: "Whispers in the Dark" }];
  const approved = { status: "APPROVED", track_results_json: [{ track_id: "original", status: "APPROVED" }] };
  const rejected = { status: "REJECTED", track_results_json: [{ track_id: "original", status: "REJECTED" }] };
  assert.equal(archiveReviewProgress({ status: "IN_PROGRESS", album_tracks, station_reviews: [approved, rejected] }), "COMPLETED");
  assert.equal(archiveReviewProgress({ status: "RESULT_READY", album_tracks, station_reviews: [approved, { status: "SENT" }] }), "IN_PROGRESS");
  assert.equal(archiveReviewProgress({ status: "COMPLETED", album_tracks, station_reviews: [{ status: "NEEDS_FIX" }] }), "IN_PROGRESS");
  assert.equal(archiveReviewProgress({ status: "RESULT_READY", station_reviews: [] }), "COMPLETED");
  assert.equal(archiveReviewProgress({ status: "SUBMITTED", station_reviews: [] }), "SUBMITTED");
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

test("a paid PRE_REVIEW application counts as applied while an unpaid one stays a draft", () => {
  const { library: { data } } = groupedAlbumFixture();
  const context = { libraryId: groupedLibraryId, releaseId: "melon-release:100", trackIds: ["melon-track:100:1000"] };
  assert.equal(isArchiveDraftSubmission({ status: "PRE_REVIEW", payment_status: "PAID" }), false);
  assert.equal(isArchiveDraftSubmission({ status: "PRE_REVIEW", payment_status: "UNPAID" }), true);
  assert.equal(isArchiveDraftSubmission({ status: "PRE_REVIEW" }), true, "unknown payment stays conservative");
  assert.equal(isArchiveDraftSubmission({ status: "DRAFT", payment_status: "PAID" }), true);
  const paid = matchArchiveReviews(data, [{ id: "paid", status: "PRE_REVIEW", payment_status: "PAID", archive_review_context: context }], groupedLibraryId);
  assert.deepEqual(paid.map(scope => [scope.submissionId, scope.status]), [["paid", "PRE_REVIEW"]]);
  assert.deepEqual(matchArchiveReviews(data, [{ id: "draft", status: "PRE_REVIEW", payment_status: "UNPAID", archive_review_context: context }], groupedLibraryId), []);
  const releaseId = paid[0].releaseId;
  data.tasks = [];
  assert.ok(unreviewedArchiveTracks(data, releaseId, []).some(track => paid[0].trackIds.includes(track.id)), "fixture track needs an application");
  const pending = unreviewedArchiveTracks(data, releaseId, paid);
  assert.ok(!pending.some(track => paid[0].trackIds.includes(track.id)), "the paid track is not offered again");
  assert.match(
    readFileSync(new URL("../src/lib/music-archive/credits.ts", import.meta.url), "utf8"),
    /select\("id,status,payment_status,/,
  );
});
