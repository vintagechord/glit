export type GuestSubmissionCartEntry = {
  submissionId: string;
  guestToken: string;
};

export const GUEST_SUBMISSION_CART_STORAGE_KEY =
  "onside:guest-submission-cart:v1";
export const SUBMISSION_CART_UPDATED_EVENT = "onside:cart-updated";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxGuestCartItems = 100;

const normalizeEntry = (value: unknown): GuestSubmissionCartEntry | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const submissionId =
    typeof row.submissionId === "string" ? row.submissionId.trim() : "";
  const guestToken =
    typeof row.guestToken === "string" ? row.guestToken.trim() : "";

  if (
    !uuidPattern.test(submissionId) ||
    guestToken.length < 8 ||
    guestToken.length > 120
  ) {
    return null;
  }

  return { submissionId, guestToken };
};

export const normalizeGuestSubmissionCartEntries = (
  value: unknown,
): GuestSubmissionCartEntry[] => {
  if (!Array.isArray(value)) return [];

  const bySubmissionId = new Map<string, GuestSubmissionCartEntry>();
  for (const valueEntry of value) {
    const entry = normalizeEntry(valueEntry);
    if (!entry) continue;
    bySubmissionId.set(entry.submissionId, entry);
  }

  return Array.from(bySubmissionId.values()).slice(-maxGuestCartItems);
};

export const parseGuestSubmissionCartEntries = (raw: string | null) => {
  if (!raw) return [];
  try {
    return normalizeGuestSubmissionCartEntries(JSON.parse(raw));
  } catch {
    return [];
  }
};

export const readGuestSubmissionCartEntries = () => {
  if (typeof window === "undefined") return [];
  try {
    return parseGuestSubmissionCartEntries(
      window.localStorage.getItem(GUEST_SUBMISSION_CART_STORAGE_KEY),
    );
  } catch {
    return [];
  }
};

export const writeGuestSubmissionCartEntries = (
  entries: GuestSubmissionCartEntry[],
) => {
  if (typeof window === "undefined") return false;
  const normalized = normalizeGuestSubmissionCartEntries(entries);
  try {
    window.localStorage.setItem(
      GUEST_SUBMISSION_CART_STORAGE_KEY,
      JSON.stringify(normalized),
    );
    window.dispatchEvent(new Event(SUBMISSION_CART_UPDATED_EVENT));
    return true;
  } catch {
    return false;
  }
};

/**
 * The submission itself is the cart item. Re-adding an edited submission must
 * replace its guest token metadata, never create a second cart entry.
 */
export const mergeGuestSubmissionCartEntries = (
  current: GuestSubmissionCartEntry[],
  incoming: GuestSubmissionCartEntry[],
) => normalizeGuestSubmissionCartEntries([...current, ...incoming]);

export const addGuestSubmissionCartEntries = (
  entries: GuestSubmissionCartEntry[],
) => {
  const current = readGuestSubmissionCartEntries();
  return writeGuestSubmissionCartEntries(
    mergeGuestSubmissionCartEntries(current, entries),
  );
};

export const removeGuestSubmissionCartEntries = (submissionIds: string[]) => {
  const removedIds = new Set(submissionIds);
  return writeGuestSubmissionCartEntries(
    readGuestSubmissionCartEntries().filter(
      (entry) => !removedIds.has(entry.submissionId),
    ),
  );
};

export const toGuestTokensBySubmissionId = (
  entries: GuestSubmissionCartEntry[],
) =>
  Object.fromEntries(
    normalizeGuestSubmissionCartEntries(entries).map((entry) => [
      entry.submissionId,
      entry.guestToken,
    ]),
  );
