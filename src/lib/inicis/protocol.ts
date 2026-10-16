/** KG INIStdPay PC contract: https://manual.inicis.com/pay/stdpay_pc.html */
export type InicisGatewayData = Record<string, string | number | null | undefined>;

export function isTrustedStdPayUrl(
  value: string | null | undefined,
  center: string | null | undefined,
  mode: "prod" | "stg",
  cancel = false,
) {
  if (!value || !center) return false;
  const match = /^https:\/\/(fc|ks|stg)stdpay\.inicis\.com(?::443)?(\/api\/(?:payAuth|netCancel))$/.exec(value);
  return Boolean(
    match && match[1] === center &&
    (mode === "stg" ? center === "stg" : center === "fc" || center === "ks") &&
    match[2] === `/api/${cancel ? "netCancel" : "payAuth"}`,
  );
}

export const isValidInicisAuthToken = (value: string) =>
  value.length > 0 && value.length <= 8192 && /\S/.test(value) &&
  // KG can wrap an opaque token with CR/LF. Preserve it exactly when signing.
  !/[^\x0a\x0d\x20-\x7e]/.test(value);

export function validateStdPayCardReceipt(
  data: InicisGatewayData,
  expected: { mid: string; orderId: string; amountKrw: number },
): string | null {
  if (data.resultCode !== "0000") return "RESULT_CODE_MISMATCH";
  if (data.mid !== expected.mid) return "MID_MISMATCH";
  if (data.MOID !== expected.orderId) return "ORDER_ID_MISMATCH";
  if (!Number.isSafeInteger(expected.amountKrw) || expected.amountKrw <= 0 ||
      String(data.TotPrice) !== String(expected.amountKrw)) return "PRICE_MISMATCH";
  if (data.currency !== "WON") return "CURRENCY_MISMATCH";
  if (data.payMethod !== "Card" && data.payMethod !== "VCard") return "PAYMENT_METHOD_MISMATCH";
  if (typeof data.tid !== "string" || !/^[A-Za-z0-9_-]{5,40}$/.test(data.tid)) return "TID_MISSING";
  if (!/^[A-Za-z0-9]{1,8}$/.test(String(data.applNum ?? ""))) return "APPROVAL_NUMBER_MISSING";
  const date = String(data.applDate ?? ""), time = String(data.applTime ?? "");
  if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(time)) return "APPROVAL_DATE_INVALID";
  const parsed = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}Z`);
  if (!Number.isFinite(parsed.valueOf()) ||
      parsed.toISOString().slice(0, 19).replace(/[-:T]/g, "") !== date + time) return "APPROVAL_DATE_INVALID";
  // authSignature has no documented calculation in this product. Optional
  // legacy fields must neither reject a valid receipt nor authenticate one.
  return null;
}

/** Parse scalar gateway JSON without silently accepting duplicate/escaped keys. */
export function parseInicisJson(text: string): InicisGatewayData | null {
  const source = text.trim();
  if (!source.startsWith("{") || !source.endsWith("}")) return null;
  const data: InicisGatewayData = Object.create(null);
  const field = /\s*("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")\s*:\s*("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|null)\s*/y;
  let cursor = 1, count = 0;
  if (!source.slice(cursor, -1).trim()) return data;
  while (cursor < source.length - 1) {
    field.lastIndex = cursor;
    const match = field.exec(source);
    if (!match || ++count > 128) return null;
    const key = JSON.parse(match[1]) as string;
    const value = JSON.parse(match[2]) as string | number | null;
    if (Object.hasOwn(data, key) || key.length > 128 ||
        (typeof value === "string" && value.length > 8192) ||
        (typeof value === "number" && !Number.isFinite(value))) return null;
    data[key] = value;
    cursor = field.lastIndex;
    if (source[cursor] === "}" && cursor === source.length - 1) return data;
    if (source[cursor] !== ",") return null;
    cursor += 1;
  }
  return null;
}
