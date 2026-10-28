import assert from "node:assert/strict";
import test from "node:test";
import { createAutomaticArtistSearch, type AutomaticArtistProvider } from "../src/lib/music-archive/automatic-artist-search";
import { MusicProviderError } from "../src/lib/music-archive/musicbrainz";
import { getMusicProviderStatuses, type ArtistCandidate } from "../src/lib/music-archive/providers";

const providers = getMusicProviderStatuses({});
function candidate(provider: AutomaticArtistProvider, externalId: string, name = "같은 이름"): ArtistCandidate {
  return { provider, externalId, name, sortName: name, disambiguation: "", country: "", type: "", url: `https://example.test/${provider}/${externalId}`, imageUrl: null, representativeRelease: null };
}

test("automatic search starts connected services together and skips unconfigured credentials", async () => {
  const search = createAutomaticArtistSearch();
  const calls: string[] = [];
  const finish: (() => void)[] = [];
  const promise = search("같은 이름", 0, providers, async (provider, query, signal) => {
    calls.push(provider); assert.equal(query, "같은 이름"); assert.equal(signal.aborted, false);
    await new Promise<void>(resolve => finish.push(resolve));
    return { items: [candidate(provider, "1")] };
  });
  assert.deepEqual(calls, ["melon", "genie", "apple"], "all services start before any response resolves");
  finish.forEach(resolve => resolve());
  const result = await promise;
  assert.deepEqual(result.items.map(item => item.provider), ["melon", "genie", "apple"]);
  assert.equal(result.providerResults.find(item => item.provider === "spotify")?.status, "configuration_required");
  assert.equal(result.providerResults.find(item => item.provider === "youtube")?.status, "configuration_required");
  assert.equal(result.queryStatus, "success");
});

test("exact names rank first while same-name IDs, provider identities and provider alias matches remain distinct", async () => {
  const search = createAutomaticArtistSearch();
  const result = await search("같은 이름", 0, providers, async provider => ({ items: provider === "melon"
    ? [candidate("melon", "1", "같은 이름 밴드"), candidate("melon", "2"), candidate("melon", "2"), candidate("melon", "3")]
    : provider === "genie" ? [candidate("genie", "2")] : [candidate("apple", "2", "Official English Alias")] }));
  assert.deepEqual(result.items.map(item => `${item.provider}:${item.externalId}`), ["melon:2", "melon:3", "genie:2", "melon:1", "apple:2"]);
  assert.equal(result.total, 5);
});

test("partial failure keeps valid results, redacts internal errors and retries only on a fresh search", async () => {
  const search = createAutomaticArtistSearch();
  let broken = true; let calls = 0;
  const source = async (provider: AutomaticArtistProvider) => {
    calls++;
    if (provider === "melon" && broken) throw new Error("password=private-server-value");
    return { items: Array.from({ length: 20 }, (_, index) => candidate(provider, String(index + 1))) };
  };
  const first = await search("같은 이름", 0, providers, source);
  assert.equal(first.queryStatus, "success"); assert.equal(first.total, 40);
  assert.equal(first.providerResults.find(item => item.provider === "melon")?.status, "temporary_error");
  assert.match(first.message!, /멜론/); assert.doesNotMatch(JSON.stringify(first), /password|private-server/);
  broken = false;
  const fresh = await search("같은 이름", 0, providers, source);
  assert.equal(fresh.total, 60); assert.equal(calls, 6); assert.notEqual(fresh.searchId, first.searchId);
  const oldPage = await search("같은 이름", 20, providers, source, first.searchId);
  assert.equal(oldPage.total, 40); assert.equal(oldPage.searchId, first.searchId); assert.equal(calls, 6);
  assert.ok(oldPage.items.every(item => item.provider === "apple"), "pagination uses its original snapshot even after a fresh search");
});

test("identical in-flight searches and later pages share one bounded public snapshot", async () => {
  let now = 1000;
  const search = createAutomaticArtistSearch({ now: () => now });
  let calls = 0;
  const source = async (provider: AutomaticArtistProvider) => { calls++; return { items: Array.from({ length: 20 }, (_, index) => candidate(provider, String(index + 1))) }; };
  const [first, shared] = await Promise.all([search("같은 이름", 0, providers, source), search("같은 이름", 0, providers, source)]);
  assert.equal(calls, 3); assert.equal(first.searchId, shared.searchId);
  now += 61_000;
  const second = await search("같은 이름", 20, providers, source, first.searchId);
  const third = await search("같은 이름", 40, providers, source, first.searchId);
  assert.equal(calls, 3); assert.equal(third.nextOffset, null);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(item => `${item.provider}:${item.externalId}`)).size, 60);
  const mismatched = await search("다른 이름", 20, providers, source, first.searchId);
  assert.equal(mismatched.queryStatus, "temporary_error"); assert.deepEqual(mismatched.items, []); assert.equal(calls, 3);
  now += 600_000;
  const expired = await search("같은 이름", 20, providers, source, first.searchId);
  assert.equal(expired.queryStatus, "temporary_error"); assert.match(expired.message!, /유효 시간/); assert.equal(calls, 3);
});

test("a stalled provider is aborted within the search deadline without hiding completed services", async () => {
  const search = createAutomaticArtistSearch({ timeoutMs: 15 });
  let stalledSignal: AbortSignal | undefined;
  const result = await search("같은 이름", 0, providers, async (provider, _, signal) => {
    if (provider === "melon") { stalledSignal = signal; return new Promise(() => {}); }
    return { items: [candidate(provider, "1")] };
  });
  assert.equal(stalledSignal?.aborted, true);
  assert.equal(result.queryStatus, "success");
  assert.deepEqual(result.items.map(item => item.provider), ["genie", "apple"]);
  assert.equal(result.providerResults.find(item => item.provider === "melon")?.status, "temporary_error");
});

test("empty successful catalogs differ from unavailable services and provider permission is preserved", async () => {
  const search = createAutomaticArtistSearch();
  const empty = await search("빈 결과", 0, providers, async provider => {
    if (provider === "melon") throw new MusicProviderError("permission_required", "restricted");
    return { items: [] };
  });
  assert.equal(empty.queryStatus, "no_results");
  assert.equal(empty.providerResults.find(item => item.provider === "melon")?.status, "forbidden");
  const failed = await search("오류", 0, providers, async () => { throw new MusicProviderError("temporary_error", "down"); });
  assert.equal(failed.queryStatus, "temporary_error");
  assert.match(failed.message!, /완료하지 못/);
});

test("newly configured services invalidate search cache and run automatically", async () => {
  const search = createAutomaticArtistSearch();
  const calls: string[] = [];
  const source = async (provider: AutomaticArtistProvider) => { calls.push(provider); return { items: [candidate(provider, "1")] }; };
  await search("같은 이름", 0, providers, source);
  const configured = getMusicProviderStatuses({ SPOTIFY_CLIENT_ID: "fixture", SPOTIFY_CLIENT_SECRET: "fixture", YOUTUBE_DATA_API_KEY: "fixture" });
  const result = await search("같은 이름", 0, configured, source);
  assert.deepEqual(calls, ["melon", "genie", "apple", "melon", "genie", "spotify", "apple", "youtube"]);
  assert.deepEqual(result.items.map(item => item.provider), ["melon", "genie", "spotify", "apple", "youtube"]);
});
