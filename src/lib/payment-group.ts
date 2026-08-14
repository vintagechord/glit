export type SubmissionPaymentGroupRecord = {
  submission_id?: string | null;
  raw_response?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeIds = (...values: unknown[]) =>
  Array.from(
    new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

export const getPaymentGroupSubmissionIds = (
  payment?: SubmissionPaymentGroupRecord | null,
) => {
  const baseIds = normalizeIds(payment?.submission_id);
  const raw = payment?.raw_response;
  if (!isRecord(raw) || !isRecord(raw.paymentGroup)) return baseIds;

  return normalizeIds(
    baseIds,
    Array.isArray(raw.paymentGroup.submissionIds)
      ? raw.paymentGroup.submissionIds
      : [],
    Array.isArray(raw.paymentGroup.relatedSubmissionIds)
      ? raw.paymentGroup.relatedSubmissionIds
      : [],
  );
};

export const hasPaymentGroupIntersection = (
  payments: SubmissionPaymentGroupRecord[],
  submissionIds: string[],
) => {
  const targetIds = new Set(normalizeIds(submissionIds));
  return payments.some((payment) =>
    getPaymentGroupSubmissionIds(payment).some((id) => targetIds.has(id)),
  );
};

type DatabaseErrorLike = {
  code?: string | null;
  message?: string | null;
};

export const isPaymentInProgressDatabaseError = (
  error?: DatabaseErrorLike | null,
) =>
  error?.code === "55000" &&
  Boolean(error.message?.includes("PAYMENT_IN_PROGRESS"));

export const canHandlePaymentApprovalCallback = (
  status?: string | null,
) => status === "REQUESTED" || status === "APPROVED";
