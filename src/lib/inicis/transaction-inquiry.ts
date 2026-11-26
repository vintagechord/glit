import { getCashReceiptInicisConfig, type CashReceiptInicisConfig } from "./cash-receipt";
import { getInicisTimestamp, sha512 } from "./crypto";

/**
 * KG Inicis "거래조회" (INIAPI v2 `/v2/pg/inquiry`, type `inquiry`): the status
 * of one transaction by TID, signed with the merchant's INIAPI key — the same
 * key the cash receipts use. https://manual.inicis.com/pay/etc-inquiry.html
 *
 * Used before an administrator's "승인됨" decision on an uncertain card
 * approval is recorded, so a typed TID is never taken on trust.
 */
export type InicisTransactionStatus = "APPROVED" | "CANCELED" | "PARTIAL_CANCELED" | "NOT_FOUND" | "OTHER";

export type InicisTransaction = {
  tid: string;
  oid: string;
  mid: string | null;
  priceKrw: number | null;
  status: InicisTransactionStatus;
  rawStatus: string;
  payMethod: string | null;
  approvedNumber: string | null;
  approvedAt: string | null;
};

export type InicisInquiryResult =
  | { ok: true; transaction: InicisTransaction }
  | { ok: false; code: string; message: string };

const TID_PATTERN = /^[A-Za-z0-9_-]{5,64}$/;

export function buildInicisInquiryRequest(
  config: Pick<CashReceiptInicisConfig, "mid" | "apiKey">,
  tid: string,
  timestamp = getInicisTimestamp(),
  clientIp = "127.0.0.1",
) {
  const type = "inquiry";
  const data = { tid };
  // Verified against stginiapi: the hash covers the compact JSON of data.
  const hashData = sha512(config.apiKey + config.mid + type + timestamp + JSON.stringify(data));
  return { mid: config.mid, type, timestamp, clientIp, hashData, data };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const pick = (sources: Array<Record<string, unknown> | undefined>, keys: string[]) => {
  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
  }
  return "";
};

// V2 transactionStatus; the V1 status codes ("0" 승인, "1" 취소, "9" 거래없음) map the same way.
const statusOf = (raw: string): InicisTransactionStatus => {
  if (raw === "APPROVAL" || raw === "0") return "APPROVED";
  if (raw === "CANCEL" || raw === "1") return "CANCELED";
  if (raw === "PART_CANCEL") return "PARTIAL_CANCELED";
  if (raw === "9") return "NOT_FOUND";
  return "OTHER";
};

