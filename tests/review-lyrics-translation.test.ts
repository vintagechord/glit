import assert from "node:assert/strict";
import test from "node:test";

import { foreignLyricSpans } from "../src/lib/review-docs/model";
import { ReviewLyricsTranslationError, translateLyricsForReviewDocuments } from "../src/lib/review-docs/translation";
import { translateLyricsBatch } from "../src/lib/server-lyrics-translation";

test("review ZIP lyrics translate every language while preserving Korean, whitespace and repeated choruses", async () => {
  const requests: string[] = [];
  const lyrics = "  사랑해 I love you\t오늘도\n\n君が好き\nЯ люблю тебя\nأحبك\nฉันรักเธอ\nJe t’aime\nI love you  ";
  const result = await translateLyricsForReviewDocuments([{ lyrics }], {
    translate: async (sources) => { requests.push(...sources); return sources.map(() => "나는 너를 사랑해"); },
  });
  assert.deepEqual(requests, ["I love you", "君が好き", "Я люблю тебя", "أحبك", "ฉันรักเธอ", "Je t’aime"]);
  assert.equal(result[0], "  사랑해 I love you (번역 : 나는 너를 사랑해)\t오늘도\n\n君が好き (번역 : 나는 너를 사랑해)\nЯ люблю тебя (번역 : 나는 너를 사랑해)\nأحبك (번역 : 나는 너를 사랑해)\nฉันรักเธอ (번역 : 나는 너를 사랑해)\nJe t’aime (번역 : 나는 너를 사랑해)\nI love you (번역 : 나는 너를 사랑해)  ");
});

test("review ZIP reuses saved original-plus-inline translations and only translates missing segments", async () => {
  const sources: string[] = [];
  const result = await translateLyricsForReviewDocuments([
    { lyrics: "I love you\n君が好き", translatedLyrics: "I love you (번역: 사랑해)\n君が好き" },
    { lyrics: "Я люблю тебя （번역 ： 사랑해）\nI need you (네가 필요해)" },
  ], { translate: async (batch) => { sources.push(...batch); return batch.map(() => "네가 좋아"); } });
  assert.deepEqual(sources, ["君が好き"]);
  assert.equal(result[0], "I love you (번역: 사랑해)\n君が好き (번역 : 네가 좋아)");
  assert.equal(result[1], "Я люблю тебя （번역 ： 사랑해）\nI need you (네가 필요해)");
});

test("review ZIP reuses a separate translation for every identical foreign occurrence", async () => {
  const result = await translateLyricsForReviewDocuments([
    { lyrics: "I love you\n한국어 I love you", translatedLyrics: "나는 너를 사랑해" },
  ], { translate: async () => { assert.fail("Existing unambiguous translations must be retained"); } });
  assert.equal(result[0], "I love you (번역 : 나는 너를 사랑해)\n한국어 I love you (번역 : 나는 너를 사랑해)");
});

test("review ZIP never replaces changed originals with stale translations or removes original Korean parentheses", async () => {
  const result = await translateLyricsForReviewDocuments([
    { lyrics: "I need you", translatedLyrics: "I love you (번역: 사랑해)" },
    { lyrics: "I love you (널 사랑해)\nStay with me", lyricsWithTranslation: "I love you\nStay with me (번역 : 함께 있어줘)" },
    { lyrics: "오늘도 너를 기다려", lyricsWithTranslation: "어제 너를 보냈어", translatedLyrics: "이것도 지난 한국어 가사" },
    { lyrics: "I need you", lyricsWithTranslation: "어제 너를 보냈어" },
  ], { translate: async (batch) => batch.map(() => "새 번역") });
  assert.equal(result[0], "I need you (번역 : 새 번역)");
  assert.equal(result[1], "I love you (널 사랑해)\nStay with me (번역 : 새 번역)");
  assert.equal(result[2], "오늘도 너를 기다려");
  assert.equal(result[3], "I need you (번역 : 새 번역)");
});

