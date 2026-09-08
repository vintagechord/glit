import assert from "node:assert/strict";
import test from "node:test";
import { getMusicProviderStatuses, parseMusicProviderUrl, type MusicBrainzCursor } from "../src/lib/music-archive/providers";
import { collectMusicBrainzStep, MusicProviderError, normalizeMusicBrainzRelease, searchMusicBrainzArtists, type MusicBrainzOptions } from "../src/lib/music-archive/musicbrainz";
import { agencyGuides, isOfficialAgencyUrl } from "../src/lib/music-archive/guides";

const artist = "10000000-0000-0000-0000-000000000001";
const other = "10000000-0000-0000-0000-000000000002";
const releaseId = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const trackId = (n: number) => `30000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const recordingId = (n: number) => `40000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const env = { MUSICBRAINZ_COMMERCIAL_USE_APPROVED: "true", MUSICBRAINZ_USER_AGENT: "OnsideTests/1.0 (https://example.test/contact)" };
const options = (fn: (url: URL, init?: RequestInit) => unknown): MusicBrainzOptions => ({ env, acquirePermit: async () => {}, now: () => Date.UTC(2026, 8, 8), fetcher: (async (url, init) => { const value = fn(new URL(String(url)), init); return value instanceof Response ? value : Response.json(value); }) as typeof fetch });
const credits = (id: string) => [{ name: id === artist ? "Same name" : "Other artist", artist: { id } }];
const release = (n = 1) => ({ id: releaseId(n), title: "Same album title", "artist-credit": credits(artist), "release-group": { "primary-type": "Album" }, media: [{ position: 1, "track-count": 2, tracks: [{ id: trackId(n * 2), position: 1, title: "Same song title", "artist-credit": credits(artist), recording: { id: recordingId(n * 2), title: "Same song title", disambiguation: "clean version", isrcs: ["USABC2600001"] } }, { id: trackId(n * 2 + 1), position: 2, title: "Same song title", "artist-credit": credits(other), recording: { id: recordingId(n * 2 + 1), disambiguation: "live version" } }] }] });

test("official provider URLs canonicalize IDs and reject SSRF/lookalike/protocol/credential inputs", () => {
  assert.equal(parseMusicProviderUrl(`https://musicbrainz.org/artist/${artist}?foo=bar`, "artist")?.externalId, artist);
  assert.equal(parseMusicProviderUrl(`https://www.melon.com/artist/timeline.htm?artistId=123`, "artist")?.url, "https://www.melon.com/artist/timeline.htm?artistId=123");
  assert.equal(parseMusicProviderUrl("https://www.genie.co.kr/detail/artistInfo?xxnm=123", "artist")?.provider, "genie");
  assert.equal(parseMusicProviderUrl("https://open.spotify.com/intl-ko/artist/4dpARuHxo51G3z768sgnrY?si=tracking", "artist")?.url, "https://open.spotify.com/artist/4dpARuHxo51G3z768sgnrY");
  assert.equal(parseMusicProviderUrl("https://music.bugs.co.kr/track/123", "track")?.externalId, "123");
  for (const bad of ["http://musicbrainz.org/artist/" + artist, "https://127.0.0.1/artist/" + artist, "https://musicbrainz.org.evil.test/artist/" + artist, "https://musicbrainz.org@evil.test/artist/" + artist, "https://user:pass@musicbrainz.org/artist/" + artist, "https://musicbrainz.org:444/artist/" + artist, "https://musicbrainz.org/ws/2/artist/" + artist, "javascript:alert(1)", "https://www.genie.co.kr/detail/artistInfo?xxnm=../admin", "https://music.bugs.co.kr/track/123/other"] ) assert.equal(parseMusicProviderUrl(bad), null, bad);
  assert.equal(parseMusicProviderUrl(`https://musicbrainz.org/release/${releaseId(1)}`, "artist"), null);
});

