import assert from "node:assert/strict";
import test from "node:test";

import { foreignLyricSpans } from "../src/lib/review-docs/model";
import { translateLyricsForReviewDocuments } from "../src/lib/review-docs/translation";
import { translateLyricsBatch } from "../src/lib/server-lyrics-translation";

test("review ZIP lyrics translate every language while preserving Korean, whitespace and repeated choruses", async () => {
  const requests: string[] = [];
  const lyrics = "  사랑해 I love you\t오늘도\n\n君が好き\nЯ люблю тебя\nأحبك\nฉันรักเธอ\nJe t’aime\nI love you  ";
  const result = await translateLyricsForReviewDocuments([{ lyrics }], {
    translate: async (sources) => { requests.push(...sources); return sources.map(() => "나는 너를 사랑해"); },
  });
  assert.deepEqual(requests, ["I love you", "君が好き", "Я люблю тебя", "أحبك", "ฉันรักเธอ", "Je t’aime"]);
  assert.equal(result.lyrics[0], "  사랑해 I love you (번역 : 나는 너를 사랑해)\t오늘도\n\n君が好き (번역 : 나는 너를 사랑해)\nЯ люблю тебя (번역 : 나는 너를 사랑해)\nأحبك (번역 : 나는 너를 사랑해)\nฉันรักเธอ (번역 : 나는 너를 사랑해)\nJe t’aime (번역 : 나는 너를 사랑해)\nI love you (번역 : 나는 너를 사랑해)  ");
});

test("review ZIP reuses saved original-plus-inline translations and only translates missing segments", async () => {
  const sources: string[] = [];
  const result = await translateLyricsForReviewDocuments([
    { lyrics: "I love you\n君が好き", translatedLyrics: "I love you (번역: 사랑해)\n君が好き" },
    { lyrics: "Я люблю тебя （번역 ： 사랑해）\nI need you (네가 필요해)" },
  ], { translate: async (batch) => { sources.push(...batch); return batch.map(() => "네가 좋아"); } });
  assert.deepEqual(sources, ["君が好き"]);
  assert.equal(result.lyrics[0], "I love you (번역: 사랑해)\n君が好き (번역 : 네가 좋아)");
  assert.equal(result.lyrics[1], "Я люблю тебя （번역 ： 사랑해）\nI need you (네가 필요해)");
});

test("review ZIP reuses a separate translation for every identical foreign occurrence", async () => {
  const result = await translateLyricsForReviewDocuments([
    { lyrics: "I love you\n한국어 I love you", translatedLyrics: "나는 너를 사랑해" },
  ], { translate: async () => { assert.fail("Existing unambiguous translations must be retained"); } });
  assert.equal(result.lyrics[0], "I love you (번역 : 나는 너를 사랑해)\n한국어 I love you (번역 : 나는 너를 사랑해)");
});

test("review ZIP never replaces changed originals with stale translations or removes original Korean parentheses", async () => {
  const result = await translateLyricsForReviewDocuments([
    { lyrics: "I need you", translatedLyrics: "I love you (번역: 사랑해)" },
    { lyrics: "I love you (널 사랑해)\nStay with me", lyricsWithTranslation: "I love you\nStay with me (번역 : 함께 있어줘)" },
    { lyrics: "오늘도 너를 기다려", lyricsWithTranslation: "어제 너를 보냈어", translatedLyrics: "이것도 지난 한국어 가사" },
    { lyrics: "I need you", lyricsWithTranslation: "어제 너를 보냈어" },
  ], { translate: async (batch) => batch.map(() => "새 번역") });
  assert.equal(result.lyrics[0], "I need you (번역 : 새 번역)");
  assert.equal(result.lyrics[1], "I love you (널 사랑해)\nStay with me (번역 : 새 번역)");
  assert.equal(result.lyrics[2], "오늘도 너를 기다려");
  assert.equal(result.lyrics[3], "I need you (번역 : 새 번역)");
});

test("review ZIP preserves a separately supplied translation when its segment alignment is ambiguous", async () => {
  const result = await translateLyricsForReviewDocuments([
    { lyrics: "I love you\nStay with me", translatedLyrics: "너를 사랑하고 함께 있고 싶어" },
  ], { translate: async (batch) => batch.map(() => "구간 번역") });
  assert.equal(result.lyrics[0], "I love you (번역 : 구간 번역)\nStay with me (번역 : 구간 번역)\n\n(번역 : 너를 사랑하고 함께 있고 싶어)");
});

test("review ZIP skips Korean-only lyrics and adlibs permitted by the supplied prompt", async () => {
  assert.deepEqual(await translateLyricsForReviewDocuments([{ lyrics: "한글만 있어\nOh, yeah!\n123" }], {
    translate: async () => { assert.fail("No meaningful foreign lyrics"); },
  }), { lyrics: ["한글만 있어\nOh, yeah!\n123"], translated: [0], untranslated: [0], failure: null });
  assert.equal(foreignLyricSpans("𐐀𐐨𐑌")[0].source, "𐐀𐐨𐑌");
});

