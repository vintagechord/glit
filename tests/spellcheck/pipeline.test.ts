import test from "node:test";
import assert from "node:assert/strict";

import { runSpellcheckPipeline } from "../../src/lib/spellcheck/engine";

const applyDiffs = (diffs: Array<{ op: string; a: string; b: string }>) => {
  let output = "";
  diffs.forEach((diff) => {
    if (diff.op === "equal") {
      output += diff.a;
      return;
    }
    if (diff.op === "insert") {
      output += diff.b;
      return;
    }
    if (diff.op === "replace") {
      output += diff.b;
      return;
    }
    if (diff.op === "delete") {
      return;
    }
  });
  return output;
};

test("spellcheck returns suggestions and corrected text", async () => {
  const text = "그낭 걸엇어. 오늘은 정말로 햇다. 이건 할수있어야 되요.";
  const result = await runSpellcheckPipeline({
    text,
    mode: "balanced",
    domain: "music",
  });

  assert.ok(result.suggestions.length > 0, "expected suggestions");
  assert.notEqual(result.correctedText, text);
  assert.ok(!result.meta.reasonIfEmpty, "reasonIfEmpty should be empty when suggestions exist");
});

test("spellcheck returns reason when empty", async () => {
  const text = "오늘 날씨가 좋다.";
  const result = await runSpellcheckPipeline({
    text,
    mode: "fast",
    domain: "general",
  });

  assert.equal(result.correctedText, text);
  assert.equal(result.suggestions.length, 0);
  assert.ok(result.meta.reasonIfEmpty, "reasonIfEmpty should be set");
});

test("spellcheck fixes 들어가/갔다 계열 복합 오타", async () => {
  const text = "나는 가방에 드러갓어.";
  const result = await runSpellcheckPipeline({
    text,
    mode: "balanced",
    domain: "general",
  });

  assert.equal(result.correctedText, "나는 가방에 들어갔어.");
  assert.ok(result.suggestions.length > 0, "expected suggestions");
  assert.equal(result.meta.reasonIfEmpty, undefined);
});

test("diffs can reconstruct corrected text", async () => {
  const text = "그낭 걸엇어. 오늘은 정말로 햇다.";
  const result = await runSpellcheckPipeline({
    text,
    mode: "balanced",
    domain: "general",
  });

  const rebuilt = applyDiffs(result.diffs);
  assert.equal(rebuilt, result.correctedText);
});
