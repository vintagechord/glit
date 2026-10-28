import assert from "node:assert/strict";
import test from "node:test";
import { collectDomesticStep, normalizeDomesticAlbum, parseDomesticAlbumIds, parseDomesticArtistSearch, searchDomesticArtists, type DomesticCursor } from "../src/lib/music-archive/domestic-catalog";
import { MusicProviderError } from "../src/lib/music-archive/musicbrainz";
import { createArchiveData, applyArchiveCommand } from "../src/lib/music-archive/model";
import { additionalStationReviewTracks, unreviewedArchiveTracks } from "../src/lib/music-archive/reviews";
import { mergeArchiveImports } from "../src/lib/music-archive/import";

const checked = "2026-10-27T00:00:00Z";
const melonSearch = `<div class="list_atist12 d_artist_list"><ul><li><a class="thumb" href="javascript:melon.link.goArtistDetail('12');"><img src="https://cdnimg.melon.co.kr/artist.jpg"></a><dt><a href="javascript:melon.link.goArtistDetail('12');" class="ellipsis"><b>우리</b> 가수</a></dt><dd class="gubun">대한민국/솔로</dd></li><li><a href="javascript:melon.link.goArtistDetail('13');" class="ellipsis">우리 가수</a></li></ul></div><a href="javascript:melon.link.goArtistDetail('999');">추천</a>`;
const genieSearch = `<!-- S. artist List --><div class="artist-type-1"><div class="artist-item"><a onclick="fnViewArtist('12');"><img src="//image.genie.co.kr/artist.jpg"></a><span class="artist"><a onclick="fnViewArtist('12');">우리 &amp; 가수</a></span><span class="nationality">한국</span></div><!-- E. div class="artist-type-1" --><a onclick="fnViewArtist('999');">인기 가수</a>`;
const melonList = (ids: string[], more = false) => `<div class="list_album11 d_album_list"><ul>${ids.map(id => `<li><a href="javascript:melon.link.goAlbumDetail('${id}');">앨범 ${id}</a><ul><li>중첩 아티스트 표시</li></ul></li>`).join("")}</ul></div><script>${more ? "pageObj.sendPage(\\'16\\');" : ""}</script>`;
const genieList = (ids: string[], more = false) => `<div class="artist-album-list"><ul>${ids.map(id => `<li class="list-album"><a onclick="fnViewAlbumLayer('${id}');">앨범 ${id}</a></li>`).join("")}</ul>${more ? "<a onclick=\"fnGoPage_ArtistAlbum('2','10');\">2</a>" : ""}</div>`;
const melonTrack = (id: string, artistId: string, title = "노래", disc = 1, number = 1) => `<tr data-group-items="cd${disc}"><td><span class="rank">${number}</span><a href="javascript:melon.link.goSongDetail('${id}');">정보</a><a href="javascript:melon.play.playSong('1', ${id});">${title}</a><a href="javascript:melon.link.goArtistDetail('${artistId}');">가수</a></td></tr>`;
const melonAlbum = (rows: string) => `<div class="section_info"><div class="song_name"><strong>앨범명</strong>테스트 앨범</div><a class="artist_name"><span>가수</span></a><a href="javascript:melon.link.goArtistDetail('12');">가수</a><span class="gubun">[싱글]</span><dl><dt>발매일</dt><dd>2026.10.01</dd></dl><div class="button d_album_like"></div></div><table>${rows}</table>`;
const genieAlbum = `<div class="album-detail-infos"><h2 class="name">앨범</h2><li><span class="attr"><img alt="아티스트"></span><span class="value"><a onclick="fnGoMore('artistInfo','12');">가수</a></span></li><!-- E. 앨범 기본 정보 --></div><table><tr class="list" songId="123"><td class="number">1</td><td><a class="title" title="곡">곡</a><a class="artist" onclick="fnViewArtist(12);">가수</a></td></tr></table>`;

