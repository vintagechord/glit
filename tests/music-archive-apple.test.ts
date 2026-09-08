import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { collectAppleStep, lookupAppleArtist, normalizeAppleAlbum, searchAppleArtists, type AppleAlbumMetadata, type AppleCursor, type AppleOptions } from "../src/lib/music-archive/apple";
import { MusicProviderError } from "../src/lib/music-archive/musicbrainz";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/music-archive-apple/${name}.json`, import.meta.url), "utf8"));
const artist = "1259084205";
const checkedAt = "2026-09-08T00:00:00.000Z";
const options = (handler: (url: URL, init?: RequestInit) => unknown): AppleOptions => ({
  acquirePermit: async () => {}, now: () => Date.parse(checkedAt),
  fetcher: (async (input, init) => { const result = handler(new URL(String(input)), init); return result instanceof Response ? result : Response.json(result); }) as typeof fetch,
});
const metadata: AppleAlbumMetadata = { id: "1259083959", title: "The Moon and the Stars", artistId: artist, artistName: "빈티지코드", date: "2017-04-11", trackCount: 9, url: "https://music.apple.com/kr/album/the-moon-and-the-stars/1259083959" };
const providerError = (code: string) => (error: unknown) => error instanceof MusicProviderError && error.code === code;

test("live candidate fixtures preserve two same-Korean-name IDs, API aliases and genres", async () => {
  const data = { resultCount: 2, results: [fixture("vintage-chord-albums").results[0], fixture("vintagechord-albums").results[0]] };
  const result = await searchAppleArtists("빈티지코드", options((url, init) => {
    assert.equal(url.origin, "https://itunes.apple.com"); assert.equal(url.pathname, "/search");
    assert.equal(url.searchParams.get("country"), "KR"); assert.equal(url.searchParams.get("term"), "빈티지코드");
    assert.equal(url.searchParams.get("entity"), "musicArtist"); assert.equal(url.searchParams.get("limit"), "200");
    assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store"); assert.ok(init?.signal);
    return data;
  }));
  assert.deepEqual(result.items.map((row) => [row.externalId, row.name, row.sortName]), [[artist, "빈티지코드", "Vintage Chord"], ["1112117967", "빈티지코드", "Vintagechord"]]);
  assert.match(result.items[0].disambiguation, /R&B\/소울/); assert.match(result.items[1].disambiguation, /힙합\/랩/);
  assert.ok(result.items.every((row) => row.imageUrl === null && row.representativeRelease === null && row.provider === "apple"));
  assert.equal(result.nextOffset, null); assert.equal(result.limited, false);
});

test("search paginates only a bounded result window and discloses the official 200-result cap", async () => {
  const example = fixture("vintage-chord-albums").results[0];
  const data = { resultCount: 200, results: Array.from({ length: 200 }, (_, n) => ({ ...example, artistId: 1000 + n, artistLinkUrl: `https://music.apple.com/kr/artist/example/${1000 + n}` })) };
  const result = await searchAppleArtists("Common", { ...options((url) => { assert.equal(url.searchParams.has("offset"), false); return data; }), offset: 180 });
  assert.equal(result.items.length, 20); assert.equal(result.total, 200); assert.equal(result.nextOffset, null); assert.equal(result.limited, true);
  assert.match(result.scopeNote, /200/);
  const fullWindow = await searchAppleArtists("Common", { ...options(() => data), pageSize: 200 });
  assert.equal(fullWindow.items.length, 200); assert.equal(fullWindow.nextOffset, null);
  await assert.rejects(() => searchAppleArtists("Common", { ...options(() => data), pageSize: 201 }), providerError("invalid_input"));
  assert.deepEqual((await searchAppleArtists("Missing", options(() => ({ resultCount: 0, results: [] })))).items, []);
});

test("artist lookup verifies exact identity and rejects input before making any request", async () => {
  let calls = 0;
  const opts = options((url) => { calls++; assert.equal(url.searchParams.get("id"), artist); return { resultCount: 1, results: [fixture("vintage-chord-albums").results[0]] }; });
  assert.equal((await lookupAppleArtist(artist, opts)).externalId, artist);
  for (const id of ["https://evil.test/", "1&country=US", "0", "99999999999999999"]) await assert.rejects(() => lookupAppleArtist(id, opts), providerError("invalid_input"));
  assert.equal(calls, 1);
  await assert.rejects(() => lookupAppleArtist("1112117967", options(() => ({ resultCount: 1, results: [fixture("vintage-chord-albums").results[0]] }))), providerError("invalid_response"));
  await assert.rejects(() => lookupAppleArtist(artist, options(() => ({ resultCount: 0, results: [] }))), providerError("not_found"));
});

