import { z } from "zod";

const submissionDeleteSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict();

export const parseSubmissionDeletePayload = (value: unknown) => {
  const parsed = submissionDeleteSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    ids: Array.from(new Set(parsed.data.ids)),
  };
};

export type SubmissionDeleteCandidate = {
  id: string;
  status: string | null;
  payment_status: string | null;
  current_order_id: string | null;
};

const hardDeletableStatuses = new Set(["DRAFT", "PRE_REVIEW"]);
const hideablePaymentStatuses = new Set(["PAID", "REFUNDED"]);

/**
 * Only an unpaid, unordered draft may disappear for good. PRE_REVIEW also
 * means "paid, awaiting material review", so payment decides, not status.
 * Paid and refunded records keep their payment history and are only hidden
 * from the member. Everything in between (an active bank deposit, a cart
 * item, a checkout order) belongs to the cart or order flow and is refused.
 */
export const classifySubmissionDelete = (
  row: SubmissionDeleteCandidate,
): "delete" | "hide" | "refuse" => {
  const paymentStatus = row.payment_status ?? "";
  if (hideablePaymentStatuses.has(paymentStatus)) return "hide";
  if (
    paymentStatus === "UNPAID" &&
    !row.current_order_id &&
    hardDeletableStatuses.has(row.status ?? "")
  ) {
    return "delete";
  }
  return "refuse";
};
