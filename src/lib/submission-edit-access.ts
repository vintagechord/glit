export type SubmissionEditOwner = {
  user_id: string | null;
  guest_token: string | null;
  status: string | null;
  payment_status: string | null;
};

export type SubmissionEditActor = {
  userId?: string | null;
  guestToken?: string | null;
};

/**
 * Submission writes run through a service-role fallback for guest support, so
 * ownership must be checked before any upsert. A signed-in user may claim a
 * guest draft only when they also present that draft's guest token.
 */
export const canEditSubmission = (
  submission: SubmissionEditOwner | null | undefined,
  actor: SubmissionEditActor,
) => {
  if (!submission) return false;
  if (submission.payment_status === "PAID") return false;
  if (
    !["DRAFT", "PRE_REVIEW", "SUBMITTED", "WAITING_PAYMENT"].includes(
      submission.status ?? "",
    )
  ) {
    return false;
  }

  const userId = actor.userId?.trim() ?? "";
  const guestToken = actor.guestToken?.trim() ?? "";

  if (userId) {
    if (submission.user_id) {
      return submission.user_id === userId;
    }
    return Boolean(
      submission.guest_token &&
        guestToken &&
        submission.guest_token === guestToken,
    );
  }

  return Boolean(
    !submission.user_id &&
      submission.guest_token &&
      guestToken &&
      submission.guest_token === guestToken,
  );
};
