import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import {
  getAlbumLyricsReviewIssues,
  getAlbumLyricsSubmissionError,
  LYRICS_PROFANITY_MASKING_GUIDANCE,
  MAX_ALBUM_LYRICS_REVIEW_CHARACTERS,
} from "../src/lib/album-lyrics-review";

test("original and translated lyrics are each reviewed instead of trusting a cleaned-up translation", () => {
  const original = getAlbumLyricsReviewIssues([{ lyrics: "fuck you", translatedLyrics: "네가 좋아" }]);
  assert.equal(original[0]?.field, "lyrics");
  assert.equal(original[0]?.blocking, true);
  const translated = getAlbumLyricsReviewIssues([{ lyrics: "네가 좋아", translatedLyrics: "씨 발" }]);
  assert.equal(translated[0]?.field, "translatedLyrics");
  assert.equal(translated[0]?.blocking, true);
  const providerOutput = getAlbumLyricsReviewIssues([{ lyrics: "한국어 가사", translatedLyrics: "엿 먹어라" }]);
  assert.equal(providerOutput[0]?.field, "translatedLyrics");
  assert.equal(providerOutput[0]?.blocking, true);
});

test("unsafe words in any album track remain blocked and the error points to the correct track", () => {
  const message = getAlbumLyricsSubmissionError([
    { lyrics: "깨끗한 가사" }, { lyrics: "f.u.c.k" }, { lyrics: "다른 가사" },
  ]);
  assert.match(message ?? "", /^2번 트랙 · 원문 가사:/);
  assert.match(message ?? "", /접수가 불가/);
  assert.match(LYRICS_PROFANITY_MASKING_GUIDANCE, /실제 음원/);
  assert.match(LYRICS_PROFANITY_MASKING_GUIDANCE, /\[삐처리\]/);
});

test("explicit clean-version cues can be submitted, but spelling censorship is still a finding", () => {
  assert.equal(getAlbumLyricsSubmissionError([{ lyrics: "너는 [삐처리] 오늘 밤 [무음]" }]), null);
  assert.equal(getAlbumLyricsSubmissionError([{ lyrics: "시발점에서 신발을 신고 새끼손가락을 펴" }]), null);
  assert.ok(getAlbumLyricsSubmissionError([{ lyrics: "f*ck" }]));
});

test("uncertain phonetic candidates require review and are never presented as a definite clean result", () => {
  const findings = getAlbumLyricsReviewIssues([{ lyrics: "뻐킹" }]);
  assert.equal(findings[0]?.kind, "suspected");
  assert.equal(findings[0]?.blocking, false);
  assert.match(findings[0]?.message ?? "", /실제 발음과 가사/);
});

test("administrator additions participate in final submission decisions", () => {
  assert.ok(getAlbumLyricsSubmissionError([{ lyrics: "나.쁜-말" }], [{ term: "나쁜말", language: "KO" }]));
});

test("scanner and aggregate limits block incomplete reviews instead of accepting unscanned tails", () => {
  assert.equal(getAlbumLyricsReviewIssues([{ lyrics: "가".repeat(100_001) }])[0]?.kind, "incomplete");
  const tracks = Array.from({ length: 6 }, () => ({ lyrics: "가".repeat(90_000) }));
  assert.ok(tracks.reduce((sum, track) => sum + track.lyrics.length, 0) > MAX_ALBUM_LYRICS_REVIEW_CHARACTERS);
  const issues = getAlbumLyricsReviewIssues(tracks);
  assert.equal(issues[0]?.kind, "incomplete");
  assert.equal(issues[0]?.blocking, true);
});

// Exercise the actual server-action guard with all external effects replaced.
// A browser that omits its local check still reaches this guard before saves.
const source = readFileSync(new URL("../src/features/submissions/actions.ts", import.meta.url), "utf8");
const actionStart = source.indexOf("export async function saveAlbumSubmissionAction");
const guardStart = source.indexOf("    if (!isOneClick && !usesExternalApplicationForm) {", actionStart);
const guardEnd = source.indexOf("\n\n    if (\n      !isAdminReviewer", guardStart);
assert.ok(guardStart > actionStart && guardEnd > guardStart);
assert.ok(guardEnd < source.indexOf("const artistId = isOneClick ? null : await ensureArtistByName", actionStart));
const compiledGuard = ts.transpileModule(`
  return async function run(input, dictionary) {
    const {isOneClick=false, usesExternalApplicationForm=false, tracks:submittedTracks=[]} = input;
    const parsed = {data: {tracks: input.tracks}};
    const getPublicProfanityTerms = dictionary;
    if (input.status === 'SUBMITTED') { ${source.slice(guardStart, guardEnd)} }
    return {saved:true};
  }
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const runGuard = new Function("getAlbumLyricsSubmissionError", "console", compiledGuard)(
  getAlbumLyricsSubmissionError, { error() {} },
) as (input: { status: string; tracks?: Array<{ lyrics?: string; translatedLyrics?: string }>; isOneClick?: boolean; usesExternalApplicationForm?: boolean }, dictionary: () => Promise<Array<{ term: string; language: string }>>) => Promise<{ error?: string; saved?: boolean }>;

test("server guard rejects unsafe final submissions and dictionary outages without reaching save", async () => {
  const input = { status: "SUBMITTED", tracks: [{ lyrics: "phuck" }] };
  assert.ok((await runGuard(input, async () => [])).error);
  assert.deepEqual(await runGuard({ ...input, tracks: [{ lyrics: "깨끗한 가사" }] }, async () => { throw new Error("offline"); }),
    { error: "가사 검사를 완료하지 못했습니다. 잠시 후 다시 시도해주세요." });
  assert.deepEqual(await runGuard({ ...input, tracks: [{ lyrics: "깨끗한 가사" }] }, async () => []), { saved: true });
});

test("omitting the track payload cannot preserve unchecked stored lyrics during final submission", async () => {
  let reads = 0;
  assert.deepEqual(await runGuard({ status: "SUBMITTED" }, async () => { reads++; return []; }),
    { error: "최종 접수 전에 트랙과 가사를 다시 불러와 확인해주세요." });
  assert.equal(reads, 0);
});

test("unfinished drafts are preserved, and unrelated authored-form branches do not inspect hidden tracks", async () => {
  const never = async (): Promise<Array<{ term: string; language: string }>> => { throw new Error("must not query"); };
  for (const status of ["DRAFT", "PRE_REVIEW"]) {
    assert.deepEqual(await runGuard({ status, tracks: [{ lyrics: "fuck" }] }, never), { saved: true });
  }
  assert.deepEqual(await runGuard({ status: "SUBMITTED", tracks: [{ lyrics: "fuck" }], usesExternalApplicationForm: true }, never), { saved: true });
});