test("provider statuses never advertise unimplemented domestic or Spotify scraping; commercial permission gates all MB calls", async () => {
  assert.equal(getMusicProviderStatuses({})[0].status, "permission_required");
  assert.equal(getMusicProviderStatuses({ MUSICBRAINZ_COMMERCIAL_USE_APPROVED: "true" })[0].status, "configuration_required");
  assert.equal(getMusicProviderStatuses(env)[0].status, "available");
  assert.ok(getMusicProviderStatuses(env).slice(1).every((value) => !value.automaticImplemented && value.status !== "available"));
  let called = false;
  await assert.rejects(() => searchMusicBrainzArtists("Nirvana", { ...options(() => { called = true; return {}; }), env: {} }), (error: unknown) => error instanceof MusicProviderError && error.code === "permission_required");
  assert.equal(called, false);
});

test("same-name search keeps distinct candidates and paginates without automatically selecting a match", async () => {
  const result = await searchMusicBrainzArtists("Same name", options((url) => {
    assert.equal(url.searchParams.get("limit"), "20");
    assert.match(url.searchParams.get("query") ?? "", /alias:/);
    return { count: 3, artists: [{ id: artist, name: "Same name", country: "KR", disambiguation: "singer" }, { id: other, name: "Same name", country: "GB", disambiguation: "band" }] };
  }));
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].disambiguation, "singer");
  assert.equal(result.items[1].externalId, other);
  assert.equal(result.nextOffset, 2);
  const empty = await searchMusicBrainzArtists("Absent", options(() => ({ count: 0, artists: [] })));
  assert.deepEqual(empty.items, []);
  assert.equal(empty.nextOffset, null);
});

test("direct artist URL and MBID lookup uses fixed API origin, no redirect and no-store", async () => {
  let permits = 0;
  const opts = options((url, init) => {
    assert.equal(url.origin, "https://musicbrainz.org");
    assert.equal(url.pathname, `/ws/2/artist/${artist}`);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    return { id: artist, name: "Same name" };
  });
  opts.acquirePermit = async () => { permits += 1; };
  assert.equal((await searchMusicBrainzArtists(`https://musicbrainz.org/artist/${artist}`, opts)).items[0].externalId, artist);
  assert.equal((await searchMusicBrainzArtists(artist, opts)).total, 1);
  assert.equal(permits, 2);
});

test("resumable steps exhaust multiple release pages then track-artist appearances, one request each", async () => {
  const requests: string[] = [];
  const opts = options((url) => {
    requests.push(url.pathname + url.search);
    if (url.pathname.endsWith("/release")) {
      if (url.searchParams.has("track_artist")) return { "release-count": 1, releases: [{ id: releaseId(4) }] };
      const offset = Number(url.searchParams.get("offset"));
      return { "release-count": 3, releases: (offset === 0 ? [1, 2] : [3]).map((n) => ({ id: releaseId(n) })) };
    }
    return release(Number(url.pathname.split("-").at(-1)));
  });
  let cursor: MusicBrainzCursor | null | undefined;
  const imported: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const before = requests.length;
    const step = await collectMusicBrainzStep(artist, cursor, opts);
    assert.equal(requests.length - before, 1);
    imported.push(...step.releases.map((value) => value.externalId));
    cursor = step.nextCursor;
    if (cursor === null) { assert.equal(step.status, "completed"); break; }
    assert.equal(step.status, "collecting");
    cursor = JSON.parse(JSON.stringify(cursor)) as MusicBrainzCursor; // persisted/reloaded worker state
  }
  assert.equal(cursor, null);
  assert.deepEqual(imported, [1, 2, 3, 4].map(releaseId));
  assert.ok(requests.some((url) => url.includes("offset=2")));
  assert.ok(requests.some((url) => url.includes("track_artist=")));
});

