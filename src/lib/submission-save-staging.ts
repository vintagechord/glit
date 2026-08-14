export type SubmissionSaveRequestedStatus =
  | "DRAFT"
  | "PRE_REVIEW"
  | "SUBMITTED";

export type SubmissionSaveStatus =
  | SubmissionSaveRequestedStatus
  | "WAITING_PAYMENT";

export type SubmissionSavePaymentStatus = "UNPAID" | "PAYMENT_PENDING";

/**
 * Submitted writes are staged as an unpaid draft until tracks/files/reviews
 * have all succeeded. Draft and pre-review saves are already non-payable and
 * therefore do not need a second state transition.
 */
export const resolveSubmissionSaveState = ({
  requestedStatus,
  shouldRequestPayment,
}: {
  requestedStatus: SubmissionSaveRequestedStatus;
  shouldRequestPayment: boolean;
}) => {
  const requestsPayment =
    requestedStatus === "SUBMITTED" && shouldRequestPayment;
  const finalStatus: SubmissionSaveStatus = requestsPayment
    ? "WAITING_PAYMENT"
    : requestedStatus;
  const finalPaymentStatus: SubmissionSavePaymentStatus = requestsPayment
    ? "PAYMENT_PENDING"
    : "UNPAID";
  const requiresFinalization = requestedStatus === "SUBMITTED";

  return {
    requiresFinalization,
    stagingStatus: requiresFinalization ? "DRAFT" : finalStatus,
    stagingPaymentStatus: requiresFinalization
      ? "UNPAID"
      : finalPaymentStatus,
    finalStatus,
    finalPaymentStatus,
  } as const;
};
