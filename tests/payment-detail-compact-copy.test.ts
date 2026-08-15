import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("payment choice uses controls instead of repeating their meaning", () => {
  const page = read("src/app/dashboard/pay/[id]/page.tsx");
  const methodChoice = read(
    "src/app/dashboard/pay/[id]/payment-method-choice-client.tsx",
  );

  assert.doesNotMatch(page, /paymentStatusLabelMap|최근 선택 방식/);
  assert.doesNotMatch(
    methodChoice,
    /계좌 안내를 확인하고|KG이니시스 결제 모듈에서|카드 결제하기를 누르면|무통장 입금으로 선택되었습니다/,
  );
  assert.match(methodChoice, />\s*입금 계좌\s*</);
  assert.match(methodChoice, /<PaymentRetryClient/);
  assert.match(methodChoice, /aria-pressed=\{selectedMethod === "BANK"\}/);
  assert.match(methodChoice, /aria-pressed=\{selectedMethod === "CARD"\}/);
});

test("payment retry keeps one short result and one action", () => {
  const source = read(
    "src/app/dashboard/pay/[id]/payment-retry-client.tsx",
  );

  assert.doesNotMatch(
    source,
    /savedDraftNotice|다시 작성하지 않아도|접수 내용은 결제 대기 상태/,
  );
  assert.match(source, /결제가 취소되었습니다\./);
  assert.match(source, /결제에 실패했습니다\./);
  assert.match(source, /결제 준비 중/);
});

test("submission detail hides future progress until payment is complete", () => {
  const source = read(
    "src/features/submissions/submission-detail-client.tsx",
  );
  const visibleStatus = source.slice(
    source.indexOf("<h2 className=\"mt-2 text-2xl"),
    source.indexOf("{/* 관리자용 등급/필증 편집 UI"),
  );

  assert.doesNotMatch(visibleStatus, /displayStatus\.primaryMessage/);
  assert.doesNotMatch(source, /결제 완료 후 방송국 진행 정보/);
  assert.doesNotMatch(source, /\{step\.value\}/);
  assert.match(source, /!isMvSubmission && isPaymentDone/);
  assert.match(source, /\{isPaymentDone \? \(/);
});

test("compact payment actions have exact English labels", () => {
  const source = read("src/components/i18n/english-language-pack.tsx");

  for (const mapping of [
    '"수정하기": "Edit"',
    '"장바구니에 담기": "Add to Cart"',
    '"담고 결제하기": "Add and Pay"',
    '"신청서를 장바구니에 담았습니다.": "Application Added to Cart."',
    '"기본 신청 비용": "Base Fee"',
    '"로그인이 필요합니다.": "Login Required."',
    '"발행 요청": "Request Publication"',
    '"결제가 취소되었습니다.": "Payment was canceled."',
    '"결제에 실패했습니다.": "Payment failed."',
    '"결제가 완료되었습니다.": "Payment completed."',
    '"결제가 완료되지 않았습니다.": "Payment was not completed."',
    '"진행 정보 준비 중": "Preparing Progress Details"',
  ]) {
    assert.ok(source.includes(mapping), `missing locale mapping: ${mapping}`);
  }
});