test("failure preserves exact pending cursor; Retry-After and empty/not-found/auth states stay distinct", async () => {
  const cursor: MusicBrainzCursor = { version: 1, artistId: artist, phase: "track_artist", offset: 0, pending: [releaseId(1), releaseId(2)] };
  const original = JSON.stringify(cursor);
  for (const [status, code] of [[429, "rate_limited"], [503, "temporary_error"], [404, "not_found"], [403, "permission_required"]] as const) {
    await assert.rejects(() => collectMusicBrainzStep(artist, cursor, options(() => new Response("", { status, headers: { "retry-after": "120" } }))), (error: unknown) => error instanceof MusicProviderError && error.code === code && (status !== 429 || error.retryAfterSeconds === 120));
    assert.equal(JSON.stringify(cursor), original);
  }
  const done = await collectMusicBrainzStep(artist, cursor, options(() => release()));
  assert.deepEqual(done.nextCursor?.pending, [releaseId(2)]);
  assert.equal(JSON.stringify(cursor), original);
});

test("release tracks keep recording versions separate and compilation tracks do not become managed", () => {
  const raw = release();
  raw["artist-credit"] = credits(other);
  const data = normalizeMusicBrainzRelease(raw, artist, "2026-09-08");
  assert.equal(data.participation, true);
  assert.equal(data.tracks[0].managedByArtist, true);
  assert.equal(data.tracks[1].managedByArtist, false);
  assert.notEqual(data.tracks[0].recordingId, data.tracks[1].recordingId);
  assert.notEqual(data.tracks[0].version, data.tracks[1].version);
  assert.deepEqual(data.tracks[0].isrcs, ["USABC2600001"]);
  assert.equal(data.imageUrl, null);
});

test("more than 25 album tracks and multiple discs are retained, incomplete track lists fail closed", () => {
  const raw = release();
  const sample = raw.media[0].tracks[0];
  raw.media[0].tracks = Array.from({ length: 30 }, (_, i) => ({ ...sample, id: trackId(i), position: i + 1 }));
  raw.media[0]["track-count"] = 30;
  raw.media.push({ position: 2, "track-count": 1, tracks: [{ ...sample, id: trackId(31), position: 1 }] });
  assert.equal(normalizeMusicBrainzRelease(raw, artist, "2026-09-08").tracks.length, 31);
  raw.media[0]["track-count"] = 31;
  assert.throws(() => normalizeMusicBrainzRelease(raw, artist, "2026-09-08"), (error: unknown) => error instanceof MusicProviderError && error.code === "invalid_response");
});

test("missing intermediate release page and malformed/truncated payload never count as completion", async () => {
  await assert.rejects(() => collectMusicBrainzStep(artist, null, options(() => ({ "release-count": 200, releases: [] }))), (error: unknown) => error instanceof MusicProviderError && error.code === "invalid_response");
  await assert.rejects(() => searchMusicBrainzArtists("Test", options(() => new Response("invalid JSON"))), (error: unknown) => error instanceof MusicProviderError && error.code === "invalid_response");
  await assert.rejects(() => searchMusicBrainzArtists("Test", options(() => new Response(" ".repeat(8_000_001)))), (error: unknown) => error instanceof MusicProviderError && error.code === "invalid_response");
  await assert.rejects(() => collectMusicBrainzStep(artist, { version: 1, artistId: other, phase: "artist", offset: 0, pending: [] }, options(() => ({}))), (error: unknown) => error instanceof MusicProviderError && error.code === "invalid_input");
});

test("all registration guides have actionable official instructions; administrator URLs are constrained", () => {
  assert.equal(agencyGuides.length, 8);
  for (const guide of agencyGuides) {
    assert.ok(guide.introduction && guide.eligibility && guide.costNote && guide.checkedAt);
    assert.ok(guide.preparation.length && guide.steps.length && guide.after.length && guide.sources.length);
    for (const url of [guide.url, guide.searchUrl, guide.applyUrl, ...guide.sources.map((source) => source.url)]) assert.ok(isOfficialAgencyUrl(url), url);
  }
  assert.equal(isOfficialAgencyUrl("javascript:alert(1)"), false);
  assert.equal(isOfficialAgencyUrl("https://www.komca.or.kr.evil.test/"), false);
  assert.equal(isOfficialAgencyUrl("https://user@www.fkmp.kr/"), false);
});
