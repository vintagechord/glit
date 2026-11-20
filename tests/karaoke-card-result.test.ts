import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// On PC the Inicis result page runs inside the payment layer's iframe and only
// posts INICIS:* to this page; it never navigates the page itself. The karaoke
// form did not remove the layer, so "결제 결과를 전달하는 중입니다" stayed over a
// form that still asked to complete payment, inviting a second payment.

const source = readFileSync(new URL("../src/features/karaoke/karaoke-form.tsx", import.meta.url), "utf8");
const handler = source.slice(source.indexOf("const handler = (event: MessageEvent)"), source.indexOf('window.addEventListener("message", handler)'));

test("every Inicis result removes the payment layer before anything else", () => {
  assert.match(source, /import \{[^}]*\bcleanupInicisPaymentLayer\b[^}]*\} from "@\/lib\/inicis\/popup";/);
  assert.match(handler, /if \(!type \|\| !String\(type\)\.startsWith\("INICIS:"\)\) return;\s*cleanupInicisPaymentLayer\(\);/);
});

test("a successful card payment clears the form and says so", () => {
  const success = handler.slice(handler.indexOf('if (status === "SUCCESS")'));
  assert.match(success, /pendingCardRequest\.current = null;\s*resetForm\(\);\s*setNotice\(\{ message: "결제가 완료되었습니다\. 진행상황 탭에서 접수 내역을 확인할 수 있습니다\." \}\);/);
});

test("the bank transfer path and the card success path share one reset", () => {
  assert.equal(source.match(/resetForm\(\);/g)?.length, 2);
  assert.equal(source.match(/setTitle\(""\)/g)?.length, 1);
});
