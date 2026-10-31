import { createCipheriv } from "node:crypto";

import { getInicisTimestamp, sha512 } from "./crypto";
import { getInicisMode } from "./config";

/**
 * KG Inicis "현금영수증 별도발행" (INIAPI v2) for payments received outside
 * Inicis, such as direct bank transfers. Enabled only when the merchant's
 * INIAPI key and IV are registered; otherwise administrators record a Hometax
 * issuance by hand. https://manual.inicis.com/pay/etc-receipt.html
 */
export type CashReceiptInicisConfig = { mid: string; apiKey: string; apiIv: string; apiUrl: string };

const clean = (value?: string | null) => (value ?? "").trim();

export function getCashReceiptInicisConfig(env: Record<string, string | undefined> = process.env): CashReceiptInicisConfig | null {
  const mode = getInicisMode();
  const suffix = mode === "prod" ? "PROD" : "STG";
  const mid = clean(env[`INICIS_MID_${suffix}`]);
  // The INIAPI key/IV belong to the MID; billing already uses the same pair.
  const apiKey = clean(env[`INICIS_INIAPI_KEY_${suffix}`]) || clean(env[`INICIS_BILLING_API_KEY_${suffix}`]);
  const apiIv = clean(env[`INICIS_INIAPI_IV_${suffix}`]) || clean(env[`INICIS_BILLING_API_IV_${suffix}`]);
  const apiUrl = (clean(env[`INICIS_API_URL_${suffix}`]) || (mode === "prod" ? "https://iniapi.inicis.com" : "https://stginiapi.inicis.com")).replace(/\/+$/, "");
  if (!mid || !apiKey || !apiIv || !/^https:\/\//.test(apiUrl)) return null;
  return { mid, apiKey, apiIv, apiUrl };
}

/** INIAPI field encryption: AES-128-CBC (PKCS#7) with the INIAPI key/IV, Base64. */
export function encryptIniapiField(value: string, apiKey: string, apiIv: string) {
  const key = Buffer.from(apiKey, "utf8");
  const iv = Buffer.from(apiIv, "utf8");
  if (key.length !== 16 || iv.length !== 16) throw new Error("INIAPI key and IV must be 16 bytes.");
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString("base64");
}

export type CashReceiptIssueInput = {
  totalKrw: number;
  supplyKrw: number;
  vatKrw: number;
  purpose: "INCOME_DEDUCTION" | "EXPENSE_PROOF";
  identifier: string;
  goodName: string;
  buyerName: string;
  buyerEmail: string;
  buyerTel?: string | null;
};

export type CashReceiptIssueResult =
  | { ok: true; approvalNumber: string; tid: string | null; issuedAt: string; raw: Record<string, unknown> }
  // `uncertain` means the request may have reached Inicis; check its admin before retrying.
  | { ok: false; uncertain: boolean; code: string; message: string };

export function buildCashReceiptIssueRequest(config: CashReceiptInicisConfig, input: CashReceiptIssueInput, timestamp = getInicisTimestamp(), clientIp = "127.0.0.1") {
  const type = "receipt";
  const data = {
    price: String(input.totalKrw),
    supplyPrice: String(input.supplyKrw),
    tax: String(input.vatKrw),
    servicePrice: "0",
    issueType: input.purpose === "EXPENSE_PROOF" ? "1" : "0",
    issueNumber: encryptIniapiField(input.identifier, config.apiKey, config.apiIv),
    goodName: input.goodName.slice(0, 80),
    buyerName: input.buyerName.slice(0, 30),
    buyerEmail: input.buyerEmail.slice(0, 60),
    buyerTel: (input.buyerTel ?? "").replace(/[^0-9]/g, "").slice(0, 20),
    currency: "WON",
  };
  const hashData = sha512(config.apiKey + config.mid + type + timestamp + JSON.stringify(data));
  return { mid: config.mid, type, timestamp, clientIp, hashData, data };
}

const pick = (source: Record<string, unknown> | undefined, keys: string[]) => {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
};

/** Inicis returns YYYYMMDD + hhmmss in KST. */
const kstIso = (date: string, time: string) =>
  /^[0-9]{8}$/.test(date)
    ? new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${/^[0-9]{6}$/.test(time) ? `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}` : "00:00:00"}+09:00`).toISOString()
    : new Date().toISOString();

export async function issueCashReceiptWithInicis(
  input: CashReceiptIssueInput,
  options: { config?: CashReceiptInicisConfig | null; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<CashReceiptIssueResult> {
  const config = options.config === undefined ? getCashReceiptInicisConfig() : options.config;
  if (!config) return { ok: false, uncertain: false, code: "NOT_CONFIGURED", message: "이니시스 INIAPI 키가 등록되지 않았습니다." };
  let body: ReturnType<typeof buildCashReceiptIssueRequest>;
  try { body = buildCashReceiptIssueRequest(config, input); }
  catch { return { ok: false, uncertain: false, code: "INVALID_CONFIG", message: "이니시스 INIAPI 키 형식을 확인해주세요." }; }
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${config.apiUrl}/v2/pg/receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
  } catch {
    return { ok: false, uncertain: true, code: "NETWORK_ERROR", message: "이니시스 응답을 받지 못했습니다. 이니시스 관리자에서 발급 여부를 확인한 뒤 다시 시도해주세요." };
  }
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json) return { ok: false, uncertain: true, code: `HTTP_${response.status}`, message: "이니시스 응답을 해석하지 못했습니다. 이니시스 관리자에서 발급 여부를 확인해주세요." };
  const nested = json.data && typeof json.data === "object" ? (json.data as Record<string, unknown>) : undefined;
  const resultCode = pick(json, ["resultCode"]) || pick(nested, ["resultCode"]);
  const resultMsg = pick(json, ["resultMsg"]) || pick(nested, ["resultMsg"]);
  if (resultCode !== "00") {
    return { ok: false, uncertain: false, code: resultCode || `HTTP_${response.status}`, message: resultMsg ? `이니시스: ${resultMsg}`.slice(0, 300) : "이니시스가 발급을 거절했습니다." };
  }
  const approvalNumber = pick(json, ["authNo", "authNumber", "applNum"]) || pick(nested, ["authNo", "authNumber", "applNum"]);
  if (!approvalNumber) return { ok: false, uncertain: true, code: "NO_APPROVAL_NUMBER", message: "이니시스 응답에 승인번호가 없습니다. 이니시스 관리자에서 확인해주세요." };
  const tid = pick(json, ["tid"]) || pick(nested, ["tid"]) || null;
  const issuedAt = kstIso(pick(json, ["authDate"]) || pick(nested, ["authDate"]), pick(json, ["authTime"]) || pick(nested, ["authTime"]));
  return { ok: true, approvalNumber, tid, issuedAt, raw: json };
}
