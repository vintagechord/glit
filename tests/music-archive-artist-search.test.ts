import assert from "node:assert/strict";
import test from "node:test";
import {
  getArtistInitials, isInitialConsonantQuery, matchArtistCandidate,
  normalizeArtistSearchText, rankArtistCandidates, type SearchableArtistCandidate,
} from "../src/lib/music-archive/artist-search";

const artist = (name: string, externalId = name, extra: Partial<SearchableArtistCandidate> = {}): SearchableArtistCandidate => ({ provider: "apple", externalId, name, ...extra });

test("all nineteen Korean initial consonants and syllable boundaries are preserved", () => {
  assert.equal(getArtistInitials("가까나다따라마바빠사싸아자짜차카타파하"), "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ");
  assert.equal(getArtistInitials("각, 값! 똠 / 꽁 · 힣"), "ㄱㄱㄸㄲㅎ");
  assert.equal(getArtistInitials("박효신"), "ㅂㅎㅅ");
  assert.equal(getArtistInitials("김범수"), "ㄱㅂㅅ");
});

test("Unicode normalization handles decomposed Hangul, fullwidth Latin and accented aliases", () => {
  assert.equal(normalizeArtistSearchText("  Park-Hyo_Shin · ＢＴＳ  "), "parkhyoshinbts");
  assert.equal(normalizeArtistSearchText("박효신".normalize("NFD")), "박효신");
  assert.equal(normalizeArtistSearchText("ROSÉ"), "rose");
  assert.equal(getArtistInitials("10cm / BTS / 아이유"), "10cmbtsㅇㅇㅇ");
  assert.equal(getArtistInitials("ᄀᄁᄂ"), "ㄱㄲㄴ");
});

test("initial-only queries exclude empty, syllable, vowel and mixed English searches", () => {
  for (const query of ["ㅂㅎㅅ", "  ㄱ · ㅂ / ㅅ ", "ㄲㄸㅃㅆㅉ", "ᄇᄒᄉ"]) assert.equal(isInitialConsonantQuery(query), true, query);
  for (const query of ["", "  ", "---", "ㅎㅛ", "가", "ㄳ", "BTS", "ㄱB", "김ㅂ", "123"]) assert.equal(isInitialConsonantQuery(query), false, query);
});

test("matching searches real names, sort names and explicit aliases without phonetic guesses", () => {
  const candidate = artist("Park Hyo Shin", "1", { sortName: "박효신", aliases: ["박 효 신", "PARKHYOSHIN"] });
  assert.equal(matchArtistCandidate(candidate, "park-hyo-shin")?.kind, "exact");
  assert.equal(matchArtistCandidate(candidate, "박효")?.kind, "prefix");
  assert.equal(matchArtistCandidate(candidate, "ㅂㅎ")?.kind, "initial_prefix");
  assert.equal(matchArtistCandidate(candidate, "효신"), null, "infix is not an unqualified name-prefix match");
  assert.equal(matchArtistCandidate(artist("BTS"), "ㅂㅌㅅㄴㄷ"), null, "English names are not automatically translated");
  assert.equal(matchArtistCandidate(artist("김범수"), "강"), null, "syllable queries must not match any name with the same initial");
});

test("verified Apple KR slugs provide Korean aliases for the same public artist ID", () => {
  const candidate = artist("Park Hyo Shin", "123", { url: "https://music.apple.com/kr/artist/%EB%B0%95%ED%9A%A8%EC%8B%A0/123?uo=4" });
  assert.equal(matchArtistCandidate(candidate, "박효신")?.kind, "exact");
  assert.equal(matchArtistCandidate(candidate, "ㅂㅎㅅ")?.kind, "initial_prefix");
  for (const url of [
    "https://music.apple.com/kr/artist/박효신/456",
    "https://music.apple.com.evil.example/kr/artist/박효신/123",
    "https://music.apple.com@evil.example/kr/artist/박효신/123",
    "https://user:pass@music.apple.com/kr/artist/박효신/123",
    "http://music.apple.com/kr/artist/박효신/123",
    "https://music.apple.com:444/kr/artist/박효신/123",
    "https://music.apple.com/kr/album/박효신/123",
    "https://music.apple.com/kr/artist/%E0%A4%A/123",
  ]) assert.equal(matchArtistCandidate(artist("Park Hyo Shin", "123", { url }), "박효신"), null, url);
  assert.equal(matchArtistCandidate({ ...candidate, provider: "musicbrainz" }, "박효신"), null);
});

test("exact matches outrank full prefixes and preserve original provider order among ties", () => {
  const candidates = [artist("아이유 밴드", "prefix-a"), artist("아이유", "exact"), artist("아이유 프로젝트", "prefix-b"), artist("가수", "other")];
  assert.deepEqual(rankArtistCandidates(candidates, "아이유").map(entry => entry.externalId), ["exact", "prefix-a", "prefix-b"]);
  const mixed = [artist("김범수", "initial"), artist("ㄱㅂㅅ band", "prefix"), artist("ㄱㅂㅅ", "exact")];
  assert.deepEqual(rankArtistCandidates(mixed, "ㄱㅂㅅ").map(entry => entry.externalId), ["exact", "prefix", "initial"]);
});

test("duplicate provider IDs choose their strongest public match while different providers stay distinct", () => {
  const candidates = [artist("아이유 밴드", "1"), artist("아이유", "1"), artist("아이유", "1", { provider: "musicbrainz" }), artist("아이유", "1")];
  const ranked = rankArtistCandidates(candidates, "아이유");
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0], candidates[1]);
  assert.equal(ranked[1].provider, "musicbrainz");
});

test("results are bounded, empty queries do not expose the cache, and inputs remain unchanged", () => {
  const candidates = Object.freeze(Array.from({ length: 30 }, (_, index) => Object.freeze(artist(`검색 가수 ${index}`, String(index)))));
  assert.equal(rankArtistCandidates(candidates, "검색").length, 20);
  assert.equal(rankArtistCandidates(candidates, "검색", 100).length, 20);
  assert.equal(rankArtistCandidates(candidates, "검색", 3).length, 3);
  assert.equal(rankArtistCandidates(candidates, "검색", 0).length, 0);
  assert.equal(rankArtistCandidates(candidates, "검색", -1).length, 0);
  assert.equal(rankArtistCandidates(candidates, " ").length, 0);
  assert.equal(candidates.length, 30);
  assert.equal(candidates[0].name, "검색 가수 0");
});

test("helpers do not request or retain names from elsewhere, and ignore unrelated/private fields", (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("pure matching must not fetch"); });
  const candidates = [Object.freeze({ ...artist("공식 이름", "1"), note: "개인 이름", disambiguation: "개인 이름" })];
  assert.deepEqual(rankArtistCandidates(candidates, "개인 이름"), []);
  assert.equal(rankArtistCandidates(candidates, "공식 이름").length, 1);
  assert.deepEqual(rankArtistCandidates([], "공식 이름"), [], "previous calls must not add to a global cache");
});