/** Inicis returns YYYYMMDD + hhmmss in KST. */
const kstIso = (date: string, time: string) => {
  if (!/^[0-9]{8}$/.test(date)) return null;
  const clock = /^[0-9]{6}$/.test(time) ? `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}` : "00:00:00";
  const parsed = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${clock}+09:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export function parseInicisInquiryResponse(json: unknown): InicisInquiryResult {
  if (!isRecord(json)) return { ok: false, code: "UNREADABLE", message: "이니시스 거래 조회 응답을 해석하지 못했습니다. 잠시 후 다시 시도해주세요." };
  const nested = isRecord(json.data) ? json.data : undefined;
  const resultCode = pick([json, nested], ["resultCode"]);
  const resultMsg = pick([json, nested], ["resultMsg"]);
  if (resultCode === "FAIL" && /NOT_FOUND/i.test(resultMsg)) {
    return { ok: false, code: "NOT_FOUND", message: "이니시스에 이 TID의 거래가 없습니다. TID를 다시 확인해주세요." };
  }
  if (resultCode === "ER0400") {
    return { ok: false, code: "INIAPI_KEY_MISMATCH", message: "이니시스 INIAPI 키가 맞지 않아 거래를 조회하지 못했습니다. 키 설정을 확인해주세요." };
  }
  // "SUCCESS" is the documented V2 value; "00"/"0000" are the other INIAPI success codes.
  if (!["SUCCESS", "00", "0000"].includes(resultCode)) {
    return {
      ok: false,
      code: resultCode || "UNREADABLE",
      message: `이니시스 거래 조회에 실패했습니다${resultMsg ? `: ${resultMsg}` : ""}`.slice(0, 300),
    };
  }
  const cardInfo = [json.cardInfo, nested?.cardInfo].find(isRecord);
  const sources = [json, nested];
  const tid = pick(sources, ["tid"]);
  const oid = pick(sources, ["oid", "MOID", "moid"]);
  const rawPrice = pick(sources, ["price", "TotPrice"]);
  const rawStatus = pick(sources, ["transactionStatus", "status"]);
  if (!tid || !oid || !rawStatus || !/^[0-9]{1,12}$/.test(rawPrice)) {
    return { ok: false, code: "UNREADABLE", message: "이니시스 응답에서 거래 정보(TID·주문번호·금액·상태)를 읽지 못했습니다. 이니시스 관리자에서 확인해주세요." };
  }
  return {
    ok: true,
    transaction: {
      tid,
      oid,
      mid: pick(sources, ["mid"]) || null,
      priceKrw: Number(rawPrice),
      status: statusOf(rawStatus),
      rawStatus,
      payMethod: pick(sources, ["paymethod", "payMethod"]) || null,
      approvedNumber: pick([cardInfo, json, nested], ["approvedNumber", "applNum"]) || null,
      approvedAt: kstIso(pick(sources, ["approvedDate", "applDate"]), pick(sources, ["approvedTime", "applTime"])),
    },
  };
}

/** Null when Inicis shows this exact attempt approved and not cancelled. */
export function verifyInicisApprovalForOrder(
  transaction: InicisTransaction,
  expected: { tid: string; orderId: string; amountKrw: number },
): string | null {
  if (transaction.tid !== expected.tid) return "이니시스가 돌려준 거래의 TID가 입력한 TID와 다릅니다.";
  if (transaction.oid !== expected.orderId) {
    return `이 TID는 다른 주문번호(${transaction.oid})의 거래입니다. 이 주문의 승인 TID를 확인해주세요.`;
  }
  if (transaction.status === "CANCELED") return "이니시스에서 취소된 거래입니다. 승인으로 처리할 수 없습니다.";
  if (transaction.status === "PARTIAL_CANCELED") return "이니시스에서 부분취소된 거래입니다. 승인으로 처리할 수 없습니다.";
  if (transaction.status !== "APPROVED") return `이니시스 거래가 승인 상태가 아닙니다(${transaction.rawStatus}).`;
  if (transaction.priceKrw !== expected.amountKrw) {
    return `이니시스 승인 금액(${transaction.priceKrw ?? "?"}원)이 주문 금액(${expected.amountKrw}원)과 다릅니다.`;
  }
  return null;
}

/** What Inicis answered, kept on the payment attempt and checked again by the database. */
export function inicisApprovalEvidence(transaction: InicisTransaction, checkedAt = new Date()) {
  return {
    source: "INIAPI_V2_INQUIRY" as const,
    tid: transaction.tid,
    oid: transaction.oid,
    mid: transaction.mid,
    priceKrw: transaction.priceKrw,
    status: transaction.status,
    transactionStatus: transaction.rawStatus,
    payMethod: transaction.payMethod,
    approvedNumber: transaction.approvedNumber,
    approvedAt: transaction.approvedAt,
    checkedAt: checkedAt.toISOString(),
  };
}

export async function inquireInicisTransaction(
  tid: string,
  options: { config?: CashReceiptInicisConfig | null; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<InicisInquiryResult> {
  if (!TID_PATTERN.test(tid)) return { ok: false, code: "INVALID_TID", message: "이니시스 승인 TID를 정확히 입력해주세요." };
  const config = options.config === undefined ? getCashReceiptInicisConfig() : options.config;
  if (!config) {
    return { ok: false, code: "NOT_CONFIGURED", message: "이니시스 INIAPI 키가 등록되지 않아 거래를 조회할 수 없습니다." };
  }
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${config.apiUrl}/v2/pg/inquiry`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify(buildInicisInquiryRequest(config, tid)),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch {
    return { ok: false, code: "NETWORK_ERROR", message: "이니시스 거래 조회에 응답이 없습니다. 잠시 후 다시 시도해주세요." };
  }
  const text = await response.text().catch(() => "");
  let json: unknown = null;
  try { json = text.length <= 64 * 1024 ? JSON.parse(text) : null; } catch { json = null; }
  if (!json) {
    return { ok: false, code: `HTTP_${response.status}`, message: "이니시스 거래 조회 응답을 해석하지 못했습니다. 잠시 후 다시 시도해주세요." };
  }
  const parsed = parseInicisInquiryResponse(json);
  if (parsed.ok && parsed.transaction.mid && parsed.transaction.mid !== config.mid) {
    return { ok: false, code: "MID_MISMATCH", message: "다른 상점(MID)의 거래입니다. 온사이드 상점의 승인 TID를 확인해주세요." };
  }
  return parsed;
}
