import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { appleArtworkUrl, normalizeAppleAlbum, collectAppleStep, type AppleAlbumMetadata } from "../src/lib/music-archive/apple";
import { normalizeMusicBrainzRelease } from "../src/lib/music-archive/musicbrainz";
import { mergeArchiveImports } from "../src/lib/music-archive/import";
import { mergeSubmissionCredits, type CreditSubmission } from "../src/lib/music-archive/credits";
import { createArchiveData, applyArchiveCommand } from "../src/lib/music-archive/model";
import { fetchDomesticAlbumCredits, linkedDomesticAlbumUrl, mergeDomesticAlbumCredits } from "../src/lib/music-archive/domestic-credits";
import { memberLibrary } from "../src/lib/music-archive/member-view";

const imageUrl = "https://is1-ssl.mzstatic.com/image/thumb/Music/cover/100x100bb.jpg";
const date = "2026-09-10T00:00:00Z";
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/music-archive-apple/${name}.json`, import.meta.url), "utf8"));

test("catalog artwork URL survives discovery, resume, import, and member projection; foreign URLs are discarded", async () => {
  assert.equal(appleArtworkUrl(imageUrl), imageUrl);
  for (const url of ["https://mzstatic.com.evil.test/a.jpg", "http://localhost/image.jpg", "javascript:alert(1)", "https://user:password@is1-ssl.mzstatic.com/a.jpg"]) assert.equal(appleArtworkUrl(url), null);
  const discovery = fixture("vintage-chord-albums"); discovery.results[1].artworkUrl100 = imageUrl;
  const first = await collectAppleStep("1259084205", null, { acquirePermit: async () => {}, fetcher: (async () => Response.json(discovery)) as typeof fetch });
  assert.equal(first.nextCursor?.albums[0].imageUrl, imageUrl);
  const raw = fixture("moon-tracks-us");
  const metadata: AppleAlbumMetadata = { id: "1259083959", title: "The Moon and the Stars", artistId: "1259084205", artistName: "빈티지코드", date: "2017-04-11", trackCount: 9, url: "https://music.apple.com/kr/album/1259083959", imageUrl };
  const imported = normalizeAppleAlbum(raw.results, metadata, "1259084205", [], date);
  const data = mergeArchiveImports(createArchiveData("빈티지코드"), [imported]);
  assert.equal(data.releases[0].imageUrl, imageUrl);
  const projected = memberLibrary({ data });
  assert.equal(projected.data.releases[0].imageUrl, imageUrl);
  const corrected = applyArchiveCommand(data, { type: "update_release", releaseId: data.releases[0].id, patch: { imageUrl: "https://images.example.org/corrected.jpg" } });
  const replay = mergeArchiveImports(corrected, [imported], { metadataOnly: true });
  assert.equal(replay.releases[0].imageUrl, "https://images.example.org/corrected.jpg");
  assert.ok(replay.conflicts.some(conflict => conflict.field === "imageUrl"));
});

test("MusicBrainz exact work relations persist role-specific multiple authors without declaring legal registration", () => {
  const artist = "11111111-1111-4111-8111-111111111111";
  const release = normalizeMusicBrainzRelease({ id: "22222222-2222-4222-8222-222222222222", title: "앨범", media: [{ position: 1, "track-count": 1, tracks: [{ id: "33333333-3333-4333-8333-333333333333", title: "곡", position: 1, recording: { id: "44444444-4444-4444-8444-444444444444", title: "곡", relations: [{ "target-type": "work", work: { id: "55555555-5555-4555-8555-555555555555", title: "작품", relations: [{ type: "composer", artist: { name: "작곡가 A" } }, { type: "composer", artist: { name: "작곡가 B" } }, { type: "lyricist", artist: { name: "작사가" } }, { type: "arranger", artist: { name: "편곡자" } }] } }] } }] }] }, artist, date);
  const data = mergeArchiveImports(createArchiveData("가수"), [release]);
  assert.equal(data.works[0].contributors?.length, 4);
  assert.deepEqual(data.recordings[0].workIds, [data.works[0].id]);
  assert.equal(data.works[0].institutionNumbers.length, 0);
  assert.equal(data.tasks.length, 0);
  assert.equal(mergeArchiveImports(data, [release]).works.length, 1);
});

function archive() {
  let data = createArchiveData("아티스트");
  data = applyArchiveCommand(data, { type: "add_release", release: { id: "release", title: "앨범", links: [{ provider: "apple", url: "https://music.apple.com/kr/album/123" }] } });
  data = applyArchiveCommand(data, { type: "add_track", track: { id: "track", releaseId: "release", title: "같은 곡명", trackNumber: 1, links: [] } });
  return data;
}
const submission: CreditSubmission = { id: "11111111-1111-4111-8111-111111111111", status: "COMPLETED", melon_url: "https://music.apple.com/kr/album/123", album_tracks: [{ id: "submitted-track", track_no: 1, track_title: "같은 곡명", composer: "작곡 A, 작곡 B", lyricist: "작사 A", arranger: "편곡 A" }] };

test("submission credits require exact album plus track identity, preserve manual edits and refresh without duplicates", () => {
  const data = archive();
  assert.equal(mergeSubmissionCredits(data, [{ ...submission, melon_url: "https://music.apple.com/kr/album/456" }], "library").works.length, 0);
  assert.equal(mergeSubmissionCredits(data, [{ ...submission, album_tracks: [{ ...submission.album_tracks[0], track_no: 2 }] }], "library").works.length, 0);
  let manual = applyArchiveCommand(data, { type: "save_recording", recording: { id: "manual-recording", title: "같은 곡명", workIds: [] } });
  manual = applyArchiveCommand(manual, { type: "update_track", trackId: "track", patch: { recordingId: "manual-recording" } });
  const enriched = mergeSubmissionCredits(manual, [submission], "library");
  assert.equal(enriched.works[0].contributors?.length, 4);
  assert.equal(enriched.tracks[0].recordingId, enriched.recordings[0].id);
  assert.equal(enriched.tasks.length, 0);
  const repeated = mergeSubmissionCredits(enriched, [submission], "library");
  assert.equal(repeated.works.length, 1);
  const revised = mergeSubmissionCredits(repeated, [{ ...submission, album_tracks: [{ ...submission.album_tracks[0], arranger: "정정된 편곡자" }] }], "library");
  assert.equal(revised.works[0].contributors?.at(-1)?.name, "정정된 편곡자");
  revised.works[0].userEdited = true;
  assert.equal(mergeSubmissionCredits(revised, [submission], "library").works[0].contributors?.at(-1)?.name, "정정된 편곡자");
  assert.equal(data.works.length, 0);
});


test("explicit domestic album refresh imports multiple creators and its thumbnail without storing lyrics or guessing another album", async () => {
  const albumUrl = "https://www.melon.com/album/detail.htm?albumId=123";
  const albumHtml = `<meta property="og:image" content="https://cdnimg.melon.co.kr/cm2/album/images/cover.jpg"><div class="section_info"><div class="song_name"><strong class="none">앨범명</strong> 앨범</div><div class="button d_album_like"></div></div><tr data-group-items="cd1"><td><input name="input_check" value="111" title="같은 곡명 곡 선택"></td><td><span class="rank ">1</span></td><td><a href="javascript:melon.link.goSongDetail('111');">곡정보</a></td><td><a href="javascript:melon.play.playSong('28010101',111);" title="같은 곡명 재생">같은 곡명</a></td></tr>`;
  const songHtml = `<div class="song_name"><strong class="none">곡명</strong> 같은 곡명</div><div class="lyric" id="d_video_summary">저장하면 안 되는 가사</div><ul class="list_person clfix"><li><a class="artist_name">작곡가 A</a><span class="type">작곡</span></li><li><a class="artist_name">작곡가 B</a><span class="type">작곡</span></li><li><a class="artist_name">편곡자</a><span class="type">편곡</span></li></ul>`;
  const fetched = await fetchDomesticAlbumCredits(albumUrl, { fetcher: (async (input, init) => {
    assert.equal(new URL(String(input)).hostname, "www.melon.com"); assert.equal(init?.redirect, "manual");
    return new Response(String(input).includes("song/detail") ? songHtml : albumHtml);
  }) as typeof fetch });
  assert.equal(fetched.partial, false);
  const input = archive();
  input.releases[0].links.push({ provider: "melon", url: albumUrl });
  assert.equal(linkedDomesticAlbumUrl(input, "release", [], "library"), albumUrl);
  assert.equal(linkedDomesticAlbumUrl(archive(), "release", [], "library"), null);
  let manual = applyArchiveCommand(input, { type: "save_recording", recording: { id: "manual-recording", title: "같은 곡명", workIds: [] } });
  manual = applyArchiveCommand(manual, { type: "update_track", trackId: "track", patch: { recordingId: "manual-recording" } });
  assert.equal(manual.recordings[0].userEdited, true);
  const data = mergeDomesticAlbumCredits(manual, "release", fetched.album, fetched.provider, date, fetched.imageUrl);
  assert.equal(data.works[0].contributors?.length, 3);
  assert.deepEqual(data.recordings[0].workIds, [data.works[0].id]);
  assert.equal(data.tracks[0].recordingId, "manual-recording");
  assert.equal(data.releases[0].imageUrl, "https://cdnimg.melon.co.kr/cm2/album/images/cover.jpg");
  assert.doesNotMatch(JSON.stringify(data), /저장하면 안 되는 가사/);
  assert.equal(data.tasks.length, 0);
  assert.equal(mergeDomesticAlbumCredits(data, "release", fetched.album, fetched.provider, date).works.length, 1);
  const unmatched = archive(); unmatched.tracks[0].title = "다른 곡";
  assert.equal(mergeDomesticAlbumCredits(unmatched, "release", fetched.album, fetched.provider, date).works.length, 0);
  const linked = archive(); linked.reviewLinks = [{ id: "link", submissionId: submission.id, releaseId: "release" }];
  assert.equal(linkedDomesticAlbumUrl(linked, "release", [{ ...submission, melon_url: albumUrl }], "library"), albumUrl);
});
