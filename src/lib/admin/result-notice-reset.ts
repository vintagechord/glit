const RESULT_STATUSES = new Set(["RESULT_READY", "COMPLETED"]);

/**
 * A result notice covers the result it announced. When an admin moves an
 * application into 결과 준비/완료 from an earlier stage (after reopening it for
 * a re-review, or by picking the stage by hand), the old notice no longer
 * applies: the application waits in 결과 안내 대기 for a new result mail, and
 * the 7-day customer-file retention counts from that mail. The result-saving
 * functions clear it the same way when a station result changes.
 */
export function resultNoticeResetOnStatusChange(currentStatus: string | null | undefined, nextStatus: string | null | undefined) {
  return RESULT_STATUSES.has(nextStatus ?? "") && !RESULT_STATUSES.has(currentStatus ?? "")
    ? { result_notified_at: null }
    : {};
}
