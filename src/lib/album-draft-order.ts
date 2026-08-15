export type AlbumDraftOrderRow = {
  id?: unknown;
  album_price_tier?: unknown;
  created_at?: unknown;
};

const toTime = (value: unknown) => {
  const parsed = new Date(String(value ?? 0)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * A multi-album cart has one full-price base followed by discounted additions.
 * Autosaves update rows sequentially, so updated_at cannot identify the base.
 * The immutable FULL tier always identifies the base. Preserve explicit ID
 * order only within the same tier, then fall back to creation order.
 */
export const orderAlbumDraftRowsForResume = <T extends AlbumDraftOrderRow>(
  rows: readonly T[],
  storedSubmissionIds: readonly string[] = [],
) => {
  const storedOrder = new Map(
    storedSubmissionIds.map((submissionId, index) => [submissionId, index]),
  );

  return [...rows].sort((left, right) => {
    const leftIsFull = String(left.album_price_tier ?? "") === "FULL";
    const rightIsFull = String(right.album_price_tier ?? "") === "FULL";
    if (leftIsFull !== rightIsFull) return leftIsFull ? -1 : 1;

    const leftStoredIndex = storedOrder.get(String(left.id ?? ""));
    const rightStoredIndex = storedOrder.get(String(right.id ?? ""));
    if (leftStoredIndex !== undefined || rightStoredIndex !== undefined) {
      return (leftStoredIndex ?? Number.MAX_SAFE_INTEGER) -
        (rightStoredIndex ?? Number.MAX_SAFE_INTEGER);
    }

    return toTime(left.created_at) - toTime(right.created_at);
  });
};
