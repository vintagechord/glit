const MAX_AUDIT_DEPTH = 6;
const MAX_AUDIT_ENTRIES = 100;
const MAX_AUDIT_ARRAY_ITEMS = 20;
const MAX_AUDIT_STRING_LENGTH = 500;

const normalizeKey = (key: string) =>
  key.toLowerCase().replace(/[^a-z0-9]/g, "");

// Explicitly allow only reconciliation data. Authentication material, URLs,
// callback state, card numbers, and customer identity fields are omitted even
// when the gateway changes their casing or separators.
const allowedKeys = new Set([
  "provider",
  "kind",
  "returnparams",
  "approval",
  "signatureverification",
  "compensation",
  "inputs",
  "data",
  "resultcode",
  "resultmsg",
  "resultmessage",
  "status",
  "phase",
  "bindingerror",
  "expected",
  "received",
  "expectedorderid",
  "approvedorderid",
  "expectedamount",
  "approvedamount",
  "orderid",
  "ordernumber",
  "moid",
  "tid",
  "pgtid",
  "cardtid",
  "ptid",
  "amount",
  "price",
  "totprice",
  "pamt",
  "currency",
  "mid",
  "timestamp",
  "tstamp",
  "paymethod",
  "cardcode",
  "cardquota",
  "appldate",
  "appltime",
  "verifystatus",
  "sigmismatchreason",
  "sigverified",
  "securesignaturematches",
  "totpricesource",
  "ok",
  "skipped",
  "at",
  "closecallback",
]);

const scrubValue = (value: unknown, depth: number): unknown => {
  if (depth > MAX_AUDIT_DEPTH || value == null) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    return value.slice(0, MAX_AUDIT_STRING_LENGTH);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_AUDIT_ARRAY_ITEMS)
      .map((item) => scrubValue(item, depth + 1))
      .filter((item) => item != null);
  }
  if (typeof value !== "object") return null;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(
    0,
    MAX_AUDIT_ENTRIES,
  )) {
    if (!allowedKeys.has(normalizeKey(key))) continue;
    const scrubbed = scrubValue(child, depth + 1);
    if (scrubbed != null) output[key] = scrubbed;
  }
  return output;
};

export const scrubInicisPaymentAudit = (
  value: unknown,
): Record<string, unknown> => {
  const scrubbed = scrubValue(value, 0);
  return scrubbed && typeof scrubbed === "object" && !Array.isArray(scrubbed)
    ? (scrubbed as Record<string, unknown>)
    : {};
};
