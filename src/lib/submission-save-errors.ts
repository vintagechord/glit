export const SUBMISSION_COMMIT_FAILED_MESSAGE =
  "접수 저장이 완료되지 않았습니다. 내용을 확인한 뒤 다시 시도해주세요.";

export const SUBMISSION_FILE_RECEIPT_MISSING_MESSAGE =
  "확인되지 않은 첨부 파일이 있습니다. 해당 파일을 삭제한 뒤 다시 올려주세요.";

/**
 * What the applicant reads when the atomic save commit fails. The file guard
 * refuses a listed file whose upload receipt is gone (a save that ran while
 * the file was finishing, or a browser copy restored after the receipts
 * expired); only uploading that file again clears it.
 */
export function submissionCommitErrorMessage(error: { message?: string | null; code?: string | null } | null | undefined) {
  const message = error?.message ?? "";
  if (
    message.includes("SUBMISSION_FILE_METADATA_UNVERIFIED") ||
    message.includes("SUBMISSION_FILE_METADATA_MISMATCH")
  ) {
    return SUBMISSION_FILE_RECEIPT_MISSING_MESSAGE;
  }
  return SUBMISSION_COMMIT_FAILED_MESSAGE;
}
