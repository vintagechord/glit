import assert from "node:assert/strict";
import test from "node:test";

import { findForeignLyricsSpans, translateSpelledOutLetters } from "../src/lib/foreign-lyrics";

test("spelled-letter fallback reads the reported name without inferring its identity", () => {
  assert.equal(translateSpelledOutLetters("J-E-O-N-G-S-I-K"), "제이 이 오 엔 지 에스 아이 케이");
  assert.equal(translateSpelledOutLetters("  J ‑ E ‑ O ‑ N ‑ G ‑ S ‑ I ‑ K!  "), "제이 이 오 엔 지 에스 아이 케이!");
  assert.equal(translateSpelledOutLetters("I-L-O-V-E-Y-O-U"), "아이 엘 오 브이 이 와이 오 유");
  assert.equal(findForeignLyricsSpans("I-L-O-V-E-Y-O-U").length, 1, "spelled sentences still require translation");
});

test("spelled-letter fallback never guesses ordinary words, acronyms, or clauses", () => {
  for (const source of [
    "DND", "I LOVE YOU", "Long-term", "J-E-O-N-G-S-I-K is here", "j-e-o-n-g-s-i-k",
    "J-E-O-N-G-S-I-K가", "A-1-B", "A-B", "A--B-C", "A-B-C\nD-E-F", "",
  ]) {
    assert.equal(translateSpelledOutLetters(source), null, source);
  }
});

test("elongated and hyphenated adlibs are exempt while meaningful clauses retain their source offsets", () => {
  const lyrics = "Wooh\nWoooooh!\nOh-oh, yeah!\nAhhh\nOoh—woah!\nWooh I’m officially\nAh love you\nDND\nI-L-O-V-E-Y-O-U";
  const spans = findForeignLyricsSpans(lyrics);
  assert.deepEqual(spans.map((span) => span.source), ["Wooh I’m officially", "Ah love you", "DND", "I-L-O-V-E-Y-O-U"]);
  for (const span of spans) assert.equal(lyrics.slice(span.start, span.end), span.source);
});
