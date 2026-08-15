import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/features/home/home-review-panel.tsx", import.meta.url),
  "utf8",
);
const englishLanguagePackSource = readFileSync(
  new URL("../src/components/i18n/english-language-pack.tsx", import.meta.url),
  "utf8",
);

test("the home payment state relies on actions instead of repeated status copy", () => {
  const paymentBranch = source.match(
    /activeSubmission \? \(\s*needsPayment \? \(([\s\S]*?)\) : \(\s*<div className=\{progressBodyClass\}>/,
  )?.[1];

  assert.ok(paymentBranch, "payment action branch must exist");
  assert.match(paymentBranch, /\{paymentActions\}/);
  assert.doesNotMatch(source, /결제 대기/);
  assert.doesNotMatch(source, /결제가 완료되지 않았습니다/);
  assert.doesNotMatch(source, /결제 후 심의가 진행됩니다/);
  assert.doesNotMatch(source, /입금 확인 후 방송국별 현황이 표시됩니다/);
});

test("the home panel hides review progress until payment without changing the CTA", () => {
  assert.match(source, /\{!needsPayment \? \(/);
  assert.match(source, />\s*결제하기\s*/);
  assert.match(englishLanguagePackSource, /"결제하기": "Payment"/);
});
