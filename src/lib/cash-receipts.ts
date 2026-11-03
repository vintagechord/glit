/**
 * Cash receipts (현금영수증) for bank-transfer orders. Shared by the checkout,
 * order list, admin pages and PDF so validation and wording stay identical.
 */
export type CashReceiptPurpose = "INCOME_DEDUCTION" | "EXPENSE_PROOF";
/** UNCERTAIN: Inicis may have issued it (no readable reply); only an
 * administrator who checked the Inicis console may settle it. */
export type CashReceiptStatus = "REQUESTED" | "ISSUING" | "ISSUED" | "FAILED" | "CANCELED" | "UNCERTAIN";
export type CashReceiptIssueMethod = "INICIS" | "MANUAL";

export type CashReceiptRequestInput = { purpose: CashReceiptPurpose; identifier: string };

/** What the customer's browser may see: the identifier is always masked. */
export type CashReceiptSummary = {
  purpose: CashReceiptPurpose;
  identifierMasked: string;
  status: CashReceiptStatus;
  approvalNumber: string | null;
  issuedAt: string | null;
  amountKrw: number | null;
  supplyKrw: number | null;
  vatKrw: number | null;
  requestedAt: string;
  canEdit: boolean;
};

export const CASH_RECEIPT_PURPOSE_LABELS: Record<CashReceiptPurpose, string> = {
  INCOME_DEDUCTION: "개인 소득공제용",
  EXPENSE_PROOF: "사업자 지출증빙용",
};

export const CASH_RECEIPT_STATUS_LABELS: Record<CashReceiptStatus, string> = {
  REQUESTED: "발급 대기",
  ISSUING: "발급 처리 중",
  ISSUED: "발급 완료",
  FAILED: "발급 확인 필요",
  CANCELED: "발급 취소",
  UNCERTAIN: "발급 확인 중",
};

export const CASH_RECEIPT_IDENTIFIER_HINT: Record<CashReceiptPurpose, string> = {
  INCOME_DEDUCTION: "휴대폰 번호 또는 현금영수증 카드 번호",
  EXPENSE_PROOF: "사업자등록번호 10자리",
};

/** Customers may change or withdraw a request until it is being issued.
 * FAILED is a definite rejection; an unknown result (UNCERTAIN) is not. */
export const isCashReceiptEditable = (status: CashReceiptStatus | null | undefined) =>
  !status || status === "REQUESTED" || status === "FAILED" || status === "CANCELED";

/** The Inicis request behind ISSUING times out after 20 seconds. A claim this
 * old belongs to a process that died, so its outcome is unknown. */
export const CASH_RECEIPT_ISSUING_STALE_MS = 5 * 60_000;

/** Issuance may or may not have reached the National Tax Service. */
export const isCashReceiptResultUnknown = (
  receipt: { status: CashReceiptStatus; updated_at: string },
  now = Date.now(),
) => receipt.status === "UNCERTAIN" || (receipt.status === "ISSUING" &&
  now - new Date(receipt.updated_at).getTime() > CASH_RECEIPT_ISSUING_STALE_MS);

export type CashReceiptAttention = "ISSUE" | "VERIFY" | "CANCEL_IN_HOMETAX";

export const CASH_RECEIPT_ATTENTION_LABELS: Record<CashReceiptAttention, string> = {
  ISSUE: "발급 필요",
  VERIFY: "결과 확인 필요",
  CANCEL_IN_HOMETAX: "홈택스 취소 필요",
};

/** Why an administrator must act on a receipt, or null. A receipt issued for
 * an order whose money went back (refund, cancellation) must be cancelled in
 * Hometax; an unknown Inicis result must be checked before anything else. */
