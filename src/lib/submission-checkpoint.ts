export const SUBMISSION_CHECKPOINT_VERSION = 1 as const;

export type SubmissionCheckpointKind = "ALBUM" | "MV";

export type SubmissionCheckpointStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type SubmissionCheckpointSnapshot<T> = {
  capturedAt: number;
  hash: string;
  data: T;
};

export type SubmissionCheckpointSavedSnapshot<T> =
  SubmissionCheckpointSnapshot<T> & {
    savedAt: number;
  };

export type SubmissionCheckpointRecord<T> = {
  version: typeof SUBMISSION_CHECKPOINT_VERSION;
  kind: SubmissionCheckpointKind;
  submissionId: string;
  revision: number;
  pendingServerSave: boolean;
  working: SubmissionCheckpointSnapshot<T>;
  saved: SubmissionCheckpointSavedSnapshot<T> | null;
  previousSaved: SubmissionCheckpointSavedSnapshot<T> | null;
};

export type SubmissionCheckpointCandidate<T> = {
  data: T;
  capturedAt: number;
  savedAt: number | null;
  hash: string;
  source: "working" | "saved" | "previous-saved";
};

export type SubmissionCheckpointWriteResult<T> =
  | { ok: true; record: SubmissionCheckpointRecord<T> }
  | { ok: false; error: string; record: SubmissionCheckpointRecord<T> };

export type SubmissionCheckpointInitialization<T> = {
  record: SubmissionCheckpointRecord<T>;
  recovery: SubmissionCheckpointCandidate<T> | null;
  shouldSave: boolean;
  source: "existing" | "seeded";
};

type SanitizedValue =
  | string
  | number
  | boolean
  | null
  | SanitizedValue[]
  | { [key: string]: SanitizedValue };

const defaultRecoveryToleranceMs = 2_000;

export const getSubmissionCheckpointStorageKey = (
  draftStorageKey: string,
  submissionId: string,
) =>
  `${draftStorageKey}:checkpoint:v${SUBMISSION_CHECKPOINT_VERSION}:${encodeURIComponent(
    submissionId,
  )}`;

const isPlainObject = (value: object) => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isBrowserBinary = (value: unknown) => {
  if (typeof File !== "undefined" && value instanceof File) return true;
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  return false;
};

/**
 * Checkpoints deliberately keep only JSON-compatible form state. Raw File and
 * Blob objects cannot survive a reload and are omitted; already-uploaded file
 * metadata (object key, name, size and mime) remains serializable and is kept.
 */
export const sanitizeSubmissionCheckpointData = <T>(value: T): T => {
  const ancestors = new WeakSet<object>();

  const visit = (input: unknown): SanitizedValue | undefined => {
    if (input === null) return null;
    if (typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") {
      return Number.isFinite(input) ? input : null;
    }
    if (
      typeof input === "undefined" ||
      typeof input === "function" ||
      typeof input === "symbol" ||
      typeof input === "bigint" ||
      isBrowserBinary(input)
    ) {
      return undefined;
    }
    if (input instanceof Date) return input.toISOString();
    if (typeof input !== "object") return undefined;
    if (ancestors.has(input)) return undefined;
    ancestors.add(input);

    if (Array.isArray(input)) {
      const items: SanitizedValue[] = [];
      for (const item of input) {
        const sanitized = visit(item);
        if (sanitized !== undefined) items.push(sanitized);
      }
      ancestors.delete(input);
      return items;
    }

    if (!isPlainObject(input)) {
      ancestors.delete(input);
      return undefined;
    }
    const output: Record<string, SanitizedValue> = {};
    for (const [key, item] of Object.entries(input)) {
      const sanitized = visit(item);
      if (sanitized !== undefined) output[key] = sanitized;
    }
    ancestors.delete(input);
    return output;
  };

  const sanitized = visit(value);
  if (sanitized === undefined) {
    throw new Error("저장할 수 있는 신청서 데이터가 없습니다.");
  }
  return sanitized as T;
};

const stableStringify = (value: SanitizedValue): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
};

const fnv1a = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const getSubmissionCheckpointHash = (value: unknown) => {
  const sanitized = sanitizeSubmissionCheckpointData(value) as SanitizedValue;
  const serialized = stableStringify(sanitized);
  return `fnv1a32:${fnv1a(serialized)}:${serialized.length}`;
};

const createSnapshot = <T>(data: T, capturedAt: number) => {
  const sanitized = sanitizeSubmissionCheckpointData(data);
  return {
    capturedAt,
    hash: getSubmissionCheckpointHash(sanitized),
    data: sanitized,
  } satisfies SubmissionCheckpointSnapshot<T>;
};

