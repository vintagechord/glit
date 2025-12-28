import test from "node:test";
import assert from "node:assert/strict";

import { evaluate, normalize } from "../src/lib/profanity/engine";
import { runProfanityCheck } from "../src/lib/profanity/check";
import { buildLegacyProfanityMatchers } from "../src/lib/profanity/legacy";

test("normalize applies leet replacements and repeat compression", () => {
  const input = "fuuuuuck!!!";
  const output = normalize(input);
  assert.equal(output, "fuuck");
});

test("allowlist prevents false positives for known safe terms", () => {
  const safeKorean = "시발점부터 다시 시작합니다";
  const safeFinger = "새끼손가락을 다쳤어요";

  assert.equal(evaluate(safeKorean).action, "allow");
  assert.equal(evaluate(safeFinger).action, "allow");
});

test("detects evasion patterns across symbols, spacing, leet, and jamo", () => {
  const evasions = [
    "씨발",
    "시발",
    "ㅆㅣㅂㅏㄹ",
    "ㅅ ㅣ ㅂ ㅏ ㄹ",
    "ㅅ.ㅣ*ㅂ-ㅏ/ㄹ",
    "ㅅㅂ",
    "ㅅ ㅂ",
    "ㅆ ㅂ",
    "병신",
    "ㅂ ㅕ ㅇ ㅅ ㅣ ㄴ",
    "지랄",
    "ㅈ ㅣ ㄹ ㅏ ㄹ",
    "개새끼",
    "개 새 끼",
    "새끼",
    "존나",
    "존ㄴㅏ",
    "좆",
    "ㅈ ㅗ ㅈ",
    "fuck",
    "f u c k",
    "fuuuuuck",
    "f*uck",
    "f.u.c.k",
    "sh1t",
    "s h i t",
    "s#h!t",
    "b1tch",
    "b i t c h",
    "damn",
    "d a m n",
  ];

  evasions.forEach((input) => {
    const result = evaluate(input);
    assert.notEqual(
      result.action,
      "allow",
      `expected match for: ${input}`,
    );
  });
});

test("flag off preserves legacy detection results", () => {
  const matchers = buildLegacyProfanityMatchers();
  const samples = ["hello world", "this is fuck", "ㅅㅂ", "clean song"];

  samples.forEach((text) => {
    const v1HasProfanity = matchers?.testPattern
      ? matchers.testPattern.test(text)
      : false;
    const outcome = runProfanityCheck(text, {
      v1HasProfanity,
      enableV2: false,
    });
    assert.equal(outcome.hasProfanity, v1HasProfanity);
  });
});
