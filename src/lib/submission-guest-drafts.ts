/**
 * A guest's in-progress application is reachable only through the id/token
 * pair kept in this browser: one locator slot per type
 * (`onside:draft:album:guest`, `onside:draft:mv:guest`) plus the type's
 * guest-token slot. Opening a cart item for editing reuses the same locator
 * slot, so the draft it pointed at is parked here first and restored when the
 * slot is free again. Login adoption presents every parked token as well and
 * forgets only the tokens the server no longer needs.
 */
export type GuestDraftKind = "album" | "mv";

export type GuestDraftStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type GuestDraftRef = { submissionId: string; guestToken: string };

type GuestDraftSlot = Record<string, unknown>;

const maxParkedSlots = 10;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const getGuestDraftSlotKey = (kind: GuestDraftKind) =>
  `onside:draft:${kind}:guest`;
export const getGuestDraftTokenKey = (kind: GuestDraftKind) =>
  `onside:guest-token:${kind}:guest`;
export const getParkedGuestDraftSlotsKey = (kind: GuestDraftKind) =>
  `onside:draft:${kind}:guest:parked`;

const isToken = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 8 && value.length <= 120;

const parseSlot = (raw: string | null): GuestDraftSlot | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as GuestDraftSlot)
      : null;
  } catch {
    return null;
  }
};

/** The exact id/token pairs a locator slot points at. */
export const getGuestDraftSlotRefs = (
  kind: GuestDraftKind,
  slot: GuestDraftSlot | null,
): GuestDraftRef[] => {
  if (!slot) return [];
  const fallbackToken = isToken(slot.guestToken) ? slot.guestToken : null;
  const ids =
    kind === "album"
      ? Array.isArray(slot.ids)
        ? slot.ids
        : []
      : [slot.id];
  const tokens =
    slot.guestTokensBySubmissionId &&
    typeof slot.guestTokensBySubmissionId === "object"
      ? (slot.guestTokensBySubmissionId as Record<string, unknown>)
      : {};
  const refs = new Map<string, GuestDraftRef>();
  for (const id of ids) {
    if (typeof id !== "string" || !uuidPattern.test(id)) continue;
    const token = isToken(tokens[id]) ? (tokens[id] as string) : fallbackToken;
    if (token) refs.set(id, { submissionId: id, guestToken: token });
  }
  return Array.from(refs.values());
};

const readParkedSlots = (storage: GuestDraftStorage, kind: GuestDraftKind) => {
  try {
    const value = JSON.parse(
      storage.getItem(getParkedGuestDraftSlotsKey(kind)) ?? "[]",
    ) as unknown;
    return Array.isArray(value)
      ? value.filter(
          (slot): slot is GuestDraftSlot =>
            Boolean(slot) &&
            typeof slot === "object" &&
            getGuestDraftSlotRefs(kind, slot as GuestDraftSlot).length > 0,
        )
      : [];
  } catch {
    return [];
  }
};

const writeParkedSlots = (
  storage: GuestDraftStorage,
  kind: GuestDraftKind,
  slots: GuestDraftSlot[],
) => {
  const key = getParkedGuestDraftSlotsKey(kind);
  if (slots.length === 0) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(slots.slice(-maxParkedSlots)));
};

const slotIdentity = (kind: GuestDraftKind, slot: GuestDraftSlot) =>
  getGuestDraftSlotRefs(kind, slot)
    .map((ref) => ref.submissionId)
    .sort()
    .join(",");

/**
 * Call before overwriting the guest locator slot with a cart item. A slot that
 * points only at the item being opened, or only at other cart items (the
 * cart keeps those credentials itself), is not a draft and is not parked.
 */
export const parkGuestDraftSlot = (
  storage: GuestDraftStorage,
  kind: GuestDraftKind,
  options: { cartSubmissionIds: readonly string[] },
) => {
  try {
    const slot = parseSlot(storage.getItem(getGuestDraftSlotKey(kind)));
    const cartIds = new Set(options.cartSubmissionIds);
    const draftRefs = getGuestDraftSlotRefs(kind, slot).filter(
      (ref) => !cartIds.has(ref.submissionId),
    );
    if (!slot || draftRefs.length === 0) return false;
    const identity = slotIdentity(kind, slot);
    const parked = readParkedSlots(storage, kind).filter(
      (candidate) => slotIdentity(kind, candidate) !== identity,
    );
    writeParkedSlots(storage, kind, [...parked, slot]);
    return true;
  } catch {
    return false;
  }
};