export const createSubmissionCheckpointRecord = <T>({
  kind,
  submissionId,
  data,
  now = Date.now(),
  serverSaved = true,
}: {
  kind: SubmissionCheckpointKind;
  submissionId: string;
  data: T;
  now?: number;
  serverSaved?: boolean;
}): SubmissionCheckpointRecord<T> => {
  const working = createSnapshot(data, now);
  return {
    version: SUBMISSION_CHECKPOINT_VERSION,
    kind,
    submissionId,
    revision: 1,
    pendingServerSave: !serverSaved,
    working,
    saved: serverSaved ? { ...working, savedAt: now } : null,
    previousSaved: null,
  };
};

export const updateSubmissionCheckpoint = <T>(
  record: SubmissionCheckpointRecord<T>,
  data: T,
  now = Date.now(),
): SubmissionCheckpointRecord<T> => {
  const working = createSnapshot(data, now);
  if (working.hash === record.working.hash) return record;

  return {
    ...record,
    revision: record.revision + 1,
    pendingServerSave: working.hash !== record.saved?.hash,
    working,
  };
};

export const markSubmissionCheckpointSaved = <T>({
  record,
  revision,
  hash,
  snapshot,
  savedAt = Date.now(),
}: {
  record: SubmissionCheckpointRecord<T>;
  revision: number;
  hash: string;
  snapshot?: SubmissionCheckpointSnapshot<T>;
  savedAt?: number;
}): SubmissionCheckpointRecord<T> => {
  const candidate =
    record.revision === revision && record.working.hash === hash
      ? record.working
      : snapshot?.hash === hash
          ? snapshot
          : record.saved?.hash === hash
            ? record.saved
            : null;
  if (!candidate) return record;

  const saved = { ...candidate, savedAt };
  const previousSaved =
    record.saved && record.saved.hash !== saved.hash
      ? record.saved
      : record.previousSaved;

  return {
    ...record,
    pendingServerSave: record.working.hash !== saved.hash,
    saved,
    previousSaved,
  };
};

export const getSubmissionCheckpointRecovery = <T>({
  record,
  currentData,
  serverUpdatedAt,
  toleranceMs = defaultRecoveryToleranceMs,
}: {
  record: SubmissionCheckpointRecord<T>;
  currentData: T;
  serverUpdatedAt?: number | null;
  toleranceMs?: number;
}): SubmissionCheckpointCandidate<T> | null => {
  const currentHash = getSubmissionCheckpointHash(currentData);
  if (currentHash === record.working.hash) return null;

  const isNewerThanServer =
    typeof serverUpdatedAt === "number" &&
    Number.isFinite(serverUpdatedAt) &&
    record.working.capturedAt > serverUpdatedAt + toleranceMs;
  const serverVersionIsUnknown = serverUpdatedAt === null || serverUpdatedAt === undefined;
  if (
    !record.pendingServerSave &&
    !isNewerThanServer &&
    !serverVersionIsUnknown
  ) {
    return null;
  }

  return {
    data: record.working.data,
    capturedAt: record.working.capturedAt,
    savedAt: record.saved?.savedAt ?? null,
    hash: record.working.hash,
    source: "working",
  };
};

/** Returns the most useful one-step rollback target. */
export const getSubmissionCheckpointPrevious = <T>(
  record: SubmissionCheckpointRecord<T>,
): SubmissionCheckpointCandidate<T> | null => {
  if (record.saved && record.working.hash !== record.saved.hash) {
    return {
      data: record.saved.data,
      capturedAt: record.saved.capturedAt,
      savedAt: record.saved.savedAt,
      hash: record.saved.hash,
      source: "saved",
    };
  }
  if (!record.previousSaved) return null;
  return {
    data: record.previousSaved.data,
    capturedAt: record.previousSaved.capturedAt,
    savedAt: record.previousSaved.savedAt,
    hash: record.previousSaved.hash,
    source: "previous-saved",
  };
};

export const revertSubmissionCheckpointToSaved = <T>(
  record: SubmissionCheckpointRecord<T>,
  now = Date.now(),
): SubmissionCheckpointRecord<T> | null => {
  const target = getSubmissionCheckpointPrevious(record);
  if (!target) return null;
  return {
    ...record,
    revision: record.revision + 1,
    pendingServerSave: target.hash !== record.saved?.hash,
    working: {
      data: target.data,
      capturedAt: now,
      hash: target.hash,
    },
  };
};

const isFiniteTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isValidStoredSnapshot = (
  value: unknown,
  requireSavedAt: boolean,
): value is SubmissionCheckpointSavedSnapshot<unknown> => {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  if (!isFiniteTimestamp(snapshot.capturedAt)) return false;
  if (typeof snapshot.hash !== "string") return false;
  if (requireSavedAt && !isFiniteTimestamp(snapshot.savedAt)) return false;
  try {
    return getSubmissionCheckpointHash(snapshot.data) === snapshot.hash;
  } catch {
    return false;
  }
};

