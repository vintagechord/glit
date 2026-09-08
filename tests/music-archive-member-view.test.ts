import assert from "node:assert/strict";
import test from "node:test";
import { memberArchiveResponse } from "../src/lib/music-archive/member-view";
import { createArchiveData, applyArchiveCommand } from "../src/lib/music-archive/model";
import { matchArchiveReviews } from "../src/lib/music-archive/reviews";

function catalog() {
  let data = createArchiveData("Artist");
  data = applyArchiveCommand(data, { type: "add_release", release: { id: "album", title: "Album", links: [{ provider: "apple", url: "https://music.apple.com/kr/album/a/123" }] } });
  for (let index = 1; index <= 2; index++) data = applyArchiveCommand(data, { type: "add_track", track: { id: `track-${index}`, releaseId: "album", title: `Song ${index}`, trackNumber: index } });
  return data;
}

test("member API boundary strips provenance and private operational records without mutating stored data", () => {
  const data = catalog();
  data.releases[0].source = { provider: "apple", externalId: "123", checkedAt: "2026-09-09T00:00:00Z" };
  const raw = { library: { id: "library", owner_id: "private-owner", version: 1, data }, events: [{ details: "secret audit" }], evidence: [{ file_name: "private evidence" }], jobs: [{ id: "new", library_id: "library", provider: "apple", external_artist_id: "1", status: "completed", created_at: "2026-09-09", cursor: { token: "internal cursor" } }, { id: "old", library_id: "library", provider: "apple", external_artist_id: "1", status: "failed", created_at: "2026-09-08", error_message: "internal error" }], providers: [{ id: "apple", status: "available", automaticImplemented: true, message: "source details", checkedAt: "date" }] };
  const projected = memberArchiveResponse(raw);
  const serialized = JSON.stringify(projected);
  assert.doesNotMatch(serialized, /private-owner|secret audit|private evidence|internal cursor|internal error|source details|checkedAt|"source"/);
  assert.deepEqual(projected.jobs, [{ id: "new", library_id: "library", status: "completed" }]);
  assert.equal(raw.library.data.releases[0].source?.provider, "apple");
  assert.equal(raw.jobs.length, 2);
});

test("auto review matches canonical exact album identities and never matching titles alone", () => {
  const data = catalog();
  const results = matchArchiveReviews(data, [{ id: "a", status: "COMPLETED", melon_url: "https://music.apple.com/us/album/different-slug/123" }, { id: "b", status: "COMPLETED", melon_url: "https://music.apple.com/kr/album/a/999" }, { id: "draft", status: "DRAFT", melon_url: "https://music.apple.com/kr/album/a/123" }]);
  assert.deepEqual(results.map(row => row.submissionId), ["a"]);
  assert.deepEqual(results[0].trackIds, []);
});

test("explicit and persisted selection scopes never become whole-album results", () => {
  const data = catalog();
  data.reviewLinks.push({ id: "link", submissionId: "10000000-0000-4000-8000-000000000001", releaseId: "album", trackId: "track-1", submissionTrackId: "20000000-0000-4000-8000-000000000001" });
  const results = matchArchiveReviews(data, [
    { id: data.reviewLinks[0].submissionId, status: "COMPLETED", melon_url: data.releases[0].links[0].url },
    { id: "snapshot", status: "SUBMITTED", archive_review_context: { libraryId: "library", releaseId: "album", trackIds: ["track-2", "not-in-library"] } },
    { id: "other-library", status: "SUBMITTED", archive_review_context: { libraryId: "other", releaseId: "album", trackIds: ["track-1"] } },
  ], "library");
  assert.deepEqual(results.map(row => row.trackIds), [["track-1"], ["track-2"]]);
});

test("old URL applications with selected rows and ambiguous duplicate identities do not widen scope", () => {
  const data = catalog();
  const submission = { id: "old", status: "COMPLETED", melon_url: data.releases[0].links[0].url, album_tracks: [{ track_no: 2, track_title_kr: "Song 2" }] };
  assert.deepEqual(matchArchiveReviews(data, [submission])[0].trackIds, ["track-2"]);
  data.releases.push({ ...data.releases[0], id: "duplicate" });
  assert.deepEqual(matchArchiveReviews(data, [submission]), []);
});
