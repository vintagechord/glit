import assert from "node:assert/strict";
import test from "node:test";
import {
  customerProgressNotice,
  reviewScheduleSentences,
  stageChangeNotice,
} from "../src/lib/customer-progress-notice";

// 2026-11-25 (owner): progress mails are titled by their stage, and the review
// timing (접수 2~3 business days; 공중파 ~1 week, other stations 1~3 weeks)
// reaches the customer once the payment is confirmed.

const paid = { currentPaymentStatus: "PAID", nextPaymentStatus: "PAID" };

test("moving a paid application into review mails its stage, in the customer's words", () => {
  const album = stageChangeNotice({ type: "ALBUM", currentStatus: "PRE_REVIEW", nextStatus: "IN_PROGRESS", ...paid, title: "Hug" });
  assert.equal(album?.subject, "[onside] 방송국 접수 시작 안내 — Hug");
  assert.equal(album?.headline, "방송국 심의 접수를 시작했습니다.");
  assert.match(album?.summary ?? "", /공중파\(KBS·MBC·SBS\)는 약 1주, 그 밖의 방송국은 1~3주/);
  assert.doesNotMatch(JSON.stringify(album), /운영 단계|심의진행/);

  const online = stageChangeNotice({ type: "MV_DISTRIBUTION", currentStatus: "PRE_REVIEW", nextStatus: "IN_PROGRESS", ...paid, title: "Video" });
  assert.equal(online?.subject, "[onside] 심의 접수 시작 안내 — Video");
  assert.doesNotMatch(online?.summary ?? "", /방송국|공중파/);
});

test("other stage saves mail nothing", () => {
  const cases = [
    { currentStatus: "IN_PROGRESS", nextStatus: "IN_PROGRESS", ...paid },
    { currentStatus: "IN_PROGRESS", nextStatus: "PRE_REVIEW", ...paid },
    { currentStatus: "PRE_REVIEW", nextStatus: "PRE_REVIEW", ...paid },
    { currentStatus: "IN_PROGRESS", nextStatus: "RESULT_READY", ...paid },
    // Payment confirmations and refunds have their own mails.
    { currentStatus: "SUBMITTED", nextStatus: "IN_PROGRESS", currentPaymentStatus: "PAYMENT_PENDING", nextPaymentStatus: "PAID" },
    { currentStatus: "PRE_REVIEW", nextStatus: "IN_PROGRESS", currentPaymentStatus: "PAID", nextPaymentStatus: "REFUNDED" },
    { currentStatus: "IN_PROGRESS", nextStatus: "SUBMITTED", currentPaymentStatus: "PAID", nextPaymentStatus: "PAYMENT_PENDING" },
  ];
  for (const input of cases) assert.equal(stageChangeNotice({ type: "ALBUM", ...input }), null, JSON.stringify(input));
});

test("the progress resend names the stage the application stands on", () => {
  const notice = (status: string, paymentStatus: string, type = "ALBUM") =>
    customerProgressNotice({ type, status, paymentStatus, title: "Hug" });
  assert.equal(notice("WAITING_PAYMENT", "UNPAID")?.subject, "[onside] 결제 대기 안내 — Hug");
  assert.equal(notice("PRE_REVIEW", "PAID")?.subject, "[onside] 심의 접수 준비 안내 — Hug");
  assert.match(notice("PRE_REVIEW", "PAID")?.summary ?? "", /영업일 기준 2~3일 이내/);
  assert.equal(notice("IN_PROGRESS", "PAID")?.subject, "[onside] 방송국 접수 시작 안내 — Hug");
  assert.equal(notice("RESULT_READY", "PAID")?.subject, "[onside] 심의 결과 안내 — Hug");
  assert.equal(notice("COMPLETED", "PAID", "MV_DISTRIBUTION")?.summary, "진행상황 바로 보기에서 심의 결과를 확인해주세요.");
  assert.equal(notice("DRAFT", "UNPAID"), null);
  assert.equal(notice("IN_PROGRESS", "REFUNDED"), null);
});

test("a subject without a title, or with control characters, stays one clean line", () => {
  assert.equal(customerProgressNotice({ type: "ALBUM", status: "IN_PROGRESS", paymentStatus: "PAID", title: "  " })?.subject, "[onside] 방송국 접수 시작 안내");
  assert.equal(customerProgressNotice({ type: "ALBUM", status: "IN_PROGRESS", paymentStatus: "PAID", title: "A\nB" })?.subject, "[onside] 방송국 접수 시작 안내 — A B");
});

test("the schedule sentences leave the station result times out of an online MV", () => {
  assert.equal(reviewScheduleSentences("ALBUM").length, 2);
  assert.equal(reviewScheduleSentences("MV_BROADCAST").length, 2);
  assert.deepEqual(reviewScheduleSentences("MV_DISTRIBUTION"), ["접수는 결제 확인 후 영업일 기준 2~3일 이내 진행됩니다."]);
});
