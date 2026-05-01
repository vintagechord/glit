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
    ["I love you (번역: 사랑해) 난 너를", "오늘도 singing. (번역: 노래해)"],
  );
});
