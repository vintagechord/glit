import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import {
  getAlbumLyricsReviewIssues,
  LYRICS_PROFANITY_MASKING_GUIDANCE,
  LYRICS_PROFANITY_NOTICE_MESSAGE,
  MAX_ALBUM_LYRICS_REVIEW_CHARACTERS,
} from "../src/lib/album-lyrics-review";

// Owner decision 2026-11-26: the check only informs. Nothing it finds blocks
// a step, the preflight or the server action.

test("original and translated lyrics are each reviewed instead of trusting a cleaned-up translation", () => {
  const original = getAlbumLyricsReviewIssues([{ lyrics: "fuck you", translatedLyrics: "네가 좋아" }]);
  assert.equal(original[0]?.field, "lyrics");
  assert.equal(original[0]?.kind, "profanity");
  const translated = getAlbumLyricsReviewIssues([{ lyrics: "네가 좋아", translatedLyrics: "씨 발" }]);
  assert.equal(translated[0]?.field, "translatedLyrics");
  assert.equal(translated[0]?.kind, "profanity");
  const providerOutput = getAlbumLyricsReviewIssues([{ lyrics: "한국어 가사", translatedLyrics: "엿 먹어라" }]);
  assert.equal(providerOutput[0]?.field, "translatedLyrics");
});

test("a finding names its track and tells the applicant what to check, without refusing the application", () => {
  const issues = getAlbumLyricsReviewIssues([{ lyrics: "깨끗한 가사" }, { lyrics: "f.u.c.k" }, { lyrics: "다른 가사" }]);
  assert.deepEqual(issues.map((issue) => [issue.trackIndex, issue.kind]), [[1, "profanity"]]);
  assert.equal(issues[0].message, LYRICS_PROFANITY_NOTICE_MESSAGE);
  assert.doesNotMatch(LYRICS_PROFANITY_NOTICE_MESSAGE, /불가|제출할 수 없/);
  assert.match(LYRICS_PROFANITY_MASKING_GUIDANCE, /실제 음원/);
  assert.match(LYRICS_PROFANITY_MASKING_GUIDANCE, /\[삐처리\]/);
});

test("explicit clean-version cues and ordinary words are clean, spelling censorship is still a finding", () => {
  assert.deepEqual(getAlbumLyricsReviewIssues([{ lyrics: "너는 [삐처리] 오늘 밤 [무음]" }]), []);
  assert.deepEqual(getAlbumLyricsReviewIssues([{ lyrics: "시발점에서 신발을 신고 새끼손가락을 펴" }]), []);
  assert.equal(getAlbumLyricsReviewIssues([{ lyrics: "f*ck" }])[0]?.kind, "profanity");
});

test("two ordinary words joined across a space are only a candidate to look at", () => {
  // Production audit 2026-11-26: these used to stop the application outright.
  for (const lyrics of ["나의 시 발표회", "수박 씨 발라", "존 나와라", "이건 나의 시\n발끝까지"]) {
    assert.deepEqual(getAlbumLyricsReviewIssues([{ lyrics }]).map((issue) => issue.kind), ["suspected"], lyrics);
  }
  assert.equal(getAlbumLyricsReviewIssues([{ lyrics: "씨 발" }])[0]?.kind, "profanity");
});

test("uncertain phonetic candidates require review and are never presented as a definite clean result", () => {
  const findings = getAlbumLyricsReviewIssues([{ lyrics: "뻐킹" }]);
  assert.equal(findings[0]?.kind, "suspected");
  assert.match(findings[0]?.message ?? "", /실제 발음과 가사/);
});

test("administrator additions are found too", () => {
  assert.equal(getAlbumLyricsReviewIssues([{ lyrics: "나.쁜-말" }], [{ term: "나쁜말", language: "KO" }])[0]?.kind, "profanity");
});

test("scanner and aggregate limits say the check was partial instead of reporting clean lyrics", () => {
  assert.equal(getAlbumLyricsReviewIssues([{ lyrics: "가".repeat(100_001) }])[0]?.kind, "incomplete");
  const tracks = Array.from({ length: 6 }, () => ({ lyrics: "가".repeat(90_000) }));
  assert.ok(tracks.reduce((sum, track) => sum + track.lyrics.length, 0) > MAX_ALBUM_LYRICS_REVIEW_CHARACTERS);
  assert.equal(getAlbumLyricsReviewIssues(tracks)[0]?.kind, "incomplete");
});

// Exercise the server action's final-save guard with all external effects
// replaced: it still needs the tracks, and no longer re-runs the lyrics check.
const source = readFileSync(new URL("../src/features/submissions/actions.ts", import.meta.url), "utf8");
const actionStart = source.indexOf("export async function saveAlbumSubmissionAction");
const guardStart = source.indexOf("    if (!isOneClick && !usesExternalApplicationForm && parsed.data.tracks === undefined) {", actionStart);
const guardEnd = source.indexOf("\n\n    if (\n      !isAdminReviewer", guardStart);
assert.ok(guardStart > actionStart && guardEnd > guardStart);
assert.ok(guardEnd < source.indexOf("const artistId = isOneClick ? null : await ensureArtistByName", actionStart));
assert.doesNotMatch(source.slice(actionStart, guardEnd), /getPublicProfanityTerms|getAlbumLyricsReviewIssues|analyzeLyricsProfanity/);
const compiledGuard = ts.transpileModule(`
  return async function run(input) {
    const {isOneClick=false, usesExternalApplicationForm=false} = input;
    const parsed = {data: {tracks: input.tracks}};
    if (input.status === 'SUBMITTED') { ${source.slice(guardStart, guardEnd)} }
    return {saved:true};
  }
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const runGuard = new Function(compiledGuard)() as (input: { status: string; tracks?: Array<{ lyrics?: string; translatedLyrics?: string }>; isOneClick?: boolean; usesExternalApplicationForm?: boolean }) => Promise<{ error?: string; saved?: boolean }>;

test("lyrics with profanity reach the save; the final submission still needs its tracks", async () => {
  assert.deepEqual(await runGuard({ status: "SUBMITTED", tracks: [{ lyrics: "phuck" }] }), { saved: true });
  assert.deepEqual(await runGuard({ status: "SUBMITTED", tracks: [{ lyrics: "씨발" }] }), { saved: true });
  assert.deepEqual(await runGuard({ status: "SUBMITTED" }), { error: "최종 접수 전에 트랙과 가사를 다시 불러와 확인해주세요." });
  assert.deepEqual(await runGuard({ status: "SUBMITTED", usesExternalApplicationForm: true }), { saved: true });
  assert.deepEqual(await runGuard({ status: "DRAFT" }), { saved: true });
});
