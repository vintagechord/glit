/** Bounded text from a gateway response field; numbers are accepted, anything else is dropped. */
export const textValue = (value: unknown, maxLength: number) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
};

/**
 * Persist only a small, non-secret PG audit projection. In particular, never
 * retain billing keys, auth tokens, card data, hashes, signatures, or URLs
 * returned by a gateway in a user-related history row.
 *
 * Lives outside the route module: Next.js route files may only export route
 * handlers and segment config, and the production type check enforces that.
 */
export const sanitizeSubscriptionRefundResponse = (value: unknown) => {
  const response =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    provider: "inicis",
    resultCode: textValue(
      response.resultCode ?? response.resultcode ?? response.P_STATUS,
      120,
    ),
    resultMessage: textValue(
      response.resultMsg ?? response.resultmsg ?? response.P_RMESG1,
      500,
    ),
    cancelDate: textValue(
      response.cancelDate ?? response.canceldate ?? response.cancel_date,
      32,
    ),
    cancelTime: textValue(
      response.cancelTime ?? response.canceltime ?? response.cancel_time,
      32,
    ),
  };
};
