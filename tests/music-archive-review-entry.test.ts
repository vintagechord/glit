import assert from "node:assert/strict";
import test from "node:test";
import { applyArchiveCommand, createArchiveData } from "../src/lib/music-archive/model";
import { resolveArchiveReviewEntry } from "../src/lib/music-archive/review-entry";
import { buildArchiveReviewEntryHref } from "../src/lib/music-archive/review-entry-url";

const libraryId = "10000000-0000-4000-8000-000000000001";
function fixture() {
  let data = createArchiveData("한국 가수");
  for (const id of ["release", "other-release"]) data = applyArchiveCommand(data, { type: "add_release", release: { id, title: "동명 앨범", links: [{ provider: "apple", url: "https://music.apple.com/kr/album/12345" }] } });
  for (const [id, releaseId, trackNumber] of [["one", "release", 1], ["two", "release", 2], ["other", "other-release", 1]] as const) data = applyArchiveCommand(data, { type: "add_track", track: { id, releaseId, title: "동명 곡", trackNumber } });
  return data;
}

test("archive entry keeps exact album/track scope and never merges same titles", () => {
  const data = fixture();
  const album = resolveArchiveReviewEntry(data, { libraryId, releaseId: "release" });
  assert.deepEqual(album.tracks.map(track => track.id), ["one", "two"]);
  const track = resolveArchiveReviewEntry(data, { libraryId, releaseId: "release", trackId: "two" });
  assert.deepEqual(track.tracks.map(track => track.id), ["two"]);
  assert.equal(track.albumUrl, "https://music.apple.com/kr/album/12345");
  assert.throws(() => resolveArchiveReviewEntry(data, { libraryId, releaseId: "release", trackId: "other" }), /신청할 음원/);
});

test("excluded, merged and unmanaged tracks cannot be submitted by stale entry links", () => {
  const data = fixture();
  data.tracks[0].excluded = true;
  assert.deepEqual(resolveArchiveReviewEntry(data, { libraryId, releaseId: "release" }).tracks.map(track => track.id), ["two"]);
  assert.throws(() => resolveArchiveReviewEntry(data, { libraryId, releaseId: "release", trackId: "one" }));
  data.tracks[1].managed = false;
  assert.throws(() => resolveArchiveReviewEntry(data, { libraryId, releaseId: "release" }));
  data.releases[0].mergedInto = "other-release";
  assert.throws(() => resolveArchiveReviewEntry(data, { libraryId, releaseId: "release" }));
});

test("archive entry rejects artist/song links and safely encodes identifiers", () => {
  const data = fixture();
  data.releases[0].links[0].url = "https://music.apple.com/kr/artist/name/12345";
  assert.throws(() => resolveArchiveReviewEntry(data, { libraryId, releaseId: "release" }), /발매 링크/);
  const href = buildArchiveReviewEntryHref({ libraryId, releaseId: "a&archiveTrack=wrong", trackId: "곡/1", localePrefix: "/en" });
  const url = new URL(href, "https://onside.test");
  assert.equal(url.pathname, "/en/dashboard/new/album");
  assert.equal(url.searchParams.get("archiveRelease"), "a&archiveTrack=wrong");
  assert.equal(url.searchParams.get("archiveTrack"), "곡/1");
});


test("persisted track snapshots do not widen when later sync adds another song", () => {
  const data = fixture();
  const entry = resolveArchiveReviewEntry(data, { libraryId, releaseId: "release" }, ["one"]);
  assert.deepEqual(entry.tracks.map(track => track.id), ["one"]);
  assert.throws(() => resolveArchiveReviewEntry(data, { libraryId, releaseId: "release" }, ["one", "missing"]), /관리 상태가 변경/);
});
