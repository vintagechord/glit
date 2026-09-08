import assert from "node:assert/strict";
import test from "node:test";
import { applyArchiveCommand, archiveCommandSchema, createArchiveData, summarizeTasks, validateArchiveData, type ArchiveData } from "../src/lib/music-archive/model";

function fixture(): ArchiveData {
  let data = createArchiveData("동명이인 아티스트", "artist-a");
  data = applyArchiveCommand(data, { type: "add_release", release: { id: "release", title: "발매작", type: "ep", participation: "participation", links: [{ provider: "spotify", url: "https://open.spotify.com/album/example" }] } });
  for (const [trackId, version] of [["track-a", "original"], ["track-b", "clean"]]) {
    data = applyArchiveCommand(data, { type: "add_track", track: { id: trackId, releaseId: "release", title: "같은 제목", version, trackNumber: data.tracks.length + 1, managed: true, links: [] } });
  }
  return data;
}
function task(data: ArchiveData, trackIds = ["track-a"], agency = "TJ", taskId = "job"): ArchiveData {
  return applyArchiveCommand(data, { type: "save_tasks", id: taskId, trackIds, task: { kind: "karaoke", agency, status: "completed", result: "listed" } });
}

test("performer submission and completion require an explicit managed participant and role", () => {
  for (const status of ["submitted", "processing", "completed"]) assert.throws(() => applyArchiveCommand(fixture(), { type: "save_tasks", id: "performer", trackIds: ["track-a"], task: { kind: "performer", agency: "FKMP", status, result: "unknown" } }));
  assert.doesNotThrow(() => applyArchiveCommand(fixture(), { type: "save_tasks", id: "performer", trackIds: ["track-a"], task: { kind: "performer", agency: "FKMP", status: "needs_check", result: "unknown" } }));
});

test("same-name artists and same-title recording versions remain separate", () => {
  const first = fixture(); const second = createArchiveData("동명이인 아티스트", "artist-b");
  assert.notEqual(first.artist.id, second.artist.id);
  assert.equal(first.tracks.length, 2);
  const after = task(first);
  assert.equal(after.tasks.length, 1);
  assert.equal(after.tasks[0].trackId, "track-a");
  assert.equal(after.tracks[1].version, "clean");
});

test("command application never mutates source document", () => {
  const before = fixture(); const serialized = JSON.stringify(before);
  task(before);
  assert.equal(JSON.stringify(before), serialized);
});

test("Zod v4 partial patches preserve untouched defaults, links, scope and results", () => {
  const data = fixture();
  const parsed = archiveCommandSchema.parse({ type: "update_release", releaseId: "release", patch: { title: "수정" } });
  assert.deepEqual(parsed, { type: "update_release", releaseId: "release", patch: { title: "수정" } });
  const changed = applyArchiveCommand(data, parsed);
  assert.equal(changed.releases[0].type, "ep");
  assert.equal(changed.releases[0].participation, "participation");
  assert.equal(changed.releases[0].links.length, 1);
  const saved = task(changed);
  const edited = applyArchiveCommand(saved, { type: "update_task", taskId: saved.tasks[0].id, patch: { memo: "메모" } });
  assert.equal(edited.tasks[0].status, "completed");
  assert.equal(edited.tasks[0].result, "listed");
  const track = applyArchiveCommand(edited, { type: "update_track", trackId: "track-b", patch: { title: "제목 수정" } });
  assert.equal(track.tracks[1].trackNumber, 2);
});

test("user cannot forge official/admin/onside provenance or official query success", () => {
  for (const source of ["official", "admin", "onside"]) {
    assert.throws(() => applyArchiveCommand(fixture(), { type: "save_tasks", id: "fake", trackIds: ["track-a"], task: { kind: "karaoke", agency: "TJ", status: "completed", result: "listed", source } }));
  }
  assert.throws(() => applyArchiveCommand(fixture(), { type: "save_tasks", id: "fake", trackIds: ["track-a"], task: { kind: "karaoke", agency: "TJ", queryStatus: "success" } }));
  assert.equal(task(fixture()).tasks[0].source, "user_input");
});

test("evidence means user supplied evidence, never institution verified", () => {
  const saved = applyArchiveCommand(fixture(), { type: "save_tasks", id: "proof", trackIds: ["track-a"], task: { kind: "review", agency: "MBC", executor: "agency", agencyName: "다른 대행사", status: "completed", result: "ineligible", attachmentIds: ["file-a"] } });
  assert.equal(saved.tasks[0].source, "user_evidence");
  assert.equal(saved.tasks[0].executor, "agency");
  assert.equal(saved.tasks[0].result, "ineligible");
  assert.equal(saved.tasks[0].queryStatus, "unsupported");
});

