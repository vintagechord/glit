import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("dashboard summaries use the payment action instead of repeated payment labels", () => {
  const statusList = readSource(
    "src/components/dashboard/submission-status-list.tsx",
  );
  const historyList = readSource("src/components/dashboard/history-list.tsx");

  for (const source of [statusList, historyList]) {
    assert.match(
      source,
      /const hasPaymentAction = submission\.payment(?:_status|Status) !== "PAID"/,
    );
    assert.match(source, /\{!hasPaymentAction \? \(/);
  }

  assert.match(statusList, /\{hasPaymentAction && \(/);
  assert.match(historyList, /\{hasPaymentAction \? \(/);
  assert.doesNotMatch(statusList, /const paymentLabels/);
  assert.doesNotMatch(statusList, /입금 확인 대기/);
  assert.match(
    historyList,
    /getPaymentStatus\(activeSubmission\.paymentStatus\)/,
    "the detail dialog should keep explicit payment information",
  );
});

test("draft and cart rows keep type and action without payment-waiting chips", () => {
  const drafts = readSource(
    "src/components/dashboard/draft-submission-list.tsx",
  );
  const cart = readSource(
    "src/components/dashboard/submission-cart-checkout.tsx",
  );

  assert.doesNotMatch(drafts, /draftStatusMap|getDraftStatusInfo/);
  assert.match(drafts, /shouldOpenPayment \? "결제하기" : "이어쓰기"/);
  assert.doesNotMatch(cart, />\s*결제 대기\s*</);
  assert.doesNotMatch(cart, /\{items\.length\}건 대기/);
  assert.match(cart, /\{items\.length\}건/);
  assert.match(cart, /aria-label=\{`\$\{getDisplayTitle\(item\)\} 수정`\}/);
});

test("paid-only history views describe review progress, not payment progress", () => {
  const history = readSource("src/components/dashboard/artist-history.tsx");
  const artistDetail = readSource("src/app/dashboard/artists/[id]/page.tsx");

  assert.doesNotMatch(history, /결제 대기|결제 확인/);
  assert.match(history, /return "심의 진행"/);
  assert.match(history, /return "접수 완료"/);
  assert.match(artistDetail, /WAITING_PAYMENT: "접수 완료"/);
});