test("actual KR album-only response cannot report nine missing songs as a completed album", () => {
  assert.throws(() => normalizeAppleAlbum(fixture("moon-tracks").results, metadata, artist, [], checkedAt), providerError("invalid_response"));
  const release = normalizeAppleAlbum(fixture("moon-tracks-us").results, metadata, artist, [], checkedAt);
  assert.equal(release.tracks.length, 9); assert.equal(release.artistName, "빈티지코드");
  assert.equal(release.tracks[0].title, "Wake Up (with Fade & 디아빈슬로)");
  assert.equal(release.tracks[0].externalId, "1259084210"); assert.equal(release.tracks[0].durationMs, 175185);
  assert.deepEqual(release.tracks.map((row) => row.position), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(release.tracks.every((row) => row.recordingId === null && !row.isrcs.length && row.managedByArtist));
  assert.equal(release.imageUrl, null); assert.equal(release.checkedAt, checkedAt); assert.equal(release.country, "");
  assert.doesNotMatch(JSON.stringify(release), /artwork|preview|copyright|lyrics|mzstatic/);
});

test("collaboration management uses exact artist-song membership and never artist-name substring guesses", () => {
  const data = fixture("moon-tracks-us").results;
  const collaboration = { ...metadata, artistId: "999", artistName: "Other & 빈티지코드" };
  data[0].artistId = 999;
  data.slice(1).forEach((row: Record<string, unknown>) => { row.artistId = 999; row.artistName = "Other & 빈티지코드"; });
  const release = normalizeAppleAlbum(data, collaboration, artist, ["1259084210"], checkedAt);
  assert.equal(release.participation, true);
  assert.equal(release.tracks.filter((row) => row.managedByArtist).length, 1);
  assert.deepEqual(release.tracks[0].artistIds, ["999", artist]);
  assert.deepEqual(release.tracks[1].artistIds, ["999"]);
});

test("album validation rejects duplicates, mismatched country editions, missing fields and unsafe store URLs", () => {
  const mutations = [
    (rows: Record<string, unknown>[]) => { rows[1].trackId = rows[2].trackId; },
    (rows: Record<string, unknown>[]) => { rows[1].trackNumber = rows[2].trackNumber; },
    (rows: Record<string, unknown>[]) => { rows[0].trackCount = 8; },
    (rows: Record<string, unknown>[]) => { rows[1].collectionId = 999; },
    (rows: Record<string, unknown>[]) => { rows[1].trackTimeMillis = null; },
    (rows: Record<string, unknown>[]) => { rows[1].trackViewUrl = "https://music.apple.com.evil.test/us/album/x/1259083959?i=1259084210"; },
    (rows: Record<string, unknown>[]) => { rows[1].trackViewUrl = "https://music.apple.com/us/album/x/1259083959?i=999"; },
  ];
  for (const mutate of mutations) {
    const rows = fixture("moon-tracks-us").results; mutate(rows);
    assert.throws(() => normalizeAppleAlbum(rows, metadata, artist, [], checkedAt), providerError("invalid_response"));
  }
});

test("resumable pipeline discovers KR albums, exact US artist-song links, then complete US album tracks, one request each", async () => {
  const requests: string[] = []; let permits = 0;
  const artistRow = fixture("vintage-chord-albums").results[0];
  const moon = fixture("vintage-chord-albums").results.find((row: Record<string, unknown>) => row.collectionId === 1259083959);
  const opts = options((url) => {
    requests.push(url.toString());
    if (url.searchParams.get("entity") === "album") return { resultCount: 2, results: [artistRow, moon] };
    if (url.searchParams.get("id") === artist) return fixture("vintage-chord-songs-us");
    assert.equal(url.searchParams.get("country"), "US"); return fixture("moon-tracks-us");
  });
  opts.acquirePermit = async () => { permits++; };
  let cursor: AppleCursor | null = null;
  const releases = [];
  for (let n = 0; n < 3; n++) {
    const snapshot: string = JSON.stringify(cursor); const before: number = requests.length;
    const step = await collectAppleStep(artist, cursor, opts);
    assert.equal(JSON.stringify(cursor), snapshot); assert.equal(requests.length - before, 1);
    releases.push(...step.releases); cursor = step.nextCursor ? JSON.parse(JSON.stringify(step.nextCursor)) : null;
    assert.equal(step.status, n === 2 ? "completed" : "collecting");
  }
  assert.equal(cursor, null); assert.equal(permits, 3); assert.equal(releases.length, 1); assert.equal(releases[0].tracks.length, 9);
  assert.ok(requests[0].includes("country=KR")); assert.ok(requests[1].includes("country=US"));
});

test("real KR discovery fixtures expose 7 and 2 distinct albums without assuming primary artist is the only credit", async () => {
  const first = await collectAppleStep(artist, null, options(() => fixture("vintage-chord-albums")));
  const second = await collectAppleStep("1112117967", null, options(() => fixture("vintagechord-albums")));
  assert.equal(first.nextCursor?.pending.length, 7); assert.equal(second.nextCursor?.pending.length, 2);
  assert.equal(first.nextCursor?.albums.filter((row) => row.artistId !== artist).length, 2);
  assert.equal(first.status, "collecting");
  assert.ok(Buffer.byteLength(JSON.stringify(first.nextCursor)) < 10_000);
  assert.doesNotMatch(JSON.stringify(first.nextCursor), /artwork|preview|copyright|mzstatic/);
});

test("cap never silently completes; successfully imported albums remain resumable before partial error", async () => {
  const cursor: AppleCursor = { provider: "apple", version: 1, artistId: artist, phase: "tracks", pending: [metadata.id], albums: [metadata], linkedTrackIds: [], limited: true, total: 1 };
  const step = await collectAppleStep(artist, cursor, options(() => fixture("moon-tracks-us")));
  assert.equal(step.releases[0].tracks.length, 9); assert.equal(step.status, "collecting"); assert.equal(step.nextCursor?.phase, "limited");
  let calls = 0;
  await assert.rejects(() => collectAppleStep(artist, step.nextCursor, options(() => { calls++; return {}; })), providerError("invalid_response"));
  assert.equal(calls, 0);
});

test("errors preserve pending cursor and distinguish permission, missing, rate and transient states", async () => {
  const cursor: AppleCursor = { provider: "apple", version: 1, artistId: artist, phase: "tracks", pending: [metadata.id], albums: [metadata], linkedTrackIds: [], limited: false };
  const snapshot = JSON.stringify(cursor);
  for (const [status, code] of [[403, "permission_required"], [404, "not_found"], [429, "rate_limited"], [503, "temporary_error"]] as const) {
    await assert.rejects(() => collectAppleStep(artist, cursor, options(() => new Response("", { status, headers: { "retry-after": "72" } }))), (error: unknown) => {
      assert.ok(error instanceof MusicProviderError); assert.equal(error.code, code);
      if ([429, 503].includes(status)) assert.equal(error.retryAfterSeconds, 72);
      return true;
    });
    assert.equal(JSON.stringify(cursor), snapshot);
  }
});

test("malformed resultCount, foreign artist and corrupted cursor fail closed", async () => {
  await assert.rejects(() => searchAppleArtists("test", options(() => ({ resultCount: 1, results: [] }))), providerError("invalid_response"));
  const cursor: AppleCursor = { provider: "apple", version: 1, artistId: artist, phase: "tracks", pending: ["999"], albums: [metadata], linkedTrackIds: [], limited: false };
  let calls = 0;
  await assert.rejects(() => collectAppleStep(artist, cursor, options(() => { calls++; return {}; })), providerError("invalid_input"));
  assert.equal(calls, 0);
  await assert.rejects(() => collectAppleStep("1112117967", { ...cursor, pending: [metadata.id] }, options(() => ({}))), providerError("invalid_input"));
});

test("stream byte ceiling cancels overlarge responses without content-length", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8_000_001)); }, cancel() { cancelled = true; } }));
  await assert.rejects(() => searchAppleArtists("test", options(() => response)), providerError("invalid_response"));
  assert.equal(cancelled, true);
});

test("exact secondary candidate's real seven-song album retains distinct catalog IDs", () => {
  const data = fixture("kozy-tracks-us").results;
  const release = normalizeAppleAlbum(data, { id: "1886162774", title: "KozyTape pt.6", artistId: "1112117967", artistName: "빈티지코드", date: data[0].releaseDate.slice(0, 10), trackCount: 7, url: "https://music.apple.com/kr/album/kozytape-pt-6/1886162774" }, "1112117967", [], checkedAt);
  assert.equal(release.tracks.length, 7); assert.equal(release.tracks[0].title, "Double Plus Good");
  assert.ok(release.tracks.every((row) => row.artistIds.includes("1112117967") && !row.artistIds.includes(artist)));
});