test("missing query results and temporary error never imply unregistered or not started", () => {
  const data = task(fixture());
  for (const queryStatus of ["no_results", "temporary_error", "forbidden"] as const) {
    data.tasks[0].queryStatus = queryStatus;
    const checked = validateArchiveData(data);
    assert.equal(checked.tasks[0].status, "completed");
    assert.equal(checked.tasks[0].result, "listed");
  }
});

test("selected track bulk records and replays are idempotent without inherited results", () => {
  const data = task(fixture(), ["track-a", "track-a"]);
  assert.equal(data.tasks.length, 1);
  assert.equal(task(data).tasks.length, 1);
  const summary = summarizeTasks(data, { releaseId: "release", kind: "karaoke", agency: "TJ" });
  assert.equal(summary.completed, 1);
  assert.equal(summary.missingTracks, 1);
  assert.equal(summary.allComplete, false);
  const both = task(data, ["track-a", "track-b"]);
  assert.equal(summarizeTasks(both, { kind: "karaoke", agency: "TJ" }).allComplete, true);
});

test("TJ and KY are independent and application is distinct from actual listing", () => {
  const data = task(fixture());
  const changed = applyArchiveCommand(data, { type: "save_tasks", id: "ky", trackIds: ["track-a"], task: { kind: "karaoke", agency: "KY", status: "submitted", result: "unknown" } });
  assert.equal(summarizeTasks(changed, { kind: "karaoke", agency: "KY" }).completed, 0);
  assert.equal(summarizeTasks(changed, { kind: "karaoke", agency: "KY" }).awaitingResult, 1);
  assert.equal(summarizeTasks(changed, { kind: "karaoke", agency: "TJ" }).completed, 1);
});

test("not applicable is excluded and participant scopes remain independent", () => {
  let data = applyArchiveCommand(fixture(), { type: "save_tasks", id: "performer-a", trackIds: ["track-a"], task: { kind: "performer", agency: "FKMP", participant: "보컬", role: "보컬", status: "completed", result: "approved" } });
  data = applyArchiveCommand(data, { type: "save_tasks", id: "performer-b", trackIds: ["track-a"], task: { kind: "performer", agency: "FKMP", participant: "세션", role: "기타", status: "needs_check" } });
  data = applyArchiveCommand(data, { type: "save_tasks", id: "na", trackIds: ["track-b"], task: { kind: "performer", agency: "FKMP", status: "not_applicable" } });
  const summary = summarizeTasks(data, { kind: "performer" });
  assert.equal(summary.records, 2); assert.equal(summary.notApplicable, 1); assert.equal(summary.completed, 1); assert.equal(summary.allComplete, false);
});

test("exclude and restore preserve task history, provenance and service source", () => {
  const data = task(fixture());
  data.releases[0].source = { provider: "musicbrainz", externalId: "release-mbid", checkedAt: "2026-09-08T00:00:00Z" };
  const excluded = applyArchiveCommand(data, { type: "set_excluded", entityType: "release", id: "release", excluded: true });
  assert.equal(summarizeTasks(excluded).tracks, 0);
  const restored = applyArchiveCommand(excluded, { type: "set_excluded", entityType: "release", id: "release", excluded: false });
  assert.deepEqual(restored.tasks, data.tasks);
  assert.deepEqual(restored.releases[0].source, data.releases[0].source);
  assert.equal(restored.releases[0].userEdited, true);
});

test("duplicate merges are non-destructive and reversible without result transfer", () => {
  const data = task(fixture());
  const merged = applyArchiveCommand(data, { type: "merge", entityType: "track", id: "track-a", targetId: "track-b" });
  assert.equal(merged.tracks.length, 2);
  assert.equal(merged.tasks[0].trackId, "track-a");
  assert.equal(summarizeTasks(merged, { trackIds: ["track-b"] }).completed, 0);
  assert.throws(() => applyArchiveCommand(merged, { type: "merge", entityType: "track", id: "track-b", targetId: "track-a" }));
  const restored = applyArchiveCommand(merged, { type: "unmerge", entityType: "track", id: "track-a" });
  assert.deepEqual(restored.tasks, data.tasks);
  assert.equal(restored.tracks[0].mergedInto, undefined);
});

test("existing task and review versions cannot silently change", () => {
  const data = task(fixture());
  assert.throws(() => applyArchiveCommand(data, { type: "update_track", trackId: "track-a", patch: { version: "remix" } }), /새 트랙/);
  let linked = applyArchiveCommand(fixture(), { type: "link_review", link: { id: "link", submissionId: "20000000-0000-4000-8000-000000000001", releaseId: "release" } });
  assert.throws(() => applyArchiveCommand(linked, { type: "update_track", trackId: "track-b", patch: { version: "remix" } }), /새 트랙/);
  linked = applyArchiveCommand(linked, { type: "unlink_review", linkId: "link" });
  assert.equal(applyArchiveCommand(linked, { type: "update_track", trackId: "track-b", patch: { version: "remix" } }).tracks[1].version, "remix");
});