for (const [provider, html] of [["melon", melonSearch], ["genie", genieSearch]] as const) test(`${provider} search preserves actual artist IDs and excludes recommendation widgets`, () => {
  const items = parseDomesticArtistSearch(provider, html);
  assert.equal(items[0].externalId, "12"); assert.ok(items[0].name.includes("우리"));
  assert.ok(items[0].imageUrl?.startsWith("https://")); assert.ok(items.every(item => item.externalId !== "999"));
  if (provider === "melon") assert.deepEqual(items.map(item => item.externalId), ["12", "13"]);
});
test("public pages with changed containers or access blocks are errors, never invented empty results", async () => {
  assert.throws(() => parseDomesticArtistSearch("melon", "<h1>unknown page</h1>"), MusicProviderError);
  assert.throws(() => parseDomesticAlbumIds("genie", `<aside><a onclick="fnViewAlbumLayer('99');">추천</a></aside>`), MusicProviderError);
  await assert.rejects(searchDomesticArtists("genie", "가수", { fetcher: async () => new Response("Access denied") }), /접근이 제한/);
});
test("nested popover lists cannot truncate album imports", () => assert.deepEqual(parseDomesticAlbumIds("melon", melonList(["100", "101", "102"])), ["100", "101", "102"]));
test("album lists exclude adjacent recommendation widgets without a script boundary", () => {
  assert.deepEqual(parseDomesticAlbumIds("melon", melonList(["100"]).replace(/<script>[\s\S]*?<\/script>/, "") + `<div><a href="javascript:melon.link.goAlbumDetail('999');">추천 앨범</a></div>`), ["100"]);
  assert.throws(() => parseDomesticAlbumIds("melon", `<div class="list_album11"><ul><li><a href="javascript:melon.link.goAlbumDetail('100');">앨범</a></li></ul>`), /완전하지/);
});
test("exact track IDs prevent prefix collisions and mixed-artist ownership widening", () => {
  const album = normalizeDomesticAlbum("melon", melonAlbum(melonTrack("1234", "99", "타인 곡") + melonTrack("123", "12", "내 곡", 2)), "100", "12", checked);
  assert.deepEqual(album.tracks.map(track => [track.externalId, track.managedByArtist, track.discNumber]), [["1234", false, 1], ["123", true, 2]]);
  assert.equal(album.type, "single"); assert.equal(album.participation, false);
});
test("missing track metadata cannot mark a partial album complete", () => {
  const html = melonAlbum(melonTrack("123", "12") + `<tr data-group-items="cd1"><td><a href="javascript:melon.link.goSongDetail('456');">곡명 없음</a></td></tr>`);
  assert.throws(() => normalizeDomesticAlbum("melon", html, "100", "12", checked), /전체 수록곡/);
  assert.throws(() => normalizeDomesticAlbum("melon", melonAlbum(melonTrack("123", "99")), "100", "12", checked), /아티스트의 수록곡/);
  assert.throws(() => normalizeDomesticAlbum("melon", `<h5 class="title">수록곡 <span class="sum">(2)</span></h5>${melonAlbum(melonTrack("123", "12"))}`, "100", "12", checked), /전체 수록곡/);
});
test("catalog-confirmed participation retains an album without widening track ownership", () => {
  const html = melonAlbum(melonTrack("123", "99", "참여곡")).replace("goArtistDetail('12')", "goArtistDetail('99')");
  assert.throws(() => normalizeDomesticAlbum("melon", html, "100", "12", checked), /아티스트의 수록곡/);
  assert.throws(() => normalizeDomesticAlbum("melon", html, "100", "12", checked, { listedArtistId: "99" }), /아티스트의 수록곡/);
  const release = normalizeDomesticAlbum("melon", html, "100", "12", checked, { listedArtistId: "12" });
  assert.equal(release.participation, true);
  assert.deepEqual(release.artistIds, ["99"]);
  assert.deepEqual(release.tracks.map(track => [track.artistIds, track.managedByArtist]), [[["99"], false]]);
  const data = mergeArchiveImports(createArchiveData("우리 가수"), [release]);
  assert.equal(data.releases.length, 1); assert.equal(data.tracks.length, 1);
  assert.equal(data.tracks[0].managed, false);
  assert.deepEqual(unreviewedArchiveTracks(data, data.releases[0].id, []), []);
});
test("Genie missing album type remains unknown and only album header supplies primary artist IDs", () => {
  const result = normalizeDomesticAlbum("genie", `<a onclick="fnViewArtist('99');">추천</a>${genieAlbum}`, "100", "12", checked);
  assert.equal(result.type, "other"); assert.deepEqual(result.artistIds, ["12"]); assert.equal(result.participation, false);
});
for (const provider of ["melon", "genie"] as const) test(`${provider} collection saves one page/album per step and advances explicit pagination`, async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init });
    return new Response(url.includes("albumInfo") || url.includes("/album/detail") ? provider === "melon" ? melonAlbum(melonTrack("123", "12")) : genieAlbum : calls.length === 1 ? provider === "melon" ? melonList(["100"], true) : genieList(["100"], true) : provider === "melon" ? melonList(["101"]) : genieList(["101"]));
  };
  const options = { fetcher, now: () => Date.parse(checked) };
  const first = await collectDomesticStep(provider, "12", null, options);
  assert.equal(calls.length, 1); assert.deepEqual(first.nextCursor?.pending, ["100"]);
  const frozen = structuredClone(first.nextCursor);
  const second = await collectDomesticStep(provider, "12", first.nextCursor, options);
  assert.deepEqual(first.nextCursor, frozen); assert.equal(second.releases.length, 1); assert.equal(second.nextCursor?.phase, "albums");
  const third = await collectDomesticStep(provider, "12", second.nextCursor, options);
  assert.deepEqual(third.nextCursor?.pending, ["101"]); assert.equal(calls.length, 3);
  if (provider === "melon") assert.ok(calls[2].url.includes("startIndex=16"));
  else { assert.equal(calls[2].init?.method, "POST"); assert.ok(String(calls[2].init?.body).includes("pg=2")); }
});
test("failed request preserves the input cursor and invalid cursor phases fail before network", async () => {
  const cursor: DomesticCursor = { provider: "melon", version: 1, artistId: "12", phase: "tracks", page: 2, pending: ["100"], seen: [], more: false };
  const before = structuredClone(cursor);
  await assert.rejects(collectDomesticStep("melon", "12", cursor, { fetcher: async () => new Response("", { status: 429 }) }), error => error instanceof MusicProviderError && error.code === "rate_limited");
  assert.deepEqual(cursor, before);
  await assert.rejects(collectDomesticStep("melon", "12", { ...cursor, pending: [] }, { fetcher: async () => { throw new Error("must not run"); } }), error => error instanceof MusicProviderError && error.code === "invalid_input");
});

