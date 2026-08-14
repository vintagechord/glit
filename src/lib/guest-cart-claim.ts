export type GuestCartClaimCandidate = {
  id: string;
  user_id: string | null;
  guest_token: string | null;
  status: string | null;
  payment_status: string | null;
  user_deleted_at?: string | null;
};

const claimableStatuses = new Set(["SUBMITTED", "WAITING_PAYMENT"]);
const claimablePaymentStatuses = new Set(["UNPAID", "PAYMENT_PENDING"]);

const isClaimableGuestCartRow = (
  row: GuestCartClaimCandidate,
  guestToken: string | undefined,
) =>
  !row.user_id &&
  Boolean(row.guest_token) &&
  Boolean(guestToken) &&
  row.guest_token === guestToken &&
  claimableStatuses.has(row.status ?? "") &&
  (row.payment_status === null ||
    claimablePaymentStatuses.has(row.payment_status ?? "")) &&
  !row.user_deleted_at;

export const partitionGuestCartClaimEntries = (
  guestTokensBySubmissionId: Record<string, string>,
  rows: GuestCartClaimCandidate[],
) => {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const claimableEntries: Record<string, string> = {};
  const invalidSubmissionIds: string[] = [];

  for (const [submissionId, guestToken] of Object.entries(
    guestTokensBySubmissionId,
  )) {
    const row = rowsById.get(submissionId);
    if (row && isClaimableGuestCartRow(row, guestToken)) {
      claimableEntries[submissionId] = guestToken;
    } else {
      invalidSubmissionIds.push(submissionId);
    }
  }

  return { claimableEntries, invalidSubmissionIds };
};
