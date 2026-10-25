/** A return URL describes a gateway callback, not the stored payment state. */
export function customerPaymentFeedback(returnState: string | undefined, paymentStatus: string) {
  if (!returnState || !["success", "cancel", "fail", "error"].includes(returnState)) return null;
  if (paymentStatus === "PAID") return "paid";
  if (paymentStatus === "REFUNDED") return "refunded";
  if (returnState === "success") return "checking";
  if (returnState === "cancel") return "cancelled";
  return "failed";
}
