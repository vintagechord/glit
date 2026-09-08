import assert from "node:assert/strict";
import test from "node:test";
import { mergeArchiveImports } from "../src/lib/music-archive/import";
import { applyArchiveCommand, createArchiveData, summarizeTasks } from "../src/lib/music-archive/model";
import type { ImportedRelease } from "../src/lib/music-archive/providers";

function release(externalId = "release-a", recordingId = "recording-a", version = ""): ImportedRelease {
  return { provider: "musicbrainz", externalId, title: "동일 앨범명", date: "2026-09-01", type: "album", secondaryTypes: [], participation: false, artistName: "동명이인", artistIds: ["artist-a"], barcode: "8800000000011", version, country: "KR", imageUrl: null, url: `https://musicbrainz.org/release/${externalId}`, checkedAt: "2026-09-08T00:00:00Z", tracks: [{ externalId: `appearance-${externalId}`, recordingId, title: "동일 곡명", version, artistName: "동명이인", artistIds: ["artist-a"], position: 1, discNumber: 1, durationMs: 180000, isrcs: ["KRABC2600001"], managedByArtist: true, url: `https://musicbrainz.org/recording/${recordingId}` }] };
}

test("repeat synchronization uses external IDs and keeps separate same-title releases", () => {
  const incoming = [release("release-a"), release("release-b")];
  const first = mergeArchiveImports(createArchiveData("동명이인"), incoming);
  const replay = mergeArchiveImports(first, incoming);
  assert.equal(replay.releases.length, 2);
  assert.equal(replay.tracks.length, 2);
  assert.equal(replay.recordings.length, 1);
  assert.equal(replay.tasks.length, 0, "provider metadata cannot invent work results or agency selections");
  assert.equal(replay.conflicts.length, 0);
  assert.deepEqual(replay, first);
});

test("sync preserves user corrections, exclusions and completed task provenance; conflicts are explicit", () => {
  const incoming = release();
  let data = mergeArchiveImports(createArchiveData("동명이인"), [incoming]);
  const trackId = data.tracks[0].id;
  data = applyArchiveCommand(data, { type: "update_release", releaseId: data.releases[0].id, patch: { title: "사용자 수정 제목" } });
  data = applyArchiveCommand(data, { type: "save_tasks", id: "record", trackIds: [trackId], task: { kind: "review", agency: "KBS", status: "completed", result: "ineligible", executor: "self" } });
  data = applyArchiveCommand(data, { type: "set_excluded", entityType: "track", id: trackId, excluded: true });
  const replay = mergeArchiveImports(data, [{ ...incoming, title: "변경된 외부 제목", checkedAt: "2026-09-08T01:00:00Z" }]);
  assert.equal(replay.releases[0].title, "사용자 수정 제목");
  assert.equal(replay.tracks[0].excluded, true);
  assert.deepEqual(replay.tasks, data.tasks);
  assert.equal(replay.tasks[0].source, "user_input");
  assert.equal(replay.conflicts.find(item => item.field === "title")?.incoming, "변경된 외부 제목");
  const again = mergeArchiveImports(replay, [{ ...incoming, title: "변경된 외부 제목", checkedAt: "2026-09-08T01:00:00Z" }]);
  assert.equal(again.conflicts.length, replay.conflicts.length);
});

test("different versions remain separate even when a provider reuses a conflicting recording identifier", () => {
  const original = release("release-original", "same-external-recording", "original");
  const clean = release("release-clean", "same-external-recording", "clean");
  const data = mergeArchiveImports(createArchiveData("아티스트"), [original, clean]);
  assert.equal(data.recordings.length, 2);
  assert.notEqual(data.tracks[0].recordingId, data.tracks[1].recordingId);
});

test("other artists' compilation tracks have no automatic managed work items", () => {
  const compilation = release();
  compilation.participation = true;
  compilation.tracks.push({ ...compilation.tracks[0], externalId: "other-appearance", recordingId: "other-recording", position: 2, artistName: "다른 아티스트", artistIds: ["other-artist"], managedByArtist: false });
  const data = mergeArchiveImports(createArchiveData("아티스트"), [compilation]);
  assert.equal(data.releases[0].participation, "participation");
  assert.equal(data.tracks.length, 2);
  assert.equal(summarizeTasks(data).tracks, 1);
  assert.throws(() => applyArchiveCommand(data, { type: "save_tasks", id: "bad-scope", trackIds: [data.tracks[1].id], task: { kind: "review", agency: "KBS", status: "completed", result: "eligible" } }), /관리 중인 트랙/);
});

test("source disappearance does not delete owner review references or task records", () => {
  let data = mergeArchiveImports(createArchiveData("아티스트"), [release()]);
  data = applyArchiveCommand(data, { type: "link_review", link: { id: "review-link", submissionId: "20000000-0000-4000-8000-000000000001", releaseId: data.releases[0].id } });
  data = applyArchiveCommand(data, { type: "save_tasks", id: "record", trackIds: [data.tracks[0].id], task: { kind: "copyright_work", agency: "KOMCA", status: "completed", result: "approved" } });
  assert.deepEqual(mergeArchiveImports(data, []), data);
});

test("accepting provider conflict cannot migrate reviewed recording versions", () => {
  let data = mergeArchiveImports(createArchiveData("아티스트"), [release("release-a", "recording-a", "original")]);
  data = applyArchiveCommand(data, { type: "save_tasks", id: "record", trackIds: [data.tracks[0].id], task: { kind: "review", agency: "MBC", status: "completed", result: "eligible" } });
  const replay = mergeArchiveImports(data, [release("release-a", "recording-b", "clean")]);
  const conflict = replay.conflicts.find(item => item.entityType === "track" && item.field === "recordingId");
  assert.ok(conflict);
  assert.throws(() => applyArchiveCommand(replay, { type: "resolve_conflict", conflictId: conflict.id, resolution: "accept" }), /새 트랙/);
  assert.equal(replay.tasks[0].result, "eligible");
  assert.equal(replay.tracks[0].version, "original");
});

test("separate owner documents sharing public metadata never share private task records", () => {
  let ownerA = mergeArchiveImports(createArchiveData("동명이인"), [release()]);
  const ownerB = mergeArchiveImports(createArchiveData("동명이인"), [release()]);
  ownerA = applyArchiveCommand(ownerA, { type: "save_tasks", id: "private", trackIds: [ownerA.tracks[0].id], task: { kind: "performer", agency: "FKMP", participant: "참여자", role: "보컬", status: "completed", result: "approved", memo: "비공개 메모" } });
  assert.equal(mergeArchiveImports(ownerB, [release()]).tasks.length, 0);
  assert.equal(ownerA.tasks[0].memo, "비공개 메모");
});