test("review ZIP preserves a separately supplied translation when its segment alignment is ambiguous", async () => {
  const result = await translateLyricsForReviewDocuments([
    { lyrics: "I love you\nStay with me", translatedLyrics: "너를 사랑하고 함께 있고 싶어" },
  ], { translate: async (batch) => batch.map(() => "구간 번역") });
  assert.equal(result[0], "I love you (번역 : 구간 번역)\nStay with me (번역 : 구간 번역)\n\n(번역 : 너를 사랑하고 함께 있고 싶어)");
});

test("review ZIP skips Korean-only lyrics and adlibs permitted by the supplied prompt", async () => {
  assert.deepEqual(await translateLyricsForReviewDocuments([{ lyrics: "한글만 있어\nOh, yeah!\n123" }], {
    translate: async () => { assert.fail("No meaningful foreign lyrics"); },
  }), ["한글만 있어\nOh, yeah!\n123"]);
  assert.equal(foreignLyricSpans("𐐀𐐨𐑌")[0].source, "𐐀𐐨𐑌");
});

test("review ZIP fails visibly for missing, partial, unchanged, or failed translation responses", async () => {
  for (const response of [null, [], [""], ["I love you"], ["번역 실패"], ["사랑해", "추가 결과"]]) {
    await assert.rejects(translateLyricsForReviewDocuments([{ lyrics: "I love you" }], {
      translate: async () => response,
    }), (error: unknown) => error instanceof ReviewLyricsTranslationError && error.code === "REVIEW_TRANSLATION_FAILED" && error.status === 502);
  }
  await assert.rejects(translateLyricsForReviewDocuments([{ lyrics: "I love you\nStay with me" }], {
    translate: async () => ["사랑해", ""],
  }), ReviewLyricsTranslationError);
  await assert.rejects(translateLyricsForReviewDocuments([{ lyrics: "I love you" }], {
    translate: async () => { throw new Error("offline"); },
  }), ReviewLyricsTranslationError);
});

test("review ZIP translation has a total deadline and bounds requests by characters as well as segment count", async () => {
  await assert.rejects(translateLyricsForReviewDocuments([{ lyrics: "I love you" }], {
    translate: async () => new Promise(() => {}), timeoutMs: 5,
  }), ReviewLyricsTranslationError);
  const longLine = "Long foreign lyric ".repeat(300);
  const calls: string[][] = [];
  const result = await translateLyricsForReviewDocuments([{ lyrics: `${longLine}\n${"Next lyric ".repeat(300)}` }], {
    translate: async (batch) => { calls.push(batch); return batch.map(() => "긴 가사 번역"); },
  });
  assert.ok(calls.length > 1);
  assert.ok(calls.every((batch) => batch.length <= 20 && batch.reduce((sum, value) => sum + value.length, 0) <= 4000));
  assert.ok(result[0].startsWith(longLine.trimEnd()));
});

test("shared server translation works through existing fallback providers and deduplicates repeated lyrics", async () => {
  const requested: string[] = [];
  const result = await translateLyricsBatch(["I love you", "I love you", "君が好き", ""], {
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      assert.ok(init?.signal);
      if (url.hostname === "api.openai.com") return new Response("{}", { status: 503 });
      requested.push(url.hostname + ":" + url.searchParams.get("q"));
      if (url.searchParams.get("q") === "I love you") return Response.json([[["사랑해"]]]);
      if (url.hostname === "translate.googleapis.com") return Response.json([[["君が好き"]]]);
      return Response.json({ translation: "네가 좋아" });
    },
  });
  assert.deepEqual(result, ["사랑해", "사랑해", "네가 좋아", ""]);
  assert.equal(requested.filter((url) => url.endsWith(":I love you")).length, 1);
  assert.ok(requested.some((url) => url.startsWith("lingva.ml:")));
});

test("shared server translation rejects partial long-line chunks instead of returning a truncated translation", async () => {
  const result = await translateLyricsBatch(["A".repeat(1200) + "B".repeat(50)], {
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.openai.com") return new Response("{}", { status: 503 });
      if (url.searchParams.get("q")?.startsWith("A")) return Response.json([[["첫 구간 번역"]]]);
      return Response.json({});
    },
  });
  assert.deepEqual(result, [""]);
});
