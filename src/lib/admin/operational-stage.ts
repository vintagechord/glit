import type { PaymentStatus, ReviewStatus } from "@/constants/review-status";
import { statusAfterPaymentConfirmation } from "@/lib/admin/order-payment";

/**
 * 운영 단계: the four positions of the stage select on the admin detail page.
 * Saving a stage stores a review status and a payment status; the select must
 * then stand on the stage that was stored. Reading the stage from anything
 * else (station results, for one) makes a saved stage look unsaved, and the
 * next save of the same form silently writes the displayed stage back.
 */
export const adminOperationalStageValues = [
  "APPLICATION_RECEIVED",
  "PAYMENT_COMPLETE",
  "REVIEW_IN_PROGRESS",
  "RESULT_NOTIFIED",
] as const;

export type AdminOperationalStage = (typeof adminOperationalStageValues)[number];

export const adminOperationalStageLabelMap: Record<AdminOperationalStage, string> = {
  APPLICATION_RECEIVED: "신청접수",
  PAYMENT_COMPLETE: "결제완료",
  REVIEW_IN_PROGRESS: "심의진행",
  RESULT_NOTIFIED: "결과 준비",
};

export const adminOperationalStageOptions = adminOperationalStageValues.map((value) => ({
  value,
  label: adminOperationalStageLabelMap[value],
}));

/** What saving a stage stores. */
export function mapAdminOperationalStage(
  stage: AdminOperationalStage,
  currentPaymentStatus?: PaymentStatus | null,
  currentStatus: ReviewStatus = "SUBMITTED",
): { status: ReviewStatus; paymentStatus: PaymentStatus } {
  // A refund is recorded only from 환불 처리 and stops the review: no stage
  // marks the application paid again or moves its review.
  if (currentPaymentStatus === "REFUNDED") return { status: currentStatus, paymentStatus: "REFUNDED" };
  switch (stage) {
    case "APPLICATION_RECEIVED":
      return {
        // An unpaid order already waiting for its payment keeps that status:
        // rewriting it adds nothing, and an open card window refuses the edit.
        status: currentStatus === "WAITING_PAYMENT" && currentPaymentStatus !== "PAID" ? currentStatus : "SUBMITTED",
        paymentStatus:
          currentPaymentStatus && currentPaymentStatus !== "PAID"
            ? currentPaymentStatus
            : "PAYMENT_PENDING",
      };
    case "PAYMENT_COMPLETE":
      return { status: currentPaymentStatus === "PAID" ? currentStatus : statusAfterPaymentConfirmation(currentStatus), paymentStatus: "PAID" };
    case "REVIEW_IN_PROGRESS":
      return { status: "IN_PROGRESS", paymentStatus: "PAID" };
    case "RESULT_NOTIFIED":
      return { status: "RESULT_READY", paymentStatus: "PAID" };
  }
}

/** The stage a stored row stands on: the inverse of mapAdminOperationalStage. */
export function storedOperationalStage(row: {
  status?: string | null;
  payment_status?: string | null;
}): AdminOperationalStage {
  if (row.status === "RESULT_READY" || row.status === "COMPLETED") return "RESULT_NOTIFIED";
  if (row.payment_status !== "PAID") return "APPLICATION_RECEIVED";
  return row.status === "IN_PROGRESS" ? "REVIEW_IN_PROGRESS" : "PAYMENT_COMPLETE";
}
