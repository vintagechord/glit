import { getGuestStorageOwnerId } from "@/lib/guest-storage-owner";

const normalizePrefix = (prefix: string) => {
  const trimmed = prefix.trim();
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
};

export const isSubmissionObjectKeyOwned = ({
  objectKey,
  prefix,
  submissionId,
  submissionUserId,
  guestToken,
  allowClaimedGuestOwner = false,
}: {
  objectKey: string;
  prefix: string;
  submissionId: string;
  submissionUserId?: string | null;
  guestToken?: string | null;
  allowClaimedGuestOwner?: boolean;
}) => {
  const normalizedPrefix = normalizePrefix(prefix);
  if (!objectKey.startsWith(normalizedPrefix)) return false;

  const relativeSegments = objectKey
    .slice(normalizedPrefix.length)
    .split("/");
  if (
    relativeSegments.length !== 4 ||
    relativeSegments.some(
      (segment) => !segment || segment === "." || segment === "..",
    )
  ) {
    return false;
  }

  const [ownerSegment, , submissionSegment] = relativeSegments;
  if (submissionSegment !== submissionId) return false;

  if (submissionUserId && ownerSegment === submissionUserId) return true;
  if (
    guestToken &&
    (ownerSegment === getGuestStorageOwnerId(guestToken) ||
      ownerSegment === `guest-${guestToken}`)
  ) {
    return true;
  }

  return Boolean(
    allowClaimedGuestOwner &&
      ownerSegment.startsWith("guest-") &&
      ownerSegment.length >= "guest-".length + 8 &&
      ownerSegment.length <= "guest-".length + 120,
  );
};
