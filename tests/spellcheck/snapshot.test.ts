import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runSpellcheckPipeline } from "../../src/lib/spellcheck/engine";

test("spellcheck snapshot", async () => {
  const base = join(process.cwd(), "tests", "fixtures");
  const input = readFileSync(join(base, "spellcheck_long_input.txt"), "utf8");
  const expected = readFileSync(join(base, "spellcheck_long_expected.txt"), "utf8");

  const result = await runSpellcheckPipeline({
    text: input.trim(),
    mode: "balanced",
    domain: "music",
  });

  assert.equal(result.correctedText.trim(), expected.trim());
});
