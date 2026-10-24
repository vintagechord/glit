/** PostgREST serializes PostgreSQL's unbounded timestamptz as this string. */
export const REVIEW_DOCUMENT_NO_EXPIRY = "infinity";

export function hasUnlimitedReviewRetention(expiresAt: string): boolean {
  return expiresAt === REVIEW_DOCUMENT_NO_EXPIRY;
}

/** Preserve explicit legacy expiry; malformed dates must never grant access. */
export function isReviewJobExpired(
  job: { status: string; expires_at: string },
  now = Date.now(),
): boolean {
  if (job.status === "expired") return true;
  if (hasUnlimitedReviewRetention(job.expires_at)) return false;
  const deadline = Date.parse(job.expires_at);
  return !Number.isFinite(deadline) || deadline <= now;
}