const melonTotal = (total: number) => `<a title="전체앨범 보기" radio-value="0"><span>전체앨범</span>(${total})</a>`;
test("Melon imports every primary and participation album across all pages using catalog total", async () => {
  const ids = Array.from({ length: 31 }, (_, i) => String(100 + i));
  const requestedPages: number[] = [];
  let permits = 0;
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    const albumId = url.searchParams.get("albumId");
    if (albumId) {
      const artistId = Number(albumId) % 2 ? "99" : "12";
      return new Response(melonAlbum(melonTrack(`5${albumId}`, artistId)).replace("goArtistDetail('12')", `goArtistDetail('${artistId}')`));
    }
    assert.equal(url.searchParams.get("listType"), "0");
    const start = Number(url.searchParams.get("startIndex") ?? 1);
    requestedPages.push(start);
    // Deliberately omit the navigation widget; an observed total is authoritative.
    return new Response((start === 1 ? melonTotal(ids.length) : "") + melonList(ids.slice(start - 1, start + 14)));
  };
  let cursor: DomesticCursor | null = null;
  const releases = [];
  for (let i = 0; i < 40; i++) {
    const before: DomesticCursor | null = structuredClone(cursor);
    const step = await collectDomesticStep("melon", "12", cursor, { fetcher, acquirePermit: async () => { permits++; } });
    assert.deepEqual(cursor, before);
    releases.push(...step.releases);
    cursor = step.nextCursor;
    if (step.status === "completed") break;
  }
  assert.equal(cursor, null);
  assert.deepEqual(requestedPages, [1, 16, 31]);
  assert.deepEqual(releases.map(release => release.externalId), ids);
  assert.equal(releases.filter(release => release.participation).length, 15);
  assert.equal(releases.flatMap(release => release.tracks).filter(track => track.managedByArtist).length, 16);
  assert.equal(permits, 34);
});

