import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { findArchiveAlbumGroup, groupArchiveAlbums } from "../src/lib/music-archive/album-groups";
import { createArchiveData, validateArchiveData, type ArchiveData, type ArchiveProvider, type ServiceLink } from "../src/lib/music-archive/model";
import { memberLibrary } from "../src/lib/music-archive/member-view";
import { mergeArchiveImports } from "../src/lib/music-archive/import";
import type { ImportedRelease } from "../src/lib/music-archive/providers";

const date = "2026-10-28T00:00:00Z";
function link(provider: ArchiveProvider, id: string, kind: "album" | "track"): ServiceLink {
  return { provider, url: provider === "melon" ? `https://www.melon.com/${kind === "album" ? "album" : "song"}/detail.htm?${kind === "album" ? "album" : "song"}Id=${id}` : provider === "genie" ? `https://www.genie.co.kr/detail/${kind === "album" ? "albumInfo?axnm" : "songInfo?xgnm"}=${id}` : `https://music.bugs.co.kr/${kind}/${id}` };
}
function addAlbum(data: ArchiveData, provider: "melon" | "genie" | "bugs", id: string, titles = ["첫 곡", "둘째 곡", "셋째 곡"]) {
  const releaseId = `${provider}:${id}`;
  data.releases.push({ id: releaseId, title: "앨범", releaseDate: "2026-01-12", artistName: "가수", type: "album", participation: "primary", links: [link(provider, id, "album")], excluded: false, userEdited: false });
  titles.forEach((title, index) => data.tracks.push({ id: `${releaseId}:${index + 1}`, releaseId, title, artistName: "가수", discNumber: 1, trackNumber: index + 1, managed: true, links: [link(provider, `${id}${index + 1}`, "track")], excluded: false, userEdited: false }));
  return releaseId;
}
function pair(titles?: string[]) {
  const data = createArchiveData("가수"); addAlbum(data, "melon", "100", titles); addAlbum(data, "genie", "200", titles); return data;
}
function publicCatalog() {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/music-archive-album-groups/vintage-chord-public-catalog.json", import.meta.url), "utf8"));
  return validateArchiveData({ ...createArchiveData("빈티지코드"), releases: fixture.releases, tracks: fixture.tracks });
}
function freeze(value: object) {
  for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child);
  Object.freeze(value);
}

test("official public Melon/Genie catalog groups 26 albums into 14 while preserving 57 verifiable track groups", () => {
  const data = publicCatalog(); const before = structuredClone(data); freeze(data);
  const groups = groupArchiveAlbums(data);
  assert.equal(groups.length, 14);
  assert.equal(groups.filter(group => group.releaseIds.length === 2).length, 12);
  assert.equal(groups.flatMap(group => group.tracks).length, 57);
  assert.equal(groups.flatMap(group => group.tracks).flatMap(track => track.trackIds).length, 108);
  assert.deepEqual(new Set(groups.flatMap(group => group.releaseIds)), new Set(data.releases.map(release => release.id)));
  assert.deepEqual(data, before);
  for (const group of groups) {
    assert.ok(data.releases.some(release => release.id === group.release.id));
    for (const track of group.tracks) assert.ok(data.tracks.some(original => original.id === track.track.id && original.recordingId === track.track.recordingId && original.releaseId === track.track.releaseId));
    assert.equal(group.release.links.length, group.releaseIds.length);
  }
  const moon = findArchiveAlbumGroup(data, "genie-album:80937505")!;
  assert.equal(moon.release.id, "melon-album:10053210"); assert.equal(moon.tracks.length, 11);
  assert.equal(moon.tracks.find(track => track.track.title === "재생 불가")?.trackIds.length, 1);
  assert.equal(findArchiveAlbumGroup(data, "genie-album:80816955")?.tracks.length, 12);
  assert.equal(findArchiveAlbumGroup(data, "unknown"), undefined);
  assert.deepEqual(groupArchiveAlbums({ ...data, releases: [...data.releases].reverse(), tracks: [...data.tracks].reverse() }), groups);
});

test("public link provenance produces identical grouping after internal source metadata is stripped", () => {
  const data = pair();
  data.releases.forEach(release => { release.source = { provider: "spotify", externalId: "unrelated-internal-source", checkedAt: date }; });
  data.tracks.forEach(track => { track.source = { provider: "spotify", externalId: "unrelated-internal-source", checkedAt: date }; });
  const member = validateArchiveData(memberLibrary({ data }).data);
  const identities = (input: ArchiveData) => groupArchiveAlbums(input).map(group => [group.release.id, group.releaseIds, group.tracks.map(track => [track.track.id, track.trackIds])]);
  assert.deepEqual(identities(data), identities(member));
  data.releases[1].links = [];
  assert.equal(groupArchiveAlbums(data).length, 2, "private source cannot stand in for a missing public album link");
  data.releases[1].links = [link("melon", "200", "album")];
  assert.equal(groupArchiveAlbums(data).length, 2, "same-provider releases never auto-group");
});