test("a translation service problem never stops the documents: untranslated passages stay as written and are counted", async () => {
  // Missing, short, empty, echoed, refused or extra replies: nothing usable came back.
  for (const response of [null, [], [""], ["I love you"], ["번역 실패"], ["사랑해", "추가 결과"]]) {
    const result = await translateLyricsForReviewDocuments([{ lyrics: "I love you" }], { translate: async () => response });
    assert.deepEqual(result.lyrics, ["I love you"], JSON.stringify(response));
    assert.deepEqual([result.translated, result.untranslated], [[0], [1]]);
    assert.match(result.failure ?? "", /번역/);
  }
  // A partial reply keeps what was translated and leaves the rest as written.
  const partial = await translateLyricsForReviewDocuments([{ lyrics: "I love you\nStay with me" }, { lyrics: "한글만" }], {
    translate: async () => ["사랑해", ""],
  });
  assert.deepEqual(partial.lyrics, ["I love you (번역 : 사랑해)\nStay with me", "한글만"]);
  assert.deepEqual([partial.translated, partial.untranslated], [[1, 0], [1, 0]]);
  assert.ok(partial.failure);
  const offline = await translateLyricsForReviewDocuments([{ lyrics: "I love you" }], {
    translate: async () => { throw new Error("offline"); },
  });
  assert.deepEqual([offline.lyrics, offline.untranslated], [["I love you"], [1]]);
  // One failed request does not lose the other requests' translations.
  let call = 0;
  const lines = Array.from({ length: 25 }, (_, index) => `Line ${String.fromCharCode(65 + index)}`);
  const mixed = await translateLyricsForReviewDocuments([{ lyrics: lines.join("\n") }], {
    translate: async (batch) => { if (call++ === 0) throw new Error("first request fails"); return batch.map(() => "번역됨"); },
  });
  assert.deepEqual([mixed.translated, mixed.untranslated], [[5], [20]]);
  // The original text is never altered, translated or not.
  assert.equal(mixed.lyrics[0].replace(/ \(번역 : 번역됨\)/g, ""), lines.join("\n"));
});

test("Japanese, Chinese, Spanish and other languages are translated in the same pass, originals untouched", async () => {
  const lyrics = "君を愛してる\n我爱你\nTe quiero mucho\nJe t’aime\n사랑해 forever";
  const asked: string[] = [];
  const result = await translateLyricsForReviewDocuments([{ lyrics }], {
    translate: async (batch) => { asked.push(...batch); return batch.map((source) => `${source.length}자 번역`); },
  });
  assert.deepEqual(asked, ["君を愛してる", "我爱你", "Te quiero mucho", "Je t’aime", "forever"]);
  assert.equal(result.lyrics[0],
    "君を愛してる (번역 : 6자 번역)\n我爱你 (번역 : 3자 번역)\nTe quiero mucho (번역 : 15자 번역)\nJe t’aime (번역 : 9자 번역)\n사랑해 forever (번역 : 7자 번역)");
  assert.deepEqual([result.translated, result.untranslated, result.failure], [[5], [0], null]);
});

test("review ZIP translation has a total deadline and bounds requests by characters as well as segment count", async () => {
  const late = await translateLyricsForReviewDocuments([{ lyrics: "I love you" }], {
    translate: async () => new Promise(() => {}), timeoutMs: 5,
  });
  assert.deepEqual([late.lyrics, late.untranslated], [["I love you"], [1]]);
  assert.match(late.failure ?? "", /대기 시간/);
  // Beyond the per-pass budget the rest stays untranslated instead of failing the album.
  const huge = Array.from({ length: 20 }, (_, index) => `${String.fromCharCode(65 + index)} ${"lyric ".repeat(660)}`.trim());
  const budget = await translateLyricsForReviewDocuments([{ lyrics: huge.join("\n") }], { translate: async (batch) => batch.map(() => "번역") });
  assert.ok(budget.translated[0] > 0 && budget.untranslated[0] > 0);
  assert.match(budget.failure ?? "", /60,000자/);
  const longLine = "Long foreign lyric ".repeat(300);
  const calls: string[][] = [];
  const result = await translateLyricsForReviewDocuments([{ lyrics: `${longLine}\n${"Next lyric ".repeat(300)}` }], {
    translate: async (batch) => { calls.push(batch); return batch.map(() => "긴 가사 번역"); },
  });
  assert.ok(calls.length > 1);
  assert.ok(calls.every((batch) => batch.length <= 20 && batch.reduce((sum, value) => sum + value.length, 0) <= 4000));
  assert.ok(result.lyrics[0].startsWith(longLine.trimEnd()));
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

test("album translation overlaps at most two batches and keeps translations aligned", async () => {
  const sources = Array.from({ length: 41 }, (_, index) => `Song ${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + index % 26)}`);
  let active = 0;
  let peak = 0;
  const requests: string[][] = [];
  const release: Array<() => void> = [];
  const resultPromise = translateLyricsForReviewDocuments([{ lyrics: sources.join("\n") }], {
    translate: async (batch) => {
      requests.push(batch);
      peak = Math.max(peak, ++active);
      if (requests.length <= 2) await new Promise<void>((resolve) => release.push(resolve));
      active--;
      return batch.map((source) => `노래 ${sources.indexOf(source)}`);
    },
  });
  assert.equal(requests.length, 2, "the second batch starts before the first finishes");
  release.forEach((resolve) => resolve());
  const [result] = (await resultPromise).lyrics;
  assert.equal(peak, 2);
  assert.deepEqual(requests.map((batch) => batch.length), [20, 20, 1]);
  assert.equal(result, sources.map((source, index) => `${source} (번역 : 노래 ${index})`).join("\n"));
});

test("missing production translation configuration gives an actionable reason only after fallback fails", async (t) => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 429 }));
  t.mock.method(console, "error", () => {});
  try {
    const failed = await translateLyricsForReviewDocuments([{ lyrics: "Stay with me" }]);
    assert.deepEqual([failed.lyrics, failed.untranslated], [["Stay with me"], [1]]);
    assert.match(failed.failure ?? "", /OPENAI_API_KEY/);
    assert.doesNotMatch(failed.failure ?? "", /잠시 후/);
    t.mock.method(globalThis, "fetch", async () => Response.json([[["함께 있어줘"]]]));
    assert.deepEqual((await translateLyricsForReviewDocuments([{ lyrics: "Stay with me" }])).lyrics, ["Stay with me (번역 : 함께 있어줘)"]);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
