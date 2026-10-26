import assert from "node:assert/strict";
import test from "node:test";
import { collectStreamingStep, lookupStreamingArtist, searchStreamingArtists, type StreamingOptions } from "../src/lib/music-archive/streaming";
import { MusicProviderError } from "../src/lib/music-archive/musicbrainz";
import { createArchiveData } from "../src/lib/music-archive/model";
import { mergeArchiveImports } from "../src/lib/music-archive/import";

const artistId = "A".repeat(22); const albumId = "B".repeat(22); const channelId = `UC${"C".repeat(22)}`;
const timestamp = "2026-10-27T00:00:00.000Z";
const artist = { id: artistId, name: "빈티지코드", genres: ["indie"], images: [{ url: "https://i.scdn.co/image/artist" }] };
const track = (id: string, owner = artistId, position = 1) => ({ id: id.repeat(22), name: `Song ${id}`, artists: [{ id: owner, name: "빈티지코드" }], track_number: position, disc_number: 1, duration_ms: 180_000 });
const album = (items: unknown[], total = items.length) => ({ id: albumId, name: "Moon", artists: [artist], album_type: "album", release_date: "2026-10", total_tracks: total, tracks: { items, total, offset: 0 }, images: [{ url: "https://i.scdn.co/image/album" }] });
const fail = (code: string) => (error: unknown) => error instanceof MusicProviderError && error.code === code;
function options(handler: (url: URL, init?: RequestInit) => unknown): StreamingOptions {
  return {
    env: { SPOTIFY_CLIENT_ID: "client", SPOTIFY_CLIENT_SECRET: "secret", YOUTUBE_DATA_API_KEY: "youtube-secret" }, now: () => Date.parse(timestamp),
    fetcher: (async (input, init) => {
      const url = new URL(String(input));
      assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store"); assert.ok(init?.signal);
      if (url.hostname === "accounts.spotify.com") {
        assert.equal(init?.method, "POST"); assert.equal(init.body, "grant_type=client_credentials");
        assert.equal(new Headers(init.headers).get("authorization"), `Basic ${Buffer.from("client:secret").toString("base64")}`);
        return Response.json({ access_token: "test-token", expires_in: 3600 });
      }
      if (url.hostname === "api.spotify.com") assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token");
      const result = handler(url, init); return result instanceof Response ? result : Response.json(result);
    }) as typeof fetch,
  };
}

test("Spotify text search preserves provider IDs and supports the current ten-result limit", async () => {
  const result = await searchStreamingArtists("spotify", "빈티지코드", options(url => {
    assert.equal(url.origin, "https://api.spotify.com"); assert.equal(url.pathname, "/v1/search");
    assert.equal(url.searchParams.get("q"), "빈티지코드"); assert.equal(url.searchParams.get("limit"), "10"); assert.equal(url.searchParams.get("type"), "artist");
    return { artists: { items: [artist, { ...artist, id: "Z".repeat(22) }] } };
  }));
  assert.equal(result.items.length, 2); assert.notEqual(result.items[0].externalId, result.items[1].externalId);
  assert.equal(result.items[0].imageUrl, artist.images[0].url); assert.match(result.scopeNote, /10/);
});

test("YouTube searches channels, keeps credentials out of URLs and distinguishes album release data", async () => {
  const result = await searchStreamingArtists("youtube", "빈티지코드", options((url, init) => {
    assert.equal(url.pathname, "/youtube/v3/search"); assert.equal(url.searchParams.get("type"), "channel");
    assert.equal(url.searchParams.has("key"), false); assert.equal(new Headers(init?.headers).get("X-Goog-Api-Key"), "youtube-secret");
    return { items: [{ id: { channelId }, snippet: { title: "빈티지코드", description: "공식 채널", thumbnails: { medium: { url: "https://yt3.ggpht.com/example" } } } }] };
  }));
  assert.equal(result.items[0].externalId, channelId); assert.equal(result.items[0].representativeRelease, null);
  assert.match(result.scopeNote, /영상 게시일·재생목록은 앨범 발매 정보가 아니/);
  assert.equal(JSON.stringify(result).includes("youtube-secret"), false);
});

test("artist lookup verifies identity; invalid IDs and missing configuration do not reach the network", async () => {
  let calls = 0;
  const opts = options(() => { calls++; return artist; });
  await assert.rejects(() => lookupStreamingArtist("spotify", "https://evil.test", opts), fail("invalid_input"));
  await assert.rejects(() => lookupStreamingArtist("youtube", `${channelId}?x=y`, opts), fail("invalid_input"));
  assert.equal(calls, 0);
  await assert.rejects(() => searchStreamingArtists("spotify", "name", { ...opts, env: {} }), fail("configuration_required"));
  await assert.rejects(() => searchStreamingArtists("youtube", "name", { ...opts, env: {} }), fail("configuration_required"));
  assert.equal(calls, 0);
  assert.equal((await lookupStreamingArtist("spotify", artistId, opts)).name, artist.name);
  await assert.rejects(() => lookupStreamingArtist("spotify", "Z".repeat(22), opts), fail("invalid_response"));
  assert.equal((await lookupStreamingArtist("youtube", channelId, options(() => ({ items: [{ id: channelId, snippet: { title: "Channel" } }] })))).provider, "youtube");
});