test("precise date, editions, artist, barcode and complete track positions prevent mistaken album matches", () => {
  const changes: ((data: ArchiveData) => void)[] = [
    data => { data.releases[1].releaseDate = "2026-01-13"; },
    data => { data.releases.forEach(release => { release.releaseDate = "2026-01"; }); },
    data => { data.releases.forEach(release => { release.releaseDate = "2026-02-30"; }); },
    data => { data.releases[1].title += " (Deluxe)"; },
    data => { data.releases[1].version = "Remastered"; },
    data => { data.releases[1].artistName = "동명이 아닌 다른 가수"; },
    data => { data.releases[0].barcode = "111"; data.releases[1].barcode = "222"; },
    data => { data.releases[1].type = "single"; },
    data => { data.tracks.pop(); },
    data => { data.tracks[3].trackNumber = 2; },
    data => { data.tracks[3].discNumber = 2; },
    data => { data.tracks[3].title += " (Live)"; },
    data => { data.tracks[3].version = "Instrumental"; },
    data => { data.tracks[3].artistName = "다른 가수"; },
  ];
  for (const change of changes) { const data = pair(); change(data); assert.equal(groupArchiveAlbums(data).length, 2); }
  const unknownType = pair(); unknownType.releases[1].type = "other";
  assert.equal(groupArchiveAlbums(unknownType).length, 1);
  const noTracks = pair(); noTracks.tracks = [];
  assert.equal(groupArchiveAlbums(noTracks).length, 2);
});

test("provider typography aliases retain guest names and meaningful track versions", () => {
  const data = createArchiveData("가수");
  addAlbum(data, "melon", "100", ["노래 (Vocal by SunizShine)", "밤 (With. RUWA)", "함께 (Feat.디아빈슬로)", "Our Intro", "노래 (With FADE, 디아빈슬로)"]);
  addAlbum(data, "genie", "200", ["노래 (Vocal. SunizShine)", "밤 (With RUWA)", "함께 (Feat. 디아빈슬로)", "OUR (Intro)", "노래 (With FADE & 디아빈슬로)"]);
  assert.equal(groupArchiveAlbums(data).length, 1);
  data.tracks[5].title = "노래 (Vocal. Iroso)";
  assert.equal(groupArchiveAlbums(data).length, 2, "a different vocalist is not a typography alias");
});

test("one placeholder can group a sufficiently known album but never becomes a track alias or ignores version conflicts", () => {
  const data = pair(); data.tracks[5].title = "재생 불가";
  const groups = groupArchiveAlbums(data);
  assert.equal(groups.length, 1); assert.equal(groups[0].tracks.length, 4);
  assert.equal(groups[0].tracks.find(track => track.track.id === data.tracks[5].id)?.trackIds.length, 1);
  data.tracks[5].version = "Instrumental";
  assert.equal(groupArchiveAlbums(data).length, 2);
  delete data.tracks[5].version; data.tracks[4].title = "재생 불가";
  assert.equal(groupArchiveAlbums(data).length, 2);
  const short = pair(["known", "hidden"]); short.tracks[3].title = "재생 불가";
  assert.equal(groupArchiveAlbums(short).length, 2);
});

test("valid ISRC matches may reconcile title spelling but conflicting ISRC or edition metadata blocks aliases", () => {
  const data = pair(["곡"]);
  data.tracks[0].recordingId = "r1"; data.tracks[1].recordingId = "r2";
  data.recordings = [{ id: "r1", title: "곡", isrc: "KR-A01-26-00001", workIds: [] }, { id: "r2", title: "곡", isrc: "KRA012600001", workIds: [] }];
  data.tracks[1].title = "곡의 다른 표기";
  assert.equal(groupArchiveAlbums(data).length, 1);
  data.tracks[1].title = "곡 (Live)";
  assert.equal(groupArchiveAlbums(data).length, 2);
  data.tracks[1].title = "곡 - Live";
  assert.equal(groupArchiveAlbums(data).length, 2);
  data.tracks[1].title = "곡의 다른 표기"; data.recordings.forEach(recording => { recording.isrc = "not-an-isrc"; });
  assert.equal(groupArchiveAlbums(data).length, 2);
  data.recordings[0].isrc = "KRA012600001";
  data.tracks[1].title = "곡"; data.recordings[1].isrc = "KRA012600002";
  assert.equal(groupArchiveAlbums(data).length, 2);
  data.recordings[1].isrc = "KRA012600001"; data.recordings[1].version = "Live";
  assert.equal(groupArchiveAlbums(data).length, 2);
  const missing = pair(); missing.tracks[2].recordingId = "r1"; missing.tracks[5].recordingId = "r2"; missing.tracks[5].title = "재생 불가";
  missing.recordings = [{ id: "r1", title: "곡", isrc: "KRA012600001", workIds: [] }, { id: "r2", title: "곡", isrc: "KRA012600002", workIds: [] }];
  assert.equal(groupArchiveAlbums(missing).length, 2, "a placeholder cannot bypass contradictory identifiers");
});