export function cashReceiptAttention(
  receipt: { status: CashReceiptStatus; updated_at: string },
  orderStatus: string | null | undefined,
  now = Date.now(),
): CashReceiptAttention | null {
  if (isCashReceiptResultUnknown(receipt, now)) return "VERIFY";
  if (receipt.status === "ISSUED" && orderStatus !== "PAID") return "CANCEL_IN_HOMETAX";
  if ((receipt.status === "REQUESTED" || receipt.status === "FAILED") && orderStatus === "PAID") return "ISSUE";
  return null;
}

/** A receipt PDF for money that was returned would look valid; customers get
 * it again once the cancellation is recorded (it then prints as cancelled). */
export const isCashReceiptPdfWithheld = (orderStatus: string | null | undefined, receiptStatus: CashReceiptStatus) =>
  receiptStatus === "ISSUED" && orderStatus !== "PAID";

export const normalizeCashReceiptIdentifier = (value: string) => value.replace(/[\s-]/g, "");

const isMobileNumber = (digits: string) => /^01[016789][0-9]{7,8}$/.test(digits);
const isCashReceiptCardNumber = (digits: string) => /^[0-9]{13,19}$/.test(digits);

/** Korean business registration number check digit (국세청 검증식). */
export const isValidBusinessNumber = (digits: string) => {
  if (!/^[0-9]{10}$/.test(digits)) return false;
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let index = 0; index < 9; index += 1) sum += Number(digits[index]) * weights[index];
  sum += Math.floor((Number(digits[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(digits[9]);
};

export function validateCashReceiptRequest(input: { purpose?: unknown; identifier?: unknown }):
  | { ok: true; value: CashReceiptRequestInput }
  | { ok: false; error: string } {
  const purpose = input.purpose;
  if (purpose !== "INCOME_DEDUCTION" && purpose !== "EXPENSE_PROOF") {
    return { ok: false, error: "현금영수증 용도를 선택해주세요." };
  }
  const identifier = typeof input.identifier === "string" ? normalizeCashReceiptIdentifier(input.identifier) : "";
  if (!identifier) return { ok: false, error: `${CASH_RECEIPT_IDENTIFIER_HINT[purpose]}를 입력해주세요.` };
  if (!/^[0-9]+$/.test(identifier)) return { ok: false, error: "현금영수증 발급 번호는 숫자만 입력해주세요." };
  if (purpose === "INCOME_DEDUCTION" && !isMobileNumber(identifier) && !isCashReceiptCardNumber(identifier)) {
    return { ok: false, error: "휴대폰 번호(010으로 시작) 또는 현금영수증 카드 번호를 확인해주세요." };
  }
  if (purpose === "EXPENSE_PROOF" && !isValidBusinessNumber(identifier) && !isCashReceiptCardNumber(identifier)) {
    return { ok: false, error: "사업자등록번호 10자리를 확인해주세요." };
  }
  return { ok: true, value: { purpose, identifier } };
}

export function formatCashReceiptIdentifier(digits: string) {
  if (/^[0-9]{10}$/.test(digits) && !digits.startsWith("01")) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }
  if (/^01[0-9]{8,9}$/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, digits.length - 4)}-${digits.slice(-4)}`;
  }
  return digits.replace(/(.{4})(?=.)/g, "$1-");
}

/** Keeps the first three and last four digits, e.g. 010-****-5678. */
export function maskCashReceiptIdentifier(digits: string) {
  const formatted = formatCashReceiptIdentifier(digits);
  let seen = 0;
  const total = digits.length;
  return formatted.replace(/[0-9]/g, (digit) => {
    seen += 1;
    return seen <= 3 || seen > total - 4 ? digit : "*";
  });
}

/** Prices are VAT-inclusive (일반과세). 공급가액 = 합계 ÷ 1.1, 부가세 = 나머지. */
export function splitVatInclusiveAmount(totalKrw: number) {
  const total = Math.max(0, Math.round(totalKrw));
  const supply = Math.round(total / 1.1);
  return { totalKrw: total, supplyKrw: supply, vatKrw: total - supply };
}
