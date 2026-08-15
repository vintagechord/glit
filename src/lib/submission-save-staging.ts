export type SubmissionSaveRequestedStatus =
  | "DRAFT"
  | "PRE_REVIEW"
  | "SUBMITTED";

export type SubmissionSaveStatus =
  | SubmissionSaveRequestedStatus
  | "WAITING_PAYMENT";

export type SubmissionSavePaymentStatus = "UNPAID" | "PAYMENT_PENDING";

/**
 * Every write stays as an unpaid draft while the save lease is active. The
 * commit RPC requires that invariant so tracks, files, reviews, and the final
 * lifecycle state are applied in one transaction. In particular, PRE_REVIEW
 * must not be exposed before its tracks have committed successfully.
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
  const requiresFinalization = finalStatus !== "DRAFT";

  return {
    requiresFinalization,
    stagingStatus: "DRAFT",
    stagingPaymentStatus: "UNPAID",
    finalStatus,
    finalPaymentStatus,
  } as const;
};
