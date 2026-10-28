import assert from "node:assert/strict";
import { test } from "node:test";
import { albumDisplayCommands, albumDisplayDetail, libraryDisplayCounts } from "../src/features/music-archive/album-display";
import { groupArchiveAlbums } from "../src/lib/music-archive/album-groups";
import { applyArchiveCommand, validateArchiveData } from "../src/lib/music-archive/model";
import { additionalStationReviewTracks, unreviewedArchiveTracks } from "../src/lib/music-archive/reviews";
import { groupedAlbumFixture } from "./fixtures/music-archive-grouped-albums";

test("display joins verified credits and preserves independent same-agency task IDs without mutating originals", () => {
  const detail = groupedAlbumFixture(); const before = structuredClone(detail);
  const displayed = albumDisplayDetail(detail);
  assert.deepEqual(detail, before);
  assert.equal(displayed.library.data.releases.length, 1);
  assert.equal(displayed.library.data.tracks.length, 2);
  assert.deepEqual(libraryDisplayCounts(detail.library), { releaseCount: 1, trackCount: 1 });
  const track = displayed.library.data.tracks[0];
  assert.equal(displayed.library.data.recordings.find(item => item.id === track.recordingId)?.workIds.length, 2);
  assert.deepEqual(displayed.library.data.tasks.map(task => task.id), detail.library.data.tasks.map(task => task.id));
  assert.deepEqual(displayed.library.data.tasks.map(task => task.trackId), [track.id, track.id]);
  assert.deepEqual(unreviewedArchiveTracks(displayed.library.data, "melon-release:100", []), []);
  assert.equal(additionalStationReviewTracks(displayed.library.data, "melon-release:100", []).length, 1);
});

test("legacy whole-album review only covers original songs, leaving unmatched grouped songs uncovered", () => {
  const detail = groupedAlbumFixture(); detail.library.data.tasks = [];
  for (const [index, release] of detail.library.data.releases.entries()) detail.library.data.tracks.push({ ...detail.library.data.tracks[0], id: `extra-${index}`, releaseId: release.id, trackNumber: 3, title: index ? "세 번째 곡" : "재생 불가", recordingId: undefined, managed: Boolean(index), links: [] });
  detail.onsideReviews = [{ submissionId: "review-1", releaseId: "melon-release:100", trackIds: [], status: "COMPLETED" }];
  const displayed = albumDisplayDetail(detail);
  assert.equal(displayed.library.data.releases.length, 1);
  assert.deepEqual(unreviewedArchiveTracks(displayed.library.data, "melon-release:100", displayed.onsideReviews!).map(track => track.id), ["extra-1"]);
  assert.ok(!displayed.onsideReviews![0].trackIds.includes("extra-1"));
});

test("shared source recordings cannot leak another logical song's alias credits into the display", () => {
  const detail = groupedAlbumFixture();
  const raw = detail.library.data;
  const first = raw.tracks.find(track => track.id === "melon-track:100:1000")!;
  const second = raw.tracks.find(track => track.id === "melon-track:100:1001")!;
  second.recordingId = first.recordingId;
  detail.library.data = validateArchiveData(raw);
  const before = structuredClone(detail);
  const displayed = albumDisplayDetail(detail).library.data;
  const firstDisplay = displayed.tracks.find(track => track.id === first.id)!;
  const secondDisplay = displayed.tracks.find(track => track.id === second.id)!;
  const workIds = (recordingId?: string) => displayed.recordings.find(recording => recording.id === recordingId)!.workIds;
  assert.notEqual(firstDisplay.recordingId, secondDisplay.recordingId);
  assert.deepEqual(workIds(firstDisplay.recordingId), ["melon-work:work-0", "genie-work:work-0"]);
  assert.deepEqual(workIds(secondDisplay.recordingId), ["melon-work:work-0", "genie-work:work-1"]);
  assert.deepEqual(detail, before);
  assert.deepEqual(displayed.tracks.map(track => track.id), ["melon-track:100:1000", "melon-track:100:1001"]);
  const commands = albumDisplayCommands([{ type: "update_track", trackId: secondDisplay.id, patch: { title: "정리한 곡" } }], groupArchiveAlbums(raw));
  assert.ok(commands.every(command => command.type === "update_track" && !("recordingId" in command.patch)));
  const saved = commands.reduce(applyArchiveCommand, raw);
  assert.deepEqual(saved.tracks.map(track => track.recordingId), raw.tracks.map(track => track.recordingId));
  assert.ok(saved.recordings.every(recording => !recording.id.startsWith("display-recording:")));
});

test("one submission linked through two sources appears once with only its explicit track scope", () => {
  const detail = groupedAlbumFixture();
  detail.onsideReviews = ["melon", "genie"].map((provider, index) => ({ submissionId: "review-1", releaseId: `${provider}-release:${100 + index}`, trackIds: [`${provider}-track:${100 + index}:${1000 + index * 10}`], status: "COMPLETED" }));
  assert.deepEqual(albumDisplayDetail(detail).onsideReviews, [{ submissionId: "review-1", releaseId: "melon-release:100", trackIds: ["melon-track:100:1000"], status: "COMPLETED" }]);
});

test("shared album edits fan out only shared fields and retain each original source link", () => {
  const detail = groupedAlbumFixture(); const raw = detail.library.data;
  const commands = albumDisplayCommands([{ type: "update_release", releaseId: "melon-release:100", patch: { title: "내가 정리한 앨범", links: raw.releases[0].links } }], groupArchiveAlbums(raw));
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1], { type: "update_release", releaseId: "genie-release:101", patch: { title: "내가 정리한 앨범" } });
  const saved = commands.reduce(applyArchiveCommand, raw);
  assert.equal(groupArchiveAlbums(saved).length, 1);
  assert.deepEqual(saved.releases.map(release => release.links), raw.releases.map(release => release.links));
  assert.equal(raw.releases[0].title, "함께 만든 앨범");
});

test("track alias edits preserve the model history guard and never broadcast recording or management changes", () => {
  const detail = groupedAlbumFixture();
  const commands = albumDisplayCommands([{ type: "update_track", trackId: "melon-track:100:1000", patch: { version: "Live", managed: false } }], groupArchiveAlbums(detail.library.data));
  assert.deepEqual(commands[1], { type: "update_track", trackId: "genie-track:101:1010", patch: { version: "Live" } });
  assert.throws(() => commands.reduce(applyArchiveCommand, detail.library.data), /업무 이력/);
});

test("adding a song to a grouped album keeps one logical song and album with actual distinct source IDs", () => {
  const raw = groupedAlbumFixture().library.data;
  const commands = albumDisplayCommands([
    { type: "save_recording", recording: { id: "manual-recording", title: "직접 추가한 곡", workIds: [] } },
    { type: "add_track", track: { id: "manual-track", releaseId: "melon-release:100", title: "직접 추가한 곡", artistName: "테스트 뮤지션", recordingId: "manual-recording", discNumber: 1, trackNumber: 3, managed: true, links: [] } },
  ], groupArchiveAlbums(raw));
  const saved = commands.reduce(applyArchiveCommand, raw);
  const groups = groupArchiveAlbums(saved);
  assert.equal(groups.length, 1); assert.equal(groups[0].tracks.length, 3);
  const manual = saved.tracks.filter(track => track.recordingId === "manual-recording");
  assert.equal(new Set(manual.map(track => track.id)).size, 2);
  assert.deepEqual(manual.map(track => track.releaseId), ["melon-release:100", "genie-release:101"]);
  assert.ok(manual.every(track => track.links.length === 0));
});
