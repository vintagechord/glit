/** Shared by the server tracking code and the admin pages (also client
 * components), so it holds no server-only imports. */

/** Customer mail about one application (same list as the admin mail history). */
export const OPEN_TRACKED_EMAIL_OPERATIONS: ReadonlySet<string> = new Set([
  "submission receipt", "bank payment request", "payment completed",
  "submission update", "review result", "guest lookup",
]);

/** The open image went live with the deployment of PR #90. Mail delivered
 * before it has no image, so its opens can never be known. */
export const EMAIL_OPEN_TRACKING_SINCE = "2026-11-05T11:02:07Z";