test("ambiguous same-provider duplicates and non-transitive artist matches remain separate", () => {
  const data = pair(); addAlbum(data, "melon", "300");
  assert.equal(groupArchiveAlbums(data).length, 3);
  const chain = pair(); addAlbum(chain, "bugs", "300");
  chain.releases[0].artistName = "가수A"; chain.releases[1].artistName = "가수A & 가수B"; chain.releases[2].artistName = "가수B";
  assert.equal(groupArchiveAlbums(chain).length, 3);
  const three = pair(); addAlbum(three, "bugs", "300");
  const groups = groupArchiveAlbums(three);
  assert.equal(groups.length, 1); assert.equal(groups[0].releaseIds.length, 3); assert.ok(groups[0].tracks.every(track => track.trackIds.length === 3));
});

test("excluded and explicitly merged records are never resurrected or used to manufacture a match", () => {
  const data = pair(); data.releases[1].excluded = true;
  assert.deepEqual(groupArchiveAlbums(data).flatMap(group => group.releaseIds), [data.releases[0].id]);
  data.releases[1].excluded = false; data.releases[1].mergedInto = data.releases[0].id;
  assert.equal(findArchiveAlbumGroup(data, data.releases[1].id), undefined);
  delete data.releases[1].mergedInto; data.tracks[3].excluded = true;
  assert.equal(groupArchiveAlbums(data).length, 2);
  assert.ok(!groupArchiveAlbums(data).flatMap(group => group.tracks).flatMap(track => track.trackIds).includes(data.tracks[3].id));
  data.tracks[3].excluded = false; data.tracks[3].mergedInto = data.tracks[4].id;
  assert.equal(groupArchiveAlbums(data).length, 2);
});

test("representatives preserve real IDs and prefer managed tracks, then member edits, without modifying raw rights or task links", () => {
  const data = pair(); data.releases[1].userEdited = true;
  data.tracks[0].managed = false; data.tracks[0].userEdited = true;
  data.tracks[4].userEdited = true;
  data.tracks[0].recordingId = "mel-recording"; data.tracks[3].recordingId = "gen-recording";
  data.recordings = [{ id: "mel-recording", title: "첫 곡", workIds: ["mel-work"] }, { id: "gen-recording", title: "첫 곡", workIds: ["gen-work"] }];
  data.works = [{ id: "mel-work", title: "첫 곡", institutionNumbers: [], contributors: [{ name: "작사가", role: "lyrics" }] }, { id: "gen-work", title: "첫 곡", institutionNumbers: [], contributors: [{ name: "작곡가", role: "composition" }], userEdited: true }];
  data.tasks = [{ id: "fixture-task", trackId: data.tracks[3].id, recordingId: "gen-recording", workId: "gen-work", kind: "copyright_work", agency: "KOMCA", status: "completed", result: "approved", queryStatus: "unsupported", source: "user_input", attachmentIds: [] }];
  validateArchiveData(data);
  const before = structuredClone(data);
  const group = groupArchiveAlbums(data)[0];
  assert.equal(group.release.id, data.releases[1].id);
  assert.equal(group.tracks[0].track.id, data.tracks[3].id); assert.equal(group.tracks[0].track.recordingId, "gen-recording");
  assert.equal(group.tracks[1].track.id, data.tracks[4].id); assert.equal(group.tracks[2].track.id, data.tracks[2].id);
  assert.equal(group.tracks[0].track.links.length, 2);
  assert.deepEqual(data, before);
  const duplicateSlot = pair(["같은 곡", "다른 곡"]); duplicateSlot.tracks[1].title = "같은 곡"; duplicateSlot.tracks[1].trackNumber = 1;
  assert.equal(groupArchiveAlbums(duplicateSlot).flatMap(item => item.tracks).length, 4, "duplicate slots within one source are not aliases");
});

test("repeated provider imports and reordered input keep stable real representative IDs", () => {
  const imported = (provider: "melon" | "genie", id: string): ImportedRelease => ({ provider, externalId: id, title: "앨범", date: "2026-01-12", type: "album", secondaryTypes: [], participation: false, artistName: "가수", artistIds: ["12"], barcode: null, version: "", country: "KR", tracks: [{ externalId: `${id}1`, recordingId: null, title: "곡", version: "", artistName: "가수", artistIds: ["12"], position: 1, discNumber: 1, durationMs: null, isrcs: [], managedByArtist: true, url: link(provider, `${id}1`, "track").url }], url: link(provider, id, "album").url, imageUrl: null, checkedAt: date });
  const first = mergeArchiveImports(createArchiveData("가수"), [imported("genie", "200"), imported("melon", "100")]);
  const repeated = mergeArchiveImports(first, [imported("melon", "100"), imported("genie", "200")]);
  assert.equal(repeated.releases.length, 2); assert.equal(repeated.tracks.length, 2);
  assert.deepEqual(groupArchiveAlbums(repeated), groupArchiveAlbums(first));
  assert.deepEqual(groupArchiveAlbums({ ...repeated, releases: [...repeated.releases].reverse(), tracks: [...repeated.tracks].reverse() }), groupArchiveAlbums(first));
});