test("an existing v1 job resumes past the participation album that previously halted it", async () => {
  const cursor: DomesticCursor = { provider: "melon", version: 1, artistId: "12", page: 2, pending: ["101", "102"], seen: ["100"], more: false, phase: "tracks" };
  const fetcher: typeof fetch = async input => {
    const id = new URL(String(input)).searchParams.get("albumId")!;
    const artist = id === "101" ? "99" : "12";
    return new Response(melonAlbum(melonTrack(`5${id}`, artist)).replace("goArtistDetail('12')", `goArtistDetail('${artist}')`));
  };
  const first = await collectDomesticStep("melon", "12", cursor, { fetcher });
  assert.equal(first.releases[0].participation, true);
  assert.deepEqual(first.nextCursor?.seen, ["100", "101"]);
  assert.deepEqual(cursor.seen, ["100"]);
  const last = await collectDomesticStep("melon", "12", first.nextCursor, { fetcher });
  assert.equal(last.status, "completed"); assert.equal(last.nextCursor, null);
  assert.equal(last.releases[0].externalId, "102");
});

test("Melon never completes a shortened or duplicate final page below the catalog total", async () => {
  await assert.rejects(collectDomesticStep("melon", "12", null, { fetcher: async () => new Response(melonTotal(20) + melonList(["100"])) }), /전체 앨범 수/);
  const cursor: DomesticCursor = { provider: "melon", version: 1, artistId: "12", page: 2, pending: [], seen: Array.from({ length: 15 }, (_, i) => String(100 + i)), total: 17, more: true, phase: "albums" };
  await assert.rejects(collectDomesticStep("melon", "12", cursor, { fetcher: async () => new Response(melonList(["114", "115"])) }), /전체 앨범 수/);
  assert.equal(cursor.seen.length, 15);
});

test("v1 cursors understand numeric and Unicode-escaped next-page offsets", async () => {
  for (const pagination of ["pageObj.sendPage(16)", "pageObj.sendPage(\\u002716\\u0027)"]) {
    const result = await collectDomesticStep("melon", "12", null, { fetcher: async () => new Response(melonList(["100"]) + `<script>${pagination}</script>`) });
    assert.equal(result.nextCursor?.more, true);
  }
});
test("partial review history leaves uncovered tracks available for exact-track applications", () => {
  let data = createArchiveData("가수"); data = applyArchiveCommand(data, { type: "add_release", release: { id: "album", title: "앨범" } });
  for (const id of ["a", "b", "c"]) data = applyArchiveCommand(data, { type: "add_track", track: { id, releaseId: "album", title: id } });
  const reviews = [{ submissionId: "existing", releaseId: "album", trackIds: ["a"], status: "COMPLETED" }, { submissionId: "ongoing", releaseId: "album", trackIds: ["b"], status: "PROCESSING" }];
  assert.deepEqual(unreviewedArchiveTracks(data, "album", reviews).map(track => track.id), ["c"]);
  assert.deepEqual(additionalStationReviewTracks(data, "album", reviews).map(track => track.id), ["a"]);
  assert.deepEqual(additionalStationReviewTracks(data, "album", [...reviews, { ...reviews[1], trackIds: ["a"] }]), []);
  assert.deepEqual(unreviewedArchiveTracks(data, "album", [{ ...reviews[0], trackIds: [] }]), []);
  assert.deepEqual(unreviewedArchiveTracks(data, "album", [{ ...reviews[0], status: "CANCELLED" }]).map(track => track.id), ["a", "b", "c"]);
});