test("Spotify import resumes atomically and retains ownership, partial dates and source links", async () => {
  const paths: string[] = [];
  const opts = options(url => {
    paths.push(url.pathname);
    if (url.pathname.endsWith("/albums") && url.pathname.includes("/artists/")) return { items: [{ id: albumId }], total: 1, offset: 0, next: "https://evil.test/do-not-follow" };
    if (url.pathname.endsWith("/tracks")) { assert.equal(url.searchParams.get("offset"), "1"); return { items: [track("E", "Z".repeat(22), 2)], total: 2, offset: 1 }; }
    return album([track("D")], 2);
  });
  const first = await collectStreamingStep("spotify", artistId, null, opts);
  assert.equal(first.status, "collecting"); assert.equal(first.releases.length, 0);
  const second = await collectStreamingStep("spotify", artistId, first.nextCursor, opts);
  assert.equal(second.nextCursor?.phase, "tracks"); assert.equal(second.releases.length, 0);
  const before = structuredClone(second.nextCursor);
  const third = await collectStreamingStep("spotify", artistId, second.nextCursor, opts);
  assert.deepEqual(second.nextCursor, before, "a failed commit can retry the unchanged cursor");
  assert.equal(third.status, "completed"); assert.equal(third.nextCursor, null);
  const release = third.releases[0];
  assert.equal(release.date, "2026-10"); assert.equal(release.tracks.length, 2);
  assert.equal(release.tracks[0].managedByArtist, true); assert.equal(release.tracks[1].managedByArtist, false);
  assert.equal(release.url, `https://open.spotify.com/album/${albumId}`); assert.equal(paths.length, 3);
  const imported = mergeArchiveImports(createArchiveData("빈티지코드"), third.releases);
  assert.equal(imported.releases[0].source?.provider, "spotify"); assert.equal(imported.tracks.length, 2);
});

test("album pagination advances by numeric offset and rejects missing middle pages", async () => {
  const first = await collectStreamingStep("spotify", artistId, null, options(() => ({ items: [{ id: albumId }], total: 2, offset: 0 })));
  const second = await collectStreamingStep("spotify", artistId, first.nextCursor, options(() => album([track("D")])));
  assert.equal(second.nextCursor?.phase, "albums"); assert.equal(second.nextCursor?.offset, 1);
  await assert.rejects(() => collectStreamingStep("spotify", artistId, second.nextCursor, options(() => ({ items: [], total: 2, offset: 1 }))), fail("invalid_response"));
  await assert.rejects(() => collectStreamingStep("spotify", "Z".repeat(22), second.nextCursor, options(() => { throw new Error("must not fetch"); })), fail("invalid_input"));
});

test("truncated, duplicate and wrongly attributed tracks never become complete releases", async () => {
  const first = await collectStreamingStep("spotify", artistId, null, options(() => ({ items: [{ id: albumId }], total: 1, offset: 0 })));
  for (const payload of [
    { ...album([track("D")]), total_tracks: 2 }, album([track("D"), track("D")]),
    { ...album([track("D", "Z".repeat(22))]), artists: [{ ...artist, id: "Z".repeat(22) }] },
  ]) await assert.rejects(() => collectStreamingStep("spotify", artistId, first.nextCursor, options(() => payload)), fail("invalid_response"));
});

test("provider failures redact response bodies and honor rate limit backoff", async () => {
  await assert.rejects(() => searchStreamingArtists("youtube", "name", options(() => new Response("secret details", { status: 403 }))), (error: unknown) => error instanceof MusicProviderError && error.code === "permission_required" && !error.message.includes("secret"));
  await assert.rejects(() => searchStreamingArtists("spotify", "name", options(() => new Response("", { status: 429, headers: { "Retry-After": "120" } }))), (error: unknown) => error instanceof MusicProviderError && error.retryAfterSeconds === 120);
  await assert.rejects(() => searchStreamingArtists("youtube", "name", options(() => new Response("{}", { headers: { "Content-Length": "2000001" } }))), fail("invalid_response"));
  await assert.rejects(() => searchStreamingArtists("spotify", "name", options(() => ({ artists: {} }))), fail("invalid_response"));
});

test("persisted track cursors reject forged scope and corrupt phase state before any request", async () => {
  const first = await collectStreamingStep("spotify", artistId, null, options(() => ({ items: [{ id: albumId }], total: 1, offset: 0 })));
  const second = await collectStreamingStep("spotify", artistId, first.nextCursor, options(() => album([track("D")], 2)));
  assert.ok(second.nextCursor?.active);
  const corruptions = [
    (cursor: NonNullable<typeof second.nextCursor>) => { cursor.active!.release.tracks[0].managedByArtist = false; },
    (cursor: NonNullable<typeof second.nextCursor>) => { cursor.active!.release.url = "https://evil.test/album"; },
    (cursor: NonNullable<typeof second.nextCursor>) => { cursor.active!.offset = 0; },
    (cursor: NonNullable<typeof second.nextCursor>) => { cursor.phase = "done"; },
    (cursor: NonNullable<typeof second.nextCursor>) => { cursor.pending = []; },
  ];
  let calls = 0;
  for (const corrupt of corruptions) {
    const cursor = structuredClone(second.nextCursor!); corrupt(cursor);
    await assert.rejects(() => collectStreamingStep("spotify", artistId, cursor, options(() => { calls++; return {}; })), fail("invalid_input"));
  }
  assert.equal(calls, 0);
});

test("oversized pages fail before persistence; invalid release dates are not invented", async () => {
  await assert.rejects(() => collectStreamingStep("spotify", artistId, null, options(() => ({ items: Array.from({ length: 51 }, () => ({ id: albumId })), total: 51, offset: 0 }))), fail("invalid_response"));
  const first = await collectStreamingStep("spotify", artistId, null, options(() => ({ items: [{ id: albumId }], total: 1, offset: 0 })));
  for (const [date, expected] of [["2026-02-29", ""], ["2024-02-29", "2024-02-29"], ["2026-99", ""], ["2026", "2026"]]) {
    const result = await collectStreamingStep("spotify", artistId, first.nextCursor, options(() => ({ ...album([track("D")]), release_date: date })));
    assert.equal(result.releases[0].date, expected);
  }
});
