import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInlineTranslatedLyrics,
  collectForeignLyricsSegments,
  extractForeignSegments,
  hasNonKoreanLyrics,
} from "../src/lib/lyrics-tools";

test("hasNonKoreanLyrics detects foreign letters only", () => {
  assert.equal(hasNonKoreanLyrics("사랑해"), false);
  assert.equal(hasNonKoreanLyrics("사랑해 I love you"), true);
  assert.equal(hasNonKoreanLyrics("123 !!!"), false);
});

test("extractForeignSegments skips already translated inline lyrics", () => {
  assert.deepEqual(extractForeignSegments("I love you (번역: 사랑해)"), []);
  assert.deepEqual(extractForeignSegments("I love you 번역: 사랑해"), []);
});

test("buildInlineTranslatedLyrics preserves Korean lyrics and translates foreign segments", () => {
  const { lines, segmentMap, sentencesToTranslate } =
    collectForeignLyricsSegments("I love you 난 너를\n오늘도 singing.");

  assert.deepEqual(sentencesToTranslate, ["I love you", "singing."]);
  assert.deepEqual(
    buildInlineTranslatedLyrics(lines, segmentMap, ["사랑해", "노래해"]),
    ["I love you (번역 : 사랑해) 난 너를", "오늘도 singing. (번역 : 노래해)"],
  );
});

test("inline lyric editing preserves sentence spacing and skips all existing translation markers", () => {
  const value = "  Bonjour!\tJe t’aime. 한글\nЯ люблю тебя (번역 : 사랑해)\nأحبك（해석：사랑해）";
  const { lines, segmentMap, sentencesToTranslate } = collectForeignLyricsSegments(value);
  assert.deepEqual(sentencesToTranslate, ["Bonjour!", "Je t’aime."]);
  assert.equal(buildInlineTranslatedLyrics(lines, segmentMap, ["안녕!", "널 사랑해."]).join("\n"),
    "  Bonjour! (번역 : 안녕!)\tJe t’aime. (번역 : 널 사랑해.) 한글\nЯ люблю тебя (번역 : 사랑해)\nأحبك（해석：사랑해）");
  assert.throws(() => buildInlineTranslatedLyrics(lines, segmentMap, ["안녕!"]), /Translation failed/);
});
