import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/features/home/home-review-panel.tsx", import.meta.url),
  "utf8",
);

test("the compact home panel shows only the essential payment label", () => {
  const compactBranch = source.match(
    /isCompactPaymentState \? \(([\s\S]*?)\) : \(\s*<div className=\{progressBodyClass\}>/,
  )?.[1];

  assert.ok(compactBranch, "compact payment branch must exist");
  assert.match(compactBranch, />결제 대기</);
  assert.doesNotMatch(compactBranch, /결제가 완료되지 않았습니다/);
  assert.doesNotMatch(compactBranch, /결제 후 심의가 진행됩니다/);
});

test("the detailed status panel keeps the full payment guidance", () => {
  assert.match(source, /결제가 완료되지 않았습니다/);
  assert.match(source, /결제 후 심의가 진행됩니다/);
});