test("recording-work relations are explicit and shared relation never copies tasks", () => {
  let data = fixture();
  data = applyArchiveCommand(data, { type: "save_work", work: { id: "work", title: "작품", writers: "작사·작곡", iswc: "T-123456789-0" } });
  data = applyArchiveCommand(data, { type: "save_recording", recording: { id: "recording", title: "원곡", version: "original", workIds: ["work"] } });
  data = applyArchiveCommand(data, { type: "update_track", trackId: "track-a", patch: { recordingId: "recording" } });
  data = applyArchiveCommand(data, { type: "update_track", trackId: "track-b", patch: { recordingId: "recording" } });
  data = task(data);
  assert.equal(summarizeTasks(data, { trackIds: ["track-b"] }).completed, 0);
  assert.throws(() => applyArchiveCommand(data, { type: "save_recording", recording: { id: "recording", title: "원곡", version: "live", workIds: ["work"] } }), /새 녹음/);
});

test("source conflicts require explicit resolution and preserve task history", () => {
  const data = task(fixture());
  data.conflicts.push({ id: "conflict", entityType: "release", entityId: "release", field: "title", current: "발매작", incoming: "새 외부 제목", source: { provider: "musicbrainz", externalId: "mbid", checkedAt: "2026-09-08T00:00:00Z" }, createdAt: "2026-09-08T00:00:00Z" });
  const kept = applyArchiveCommand(data, { type: "resolve_conflict", conflictId: "conflict", resolution: "keep" });
  assert.equal(kept.releases[0].title, "발매작");
  const accepted = applyArchiveCommand(data, { type: "resolve_conflict", conflictId: "conflict", resolution: "accept" });
  assert.equal(accepted.releases[0].title, "새 외부 제목"); assert.deepEqual(accepted.tasks, data.tasks);
});

test("foreign targets and dangerous or mismatched service URLs fail validation", () => {
  assert.throws(() => task(fixture(), ["other-owner-track"]));
  assert.throws(() => applyArchiveCommand(fixture(), { type: "update_artist", patch: { links: [{ provider: "spotify", url: "https://127.0.0.1/private" }] } }));
  assert.throws(() => applyArchiveCommand(fixture(), { type: "update_artist", patch: { links: [{ provider: "spotify", url: "https://open.spotify.com.evil.example/artist/1" }] } }));
  assert.throws(() => applyArchiveCommand(fixture(), { type: "update_artist", patch: { links: [{ provider: "spotify", url: "javascript:alert(1)" }] } }));
});

test("manual affiliation and provider connection do not verify rights or imply integration configured", () => {
  let data = fixture();
  data = applyArchiveCommand(data, { type: "save_affiliation", affiliation: { id: "aff", agency: "KOMCA", participant: "작곡자", status: "joined" } });
  data = applyArchiveCommand(data, { type: "set_connection", connection: { provider: "musicbrainz", externalArtistId: "mbid", confirmed: true } });
  assert.equal(data.tasks.length, 0); assert.equal(data.connections[0].status, "needs_configuration");
  assert.equal(data.affiliations[0].status, "joined");
});

test("task recording and work references must match the selected track relation", () => {
  let data = fixture();
  for (const id of ["work-a", "work-b"]) data = applyArchiveCommand(data, { type: "save_work", work: { id, title: id } });
  for (const id of ["recording-a", "recording-b"]) data = applyArchiveCommand(data, { type: "save_recording", recording: { id, title: id, workIds: ["work-a"] } });
  data = applyArchiveCommand(data, { type: "update_track", trackId: "track-a", patch: { recordingId: "recording-a" } });
  assert.throws(() => applyArchiveCommand(data, { type: "save_tasks", id: "mismatch", trackIds: ["track-a"], task: { kind: "review", agency: "KBS", recordingId: "recording-b", status: "completed", result: "eligible" } }), /녹음 버전/);
  assert.throws(() => applyArchiveCommand(data, { type: "save_tasks", id: "mismatch", trackIds: ["track-a"], task: { kind: "copyright_work", agency: "KOMCA", workId: "work-b", status: "completed", result: "approved" } }), /저작물을 연결/);
  const valid = applyArchiveCommand(data, { type: "save_tasks", id: "matched", trackIds: ["track-a"], task: { kind: "copyright_work", agency: "KOMCA", recordingId: "recording-a", workId: "work-a", status: "completed", result: "approved" } });
  assert.equal(valid.tasks[0].workId, "work-a");
});
