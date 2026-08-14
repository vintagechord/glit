import {
  parseInicisContext,
  type InicisPaymentContext,
} from "@/lib/inicis/context";
import { safeRandomUUID } from "@/lib/uuid";

export type InicisPopupHandoffPayload = {
  context: InicisPaymentContext;
  submissionId?: string;
  submissionIds?: string[];
  guestToken?: string;
  guestTokensBySubmissionId?: Record<string, string>;
  orderId?: string;
  requestId?: string;
};

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

const HANDOFF_STORAGE_PREFIX = "onside:inicis-popup-handoff:";
const HANDOFF_TTL_MS = 5 * 60 * 1000;
const MAX_STORED_BYTES = 32 * 1024;
const MAX_SUBMISSIONS = 100;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenPattern = /^[A-Za-z0-9_-]{8,120}$/;
const orderIdPattern = /^[A-Za-z0-9._:-]{1,200}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

const normalizePayload = (value: unknown): InicisPopupHandoffPayload | null => {
  if (!isRecord(value)) return null;
  const context =
    typeof value.context === "string"
      ? parseInicisContext(value.context)
      : null;
  if (!context) return null;

  const optionalUuid = (candidate: unknown) =>
    candidate == null
      ? undefined
      : typeof candidate === "string" && uuidPattern.test(candidate)
        ? candidate
        : null;
  const submissionId = optionalUuid(value.submissionId);
  const requestId = optionalUuid(value.requestId);
  if (submissionId === null || requestId === null) return null;

  let submissionIds: string[] | undefined;
  if (value.submissionIds != null) {
    if (
      !Array.isArray(value.submissionIds) ||
      value.submissionIds.length > MAX_SUBMISSIONS ||
      value.submissionIds.some(
        (submission) =>
          typeof submission !== "string" || !uuidPattern.test(submission),
      )
    ) {
      return null;
    }
    submissionIds = Array.from(new Set(value.submissionIds));
  }

  const guestToken =
    value.guestToken == null
      ? undefined
      : typeof value.guestToken === "string" &&
          tokenPattern.test(value.guestToken)
        ? value.guestToken
        : null;
  if (guestToken === null) return null;

  let guestTokensBySubmissionId: Record<string, string> | undefined;
  if (value.guestTokensBySubmissionId != null) {
    if (!isRecord(value.guestTokensBySubmissionId)) return null;
    const entries = Object.entries(value.guestTokensBySubmissionId);
    if (
      entries.length > MAX_SUBMISSIONS ||
      entries.some(
        ([submission, token]) =>
          !uuidPattern.test(submission) ||
          typeof token !== "string" ||
          !tokenPattern.test(token),
      )
    ) {
      return null;
    }
    guestTokensBySubmissionId = Object.fromEntries(entries) as Record<
      string,
      string
    >;
  }

  const orderId =
    value.orderId == null
      ? undefined
      : typeof value.orderId === "string" && orderIdPattern.test(value.orderId)
        ? value.orderId
        : null;
  if (orderId === null) return null;
  if (context === "karaoke" && !requestId) return null;
  if (
    context !== "karaoke" &&
    context !== "test1000" &&
    !submissionId
  ) {
    return null;
  }

  return {
    context,
    ...(submissionId ? { submissionId } : {}),
    ...(submissionIds?.length ? { submissionIds } : {}),
    ...(guestToken ? { guestToken } : {}),
    ...(guestTokensBySubmissionId &&
    Object.keys(guestTokensBySubmissionId).length
      ? { guestTokensBySubmissionId }
      : {}),
    ...(orderId ? { orderId } : {}),
    ...(requestId ? { requestId } : {}),
  };
};

export const createInicisPopupHandoff = (
  value: InicisPopupHandoffPayload,
  options: {
    storage?: StorageLike;
    nonce?: string;
    now?: number;
  } = {},
) => {
  const payload = normalizePayload(value);
  if (!payload) throw new Error("Invalid Inicis popup handoff payload.");
  const storage = options.storage ?? window.sessionStorage;
  const nonce = options.nonce ?? safeRandomUUID();
  const now = options.now ?? Date.now();
  if (!uuidPattern.test(nonce) || !Number.isSafeInteger(now)) {
    throw new Error("Invalid Inicis popup handoff state.");
  }
  const encoded = JSON.stringify({ version: 1, createdAt: now, payload });
  if (byteLength(encoded) > MAX_STORED_BYTES) {
    throw new Error("Inicis popup handoff payload is too large.");
  }
  storage.setItem(`${HANDOFF_STORAGE_PREFIX}${nonce}`, encoded);
  return nonce;
};

export const consumeInicisPopupHandoff = (
  nonce: string,
  options: { storage?: StorageLike; now?: number } = {},
): InicisPopupHandoffPayload | null => {
  if (!uuidPattern.test(nonce)) return null;
  const storage = options.storage ?? window.sessionStorage;
  const key = `${HANDOFF_STORAGE_PREFIX}${nonce}`;
  const encoded = storage.getItem(key);
  // Delete before parsing so malformed or replayed handoffs cannot be retried.
  storage.removeItem(key);
  if (!encoded || byteLength(encoded) > MAX_STORED_BYTES) return null;

  try {
    const envelope = JSON.parse(encoded) as unknown;
    if (!isRecord(envelope) || envelope.version !== 1) return null;
    const createdAt = envelope.createdAt;
    const now = options.now ?? Date.now();
    if (
      typeof createdAt !== "number" ||
      !Number.isSafeInteger(createdAt) ||
      !Number.isSafeInteger(now) ||
      createdAt > now + 30_000 ||
      now - createdAt > HANDOFF_TTL_MS
    ) {
      return null;
    }
    return normalizePayload(envelope.payload);
  } catch {
    return null;
  }
};
