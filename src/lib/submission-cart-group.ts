export type SubmissionCartGroupItem = {
  id: string;
  type: string | null;
  album_draft_group_id?: string | null;
  albumDraftGroupId?: string | null;
};

/** A multi-album application is one selection, payment, and deletion unit. */
export const getSubmissionCartGroupKey = (item: SubmissionCartGroupItem) => {
  const groupId = (
    item.album_draft_group_id ?? item.albumDraftGroupId
  )?.trim();
  return item.type === "ALBUM" && groupId
    ? `album:${groupId}`
    : `submission:${item.id}`;
};

export const expandSubmissionCartGroupIds = <
  T extends SubmissionCartGroupItem,
>(
  items: readonly T[],
  submissionIds: Iterable<string>,
) => {
  const requestedIds = new Set(submissionIds);
  const requestedGroupKeys = new Set(
    items
      .filter((item) => requestedIds.has(item.id))
      .map(getSubmissionCartGroupKey),
  );

  return items
    .filter(
      (item) =>
        requestedIds.has(item.id) ||
        requestedGroupKeys.has(getSubmissionCartGroupKey(item)),
    )
    .map((item) => item.id);
};

export const filterCompleteSubmissionCartGroups = <
  T extends SubmissionCartGroupItem,
>(
  items: readonly T[],
  acceptsItem: (item: T) => boolean,
) => {
  const groupAcceptance = new Map<string, boolean>();
  const itemAcceptance = new Map<string, boolean>();
  for (const item of items) {
    const key = getSubmissionCartGroupKey(item);
    const accepted = acceptsItem(item);
    itemAcceptance.set(item.id, accepted);
    groupAcceptance.set(
      key,
      (groupAcceptance.get(key) ?? true) && accepted,
    );
  }

  return items.filter(
    (item) =>
      groupAcceptance.get(getSubmissionCartGroupKey(item)) === true &&
      itemAcceptance.get(item.id) === true,
  );
};
