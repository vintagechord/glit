import assert from "node:assert/strict";
import { test } from "node:test";

import { albumDisplayCommands, albumDisplayDetail } from "../src/features/music-archive/album-display";
import { withManagedEntryTracks } from "../src/features/music-archive/member-music-status";
import { groupArchiveAlbums } from "../src/lib/music-archive/album-groups";
import { applyArchiveCommand, createArchiveData, type ArchiveCommand } from "../src/lib/music-archive/model";
import { MV_RATING_MARK_COLORS, mvRatingChipTone } from "../src/lib/mv-rating-colors";
import { groupedAlbumFixture } from "./fixtures/music-archive-grouped-albums";

const reviewTask = { kind: "review" as const, agency: "KBS", status: "completed" as const, result: "eligible" as const, attachmentIds: [] };

test("direct entry on an album with no managed tracks claims the chosen track before saving the record", () => {
  let data = createArchiveData("빈티지코드");
  data = applyArchiveCommand(data, { type: "add_release", release: { id: "release-1", title: "모험은 발끝부터 자란다", type: "single", participation: "primary", links: [] } });
  data = applyArchiveCommand(data, { type: "add_track", track: { id: "track-1", releaseId: "release-1", title: "모험은 발끝부터 자란다", artistName: "grooming shagatto", discNumber: 1, trackNumber: 1, managed: false, links: [] } });
  const save: ArchiveCommand = { type: "save_tasks", id: "entry-1", trackIds: ["track-1"], task: reviewTask };

  // Without the claim the model refuses records on unmanaged tracks.
  assert.throws(() => applyArchiveCommand(data, save), /관리 중인 트랙만/);

  const commands = withManagedEntryTracks([save], data.tracks);
  assert.deepEqual(commands[0], { type: "update_track", trackId: "track-1", patch: { managed: true } });
  const saved = commands.reduce(applyArchiveCommand, data);
  assert.equal(saved.tracks[0].managed, true);
  assert.deepEqual(saved.tasks.map(task => [task.trackId, task.agency, task.result]), [["track-1", "KBS", "eligible"]]);
});

test("direct entry leaves already managed tracks and edits alone", () => {
  let data = createArchiveData("빈티지코드");
  data = applyArchiveCommand(data, { type: "add_release", release: { id: "release-1", title: "앨범", type: "album", participation: "primary", links: [] } });
  data = applyArchiveCommand(data, { type: "add_track", track: { id: "track-1", releaseId: "release-1", title: "곡", discNumber: 1, trackNumber: 1, managed: true, links: [] } });
  const save: ArchiveCommand = { type: "save_tasks", id: "entry-1", trackIds: ["track-1"], task: reviewTask };
  assert.deepEqual(withManagedEntryTracks([save], data.tracks), [save]);
  const update: ArchiveCommand = { type: "update_task", taskId: "x", patch: { memo: "수정" } };
  assert.deepEqual(withManagedEntryTracks([update], data.tracks), [update]);
});

test("deleting a grouped track hides every provider copy and leaves the other songs", () => {
  const detail = groupedAlbumFixture();
  const raw = detail.library.data;
  const displayed = albumDisplayDetail(detail).library.data;
  const target = displayed.tracks[0];
  const commands = albumDisplayCommands([{ type: "set_excluded", entityType: "track", id: target.id, excluded: true }], groupArchiveAlbums(raw));
  const copies = groupArchiveAlbums(raw).flatMap(group => group.tracks).find(group => group.trackIds.includes(target.id))!.trackIds;
  assert.ok(copies.length > 1, "the fixture groups the same song from two providers");
  assert.deepEqual(commands.map(command => command.type === "set_excluded" ? command.id : null).sort(), [...copies].sort());

  const saved = commands.reduce(applyArchiveCommand, raw);
  assert.ok(saved.tracks.filter(track => copies.includes(track.id)).every(track => track.excluded));
  const after = albumDisplayDetail({ ...detail, library: { ...detail.library, data: saved } }).library.data;
  assert.ok(!after.tracks.some(track => track.id === target.id));
  assert.equal(after.tracks.length, displayed.tracks.length - 1);
});

test("the 전체관람가 result uses white text on its green mark", () => {
  assert.equal(MV_RATING_MARK_COLORS.ALL.color, "#ffffff");
  assert.match(mvRatingChipTone("ALL"), /\btext-white\b/);
  assert.doesNotMatch(mvRatingChipTone("ALL"), /text-\[#111111\]/);
});
