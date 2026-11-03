import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const bridge = read("../src/app/(pay-popup)/pay/inicis/return/page.tsx");
const popup = read("../src/app/(pay-popup)/pay/inicis/popup/client-page.tsx");
const orders = read("../src/components/dashboard/submission-orders-client.tsx");
const receiptPanel = read("../src/components/dashboard/order-cash-receipt-panel.tsx");

test("the payment bridge carries a distinct CHECKING outcome with do-not-pay-again guidance and a support contact", () => {
  assert.match(bridge, /upper === "CHECKING"/);
  assert.match(bridge, /"결제 확인 중입니다\. 다시 결제하지 마세요\."/);
  assert.match(bridge, /APP_CONFIG\.supportPhone[\s\S]*APP_CONFIG\.supportEmail/);
  // Checkout pages that ignore the new message still land on the order list.
  assert.match(bridge, /if \(status === "CHECKING"\) \{[\s\S]*buildRedirectTarget\(\)[\s\S]*location\.replace\(target\)/);
  assert.match(bridge, /&payment=\$\{statusParam\}/);
  assert.match(popup, /"INICIS:CHECKING"/);
});

test("orders awaiting approval reconciliation tell the customer not to pay again", () => {
  assert.match(orders, /REVIEW_REQUIRED: "결제 확인 중"/);
  assert.match(orders, /order\.status === "REVIEW_REQUIRED" \|\| Boolean\(order\.paymentChecking\)/);
  assert.match(orders, /결제 확인 중입니다\. 다시 결제하지 마세요\./);
  assert.match(orders, /APP_CONFIG\.supportPhone[\s\S]*APP_CONFIG\.supportEmail/);
  assert.match(orders, /params\.get\("payment"\) === "checking" && <PaymentCheckingNotice/);
  assert.match(orders, /isPaymentChecking\(order\) \? <PaymentCheckingNotice/);
});

test("signed-in customers send this browser's guest proofs so guest orders stay reachable", () => {
  assert.match(orders, /const memberOnly = Boolean\(userId\) && entries\.length === 0;/);
  assert.match(orders, /readGuestSubmissionOrderEntries\(\)\.length > 0 \|\|/);
  assert.match(orders, /userId && !order\.guestOrder \? `\$\{prefix\}\/mypage\/submissions/);
  assert.match(orders, /guestTokens=\{userId && !order\.guestOrder \? \{\} : guestTokens\}/);
});

test("the customer receipt panel withholds a refunded order's receipt and explains an unconfirmed issuance", () => {
  assert.match(receiptPanel, /const withheld = receipt \? isCashReceiptPdfWithheld\(order\.status, receipt\.status\) : false;/);
  assert.match(receiptPanel, /const issued = !withheld &&/);
  assert.match(receiptPanel, /receipt\?\.status === "UNCERTAIN"/);
});
