export type SubmissionUploadState = {
  status?: string | null;
  payment_status?: string | null;
};

export type SubmissionUploadBlockReason = "PAID" | "NOT_EDITABLE";

const editableSubmissionStatuses = new Set([
  "DRAFT",
  "PRE_REVIEW",
  "SUBMITTED",
  "WAITING_PAYMENT",
]);

/**
 * Upload URLs are writes even before submission_files is updated. Keep their
 * lifecycle boundary identical to the submission save actions, after caller
 * ownership has already been established.
 */
export const getSubmissionUploadBlockReason = (
  submission: SubmissionUploadState | null | undefined,
): SubmissionUploadBlockReason | null => {
  if (submission?.payment_status === "PAID") return "PAID";
  if (submission?.payment_status === "PAYMENT_PENDING") {
    return "NOT_EDITABLE";
  }
  if (!editableSubmissionStatuses.has(submission?.status ?? "")) {
    return "NOT_EDITABLE";
  }
  return null;
};

export const getSubmissionUploadBlockMessage = (
  reason: SubmissionUploadBlockReason,
) =>
  reason === "PAID"
    ? "결제가 완료된 접수의 파일은 변경할 수 없습니다."
    : "현재 상태에서는 접수 파일을 변경할 수 없습니다.";

/** Maps the database TOCTOU guard back to the same safe client response. */
export const getSubmissionUploadConflictMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("SUBMISSION_FILE_PAID")) {
    return getSubmissionUploadBlockMessage("PAID");
  }
  if (message.includes("SUBMISSION_FILE_STATE_INVALID")) {
    return getSubmissionUploadBlockMessage("NOT_EDITABLE");
  }
  return null;
};

/**
 * Applicant uploads must not mutate live submission_files merely because a
 * blob finished uploading. The wizard carries verified metadata until an
 * explicit save commits the complete, kind-normalized file set atomically.
 */
export const shouldStageSubmissionUpload = (
  submission: SubmissionUploadState | null | undefined,
) => getSubmissionUploadBlockReason(submission) === null;