/**
 * When the locator slot is free again (the cart edit finished or was
 * discarded), put the most recently parked draft back so the normal resume
 * prompt offers it. The type's guest token follows the restored draft.
 */
export const restoreParkedGuestDraftSlot = (
  storage: GuestDraftStorage,
  kind: GuestDraftKind,
) => {
  try {
    if (storage.getItem(getGuestDraftSlotKey(kind))) return false;
    const parked = readParkedSlots(storage, kind);
    const slot = parked.pop();
    if (!slot) return false;
    storage.setItem(getGuestDraftSlotKey(kind), JSON.stringify(slot));
    const token = getGuestDraftSlotRefs(kind, slot)[0]?.guestToken;
    if (token) storage.setItem(getGuestDraftTokenKey(kind), token);
    writeParkedSlots(storage, kind, parked);
    return true;
  } catch {
    return false;
  }
};

/**
 * Guest credentials to present when a member signs in on this browser. Every
 * parked draft is adopted, but only the active slot (or the latest parked one)
 * is offered for resuming so separate drafts never load as one album batch.
 */
export const readGuestDraftLeftovers = (
  storage: GuestDraftStorage,
  kind: GuestDraftKind,
) => {
  try {
    const slot = parseSlot(storage.getItem(getGuestDraftSlotKey(kind)));
    const parked = readParkedSlots(storage, kind);
    const activeRefs = getGuestDraftSlotRefs(kind, slot);
    // An id without its own token may still belong to the type's guest token.
    const activeIds = (kind === "album" ? (Array.isArray(slot?.ids) ? slot.ids : []) : [slot?.id])
      .filter((id): id is string => typeof id === "string" && uuidPattern.test(id));
    const resumeIds =
      activeIds.length > 0
        ? activeIds
        : getGuestDraftSlotRefs(kind, parked[parked.length - 1] ?? null).map(
            (ref) => ref.submissionId,
          );
    const allRefs = [
      ...activeRefs,
      ...parked.flatMap((candidate) => getGuestDraftSlotRefs(kind, candidate)),
    ];
    const storedToken = storage.getItem(getGuestDraftTokenKey(kind));
    const guestToken = isToken(storedToken)
      ? storedToken
      : isToken(slot?.guestToken)
        ? (slot?.guestToken as string)
        : undefined;
    if (!guestToken && allRefs.length === 0) return null;
    return {
      ids: Array.from(new Set(resumeIds)),
      guestToken,
      guestTokensBySubmissionId: Object.fromEntries(
        allRefs.map((ref) => [ref.submissionId, ref.guestToken]),
      ),
    };
  } catch {
    return null;
  }
};

/**
 * After a successful adoption request, forget every guest credential except
 * the tokens the server reports as still owning an unclaimed draft (a save
 * was in flight). Never call this when the claim failed.
 */
export const retainGuestDraftLeftovers = (
  storage: GuestDraftStorage,
  kind: GuestDraftKind,
  retainedGuestTokens: readonly string[],
) => {
  const retained = new Set(retainedGuestTokens);
  const keeps = (slot: GuestDraftSlot | null) =>
    getGuestDraftSlotRefs(kind, slot).some((ref) => retained.has(ref.guestToken));
  try {
    const slotKey = getGuestDraftSlotKey(kind);
    if (!keeps(parseSlot(storage.getItem(slotKey)))) storage.removeItem(slotKey);
    writeParkedSlots(storage, kind, readParkedSlots(storage, kind).filter(keeps));
    const tokenKey = getGuestDraftTokenKey(kind);
    const token = storage.getItem(tokenKey);
    if (!token || !retained.has(token)) storage.removeItem(tokenKey);
  } catch {
    // Storage is best effort; the server-side adoption already succeeded.
  }
};