export const parseSubmissionCheckpointRecord = <T>({
  raw,
  kind,
  submissionId,
  now = Date.now(),
  maxAgeMs = 30 * 24 * 60 * 60 * 1_000,
}: {
  raw: string;
  kind: SubmissionCheckpointKind;
  submissionId: string;
  now?: number;
  maxAgeMs?: number;
}): SubmissionCheckpointRecord<T> | null => {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value.version !== SUBMISSION_CHECKPOINT_VERSION ||
      value.kind !== kind ||
      value.submissionId !== submissionId ||
      typeof value.revision !== "number" ||
      !Number.isInteger(value.revision) ||
      value.revision < 1 ||
      typeof value.pendingServerSave !== "boolean" ||
      !isValidStoredSnapshot(value.working, false) ||
      (value.saved !== null && !isValidStoredSnapshot(value.saved, true)) ||
      (value.previousSaved !== null &&
        !isValidStoredSnapshot(value.previousSaved, true))
    ) {
      return null;
    }
    const working = value.working as SubmissionCheckpointSnapshot<T>;
    if (now - working.capturedAt > maxAgeMs) return null;
    return value as SubmissionCheckpointRecord<T>;
  } catch {
    return null;
  }
};

export const readSubmissionCheckpoint = <T>({
  storage,
  storageKey,
  kind,
  submissionId,
  now,
  maxAgeMs,
}: {
  storage: SubmissionCheckpointStorage;
  storageKey: string;
  kind: SubmissionCheckpointKind;
  submissionId: string;
  now?: number;
  maxAgeMs?: number;
}) => {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const parsed = parseSubmissionCheckpointRecord<T>({
      raw,
      kind,
      submissionId,
      now,
      maxAgeMs,
    });
    if (!parsed) {
      // Corrupt, expired, or identity-mismatched drafts must not retain PII on
      // a shared browser after they are no longer recoverable.
      storage.removeItem(storageKey);
    }
    return parsed;
  } catch {
    return null;
  }
};

export const writeSubmissionCheckpoint = <T>({
  storage,
  storageKey,
  record,
}: {
  storage: SubmissionCheckpointStorage;
  storageKey: string;
  record: SubmissionCheckpointRecord<T>;
}): SubmissionCheckpointWriteResult<T> => {
  try {
    storage.setItem(storageKey, JSON.stringify(record));
    return { ok: true, record };
  } catch {
    return {
      ok: false,
      error: "이 기기에 임시 저장하지 못했습니다.",
      record,
    };
  }
};

export const initializeSubmissionCheckpoint = <T>({
  storage,
  storageKey,
  kind,
  submissionId,
  currentData,
  serverUpdatedAt,
  now = Date.now(),
  initialDataIsServerState = true,
  maxAgeMs,
}: {
  storage: SubmissionCheckpointStorage;
  storageKey: string;
  kind: SubmissionCheckpointKind;
  submissionId: string;
  currentData: T;
  serverUpdatedAt?: number | null;
  now?: number;
  initialDataIsServerState?: boolean;
  maxAgeMs?: number;
}): SubmissionCheckpointInitialization<T> => {
  const existing = readSubmissionCheckpoint<T>({
    storage,
    storageKey,
    kind,
    submissionId,
    now,
    maxAgeMs,
  });
  if (existing) {
    const recovery = getSubmissionCheckpointRecovery({
      record: existing,
      currentData,
      serverUpdatedAt,
    });
    if (recovery) {
      // Do not write here: the caller must let the user choose before the
      // freshly-rendered (often blank) form can replace the recoverable data.
      return {
        record: existing,
        recovery,
        shouldSave: false,
        source: "existing",
      };
    }

    const currentHash = getSubmissionCheckpointHash(currentData);
    if (currentHash === existing.working.hash) {
      return {
        record: existing,
        recovery: null,
        shouldSave: existing.pendingServerSave,
        source: "existing",
      };
    }
  }

  const seeded = createSubmissionCheckpointRecord({
    kind,
    submissionId,
    data: currentData,
    now,
    serverSaved: initialDataIsServerState,
  });
  if (
    existing?.saved &&
    initialDataIsServerState &&
    existing.saved.hash !== seeded.saved?.hash
  ) {
    seeded.previousSaved = existing.saved;
  } else if (existing?.saved && !initialDataIsServerState) {
    seeded.saved = existing.saved;
    seeded.previousSaved = existing.previousSaved;
    seeded.pendingServerSave = seeded.working.hash !== existing.saved.hash;
  }
  const result = writeSubmissionCheckpoint({
    storage,
    storageKey,
    record: seeded,
  });
  return {
    record: result.record,
    recovery: null,
    shouldSave: !initialDataIsServerState,
    source: "seeded",
  };
};
