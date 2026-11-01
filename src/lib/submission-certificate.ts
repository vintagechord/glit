export type SubmissionCertificateState = {
  type?: string | null;
  certificate_b2_path?: string | null;
  status?: string | null;
  result_status?: string | null;
  result_notified_at?: string | null;
  mv_desired_rating?: string | null;
};

/** All customer certificate routes use the same publication signal. */
export function hasPublishedSubmissionResult(submission: SubmissionCertificateState) {
  return Boolean(
    submission.result_status ||
      submission.result_notified_at ||
      (submission.status && ["RESULT_READY", "COMPLETED"].includes(submission.status)),
  );
}

/** A rejected online music video has no rating mark, usage guide or
 * certificate to hand to the customer. */
export function isRejectedMvResult(submission: Pick<SubmissionCertificateState, "mv_desired_rating">) {
  return submission.mv_desired_rating?.trim() === "REJECT";
}

export function currentSubmissionCertificateKey(submission: SubmissionCertificateState) {
  return submission.certificate_b2_path?.trim() || null;
}

/** The old default namespace stays readable only after the caller separately
 * checks ownership, publication and the exact current database pointer. */
export function certificateSubmissionId(objectKey: string, configuredPrefix: string) {
  if (/[\u0000-\u001f\u007f]/.test(objectKey)) return null;
  const prefix = configuredPrefix.endsWith("/") ? configuredPrefix : `${configuredPrefix}/`;
  for (const candidate of new Set([prefix, "submissions/"])) {
    if (!objectKey.startsWith(candidate)) continue;
    const relative = objectKey.slice(candidate.length);
    const match = relative.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/certificate\/(.+)$/i);
    if (match && !relative.split("/").some(part => part === "." || part === "..")) return match[1];
  }
  return null;
}
