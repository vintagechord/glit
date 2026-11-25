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
  assert.match(paymentBranch, /className="flex justify-center"/);
  assert.match(paymentBranch, /\{paymentActions\}/);
  assert.doesNotMatch(source, /결제 대기/);
  assert.doesNotMatch(source, /결제가 완료되지 않았습니다/);
  assert.doesNotMatch(source, /결제 후 심의가 진행됩니다/);
  assert.doesNotMatch(source, /입금 확인 후 방송국별 현황이 표시됩니다/);
});

test("the home panel directs cart items to payment and existing orders to order history", () => {
  assert.match(source, /\{!needsPayment \? \(/);
  assert.match(source, /activeSubmission\.current_order_id \? "주문 내역 보기" : "결제하기"/);
  assert.match(source, /activeSubmission\.current_order_id \? "orders" : "cart"/);
  assert.match(englishLanguagePackSource, /"결제하기": "Payment"/);
});

// 2026-11-25 (owner): two members re-created a whole application after closing
// the card window. The panel now continues that payment or opens the form,
// returning the unpaid order to the cart first.
test("a closed payment window continues the payment or opens the form from the home panel", () => {
  assert.match(source, /hasClosedPayment =\s*Boolean\(activeSubmission\?\.current_order_id\) && activeSubmission\?\.payment_status === "UNPAID"/);
  assert.match(source, /prepareOrderCheckout\(\{ orderId, guestTokensBySubmissionId: \{\}, localePrefix \}\)/);
  assert.match(source, /continueClosedOrder\("pay"\)/);
  assert.match(source, /continueClosedOrder\("edit"\)/);
  assert.match(source, /\/mypage\/cart\?edit=\$\{encodeURIComponent\(activeSubmission\.id\)\}/);
  assert.match(source, /"결제 이어하기"/);
  assert.match(englishLanguagePackSource, /"결제 이어하기": "Continue Payment"/);
});

test("the orders page and the cart open the application form of a closed payment", () => {
  const orders = readFileSync(new URL("../src/components/dashboard/submission-orders-client.tsx", import.meta.url), "utf8");
  const cart = readFileSync(new URL("../src/components/dashboard/submission-cart-checkout.tsx", import.meta.url), "utf8");
  assert.match(orders, /order\.status === "BANK_PENDING" \? "결제하기" : "결제 이어하기"/);
  assert.match(orders, /isAwaitingPayment\(order\) && item\.submissionId && <button[\s\S]{0,200}?returnToCheckout\(order, item\.submissionId/);
  assert.match(orders, /`\$\{cartHref\}\?edit=\$\{encodeURIComponent\(editSubmissionId\)\}`/);
  assert.match(cart, /searchParams\.get\("edit"\)/);
  assert.match(cart, /prepareEditStorage\(editTarget\);\s*router\.replace\(getEditHref\(editTarget\)\);/);
  assert.match(englishLanguagePackSource, /"신청서 수정": "Edit Application"/);
});
