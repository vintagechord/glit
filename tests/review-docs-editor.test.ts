import assert from "node:assert/strict";
import test from "node:test";
import { emptyReviewData, validateReviewData } from "../src/lib/review-docs/model";
import { alignTranslationSegments, emptyAlbum, emptyTrack, mergeReviewAlbums, moveReviewTrack, reorderReviewTrack } from "../src/features/review-docs/editor";

function fixture() {
  return { ...emptyReviewData("album", "2026-09-07"), sources: [{ id: "source1", kind: "file" as const, name: "자료.docx", text: "원문", warnings: [] }], albums: [
    { ...emptyAlbum("album1"), artistName: "아티스트", title: "같은 앨범", company: "원래 회사", sourceIds: ["source1"], tracks: [{ ...emptyTrack("t1", 1), title: "첫 번째", sourceIds: ["source1"] }, { ...emptyTrack("t2", 2), title: "두 번째" }], wbsTrackIds: ["t1"] },
    { ...emptyAlbum("album2"), title: "같은 앨범", company: "다른 회사", tracks: [{ ...emptyTrack("t3", 1), title: "추가 곡" }] },
  ] };
}

test("review editor reorders tracks without changing their text or source links", () => {
  const data = fixture(); const changed = reorderReviewTrack(data, "album1", "t1", 1);
  assert.deepEqual(changed.albums[0].tracks.map((track) => [track.id, track.number]), [["t2", 1], ["t1", 2]]);
  assert.deepEqual(changed.albums[0].tracks[1].sourceIds, ["source1"]);
  assert.equal(data.albums[0].tracks[0].id, "t1");
});

test("moving a track enables explicit album splitting and preserves source provenance", () => {
  const changed = moveReviewTrack(fixture(), "album1", "t1", "album2");
  assert.deepEqual(changed.albums[0].wbsTrackIds, []);
  assert.equal(changed.albums[0].tracks[0].number, 1);
  assert.deepEqual(changed.albums[1].tracks.map((track) => [track.id, track.number]), [["t3", 1], ["t1", 2]]);
  assert.deepEqual(changed.albums[1].sourceIds, ["source1"]);
});

test("merging retains tracks and conflicting original metadata for administrator review", () => {
  const data = fixture(); const changed = mergeReviewAlbums(data, "album2", "album1");
  assert.equal(changed.albums.length, 1);
  assert.equal(changed.albums[0].tracks.length, 3);
  assert.equal(changed.albums[0].company, "원래 회사");
  const conflict = changed.issues.find((issue) => issue.code === "MERGE_CONFLICT");
  assert.match(conflict?.message ?? "", /원래 회사.*다른 회사/);
  assert.equal(validateReviewData(changed).some((issue) => issue.id === conflict?.id), true);
  assert.equal(data.albums.length, 2);
});

test("translation editing keeps repeated foreign spans distinct and never copies a stale translation onto changed lyrics", () => {
  const track = alignTranslationSegments({ ...emptyTrack("t", 1), lyrics: "Hello world\n우리 노래\nHello world" });
  assert.equal(track.translationSegments.length, 2);
  track.translationSegments[0].translation = "안녕 세상";
  track.translationSegments[0].confirmed = true;
  const same = alignTranslationSegments(track);
  assert.equal(same.translationSegments[0].translation, "안녕 세상");
  assert.equal(same.translationSegments[1].translation, "");
  const changed = alignTranslationSegments({ ...track, lyrics: "Goodbye world\n우리 노래\nHello world" });
  assert.equal(changed.translationSegments[0].translation, "");
  assert.equal(changed.translationSegments[0].confirmed, false);
});
