export type EmailDeliveryMode = "manual" | "transactional" | "invalid";

/** One public flag is shared by server behavior and the browser's build. */
export function getEmailDeliveryMode(
  value = process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE,
): EmailDeliveryMode {
  if (value === undefined) return "transactional";
  const mode = value.trim();
  return mode === "manual" || mode === "transactional" ? mode : "invalid";
}
