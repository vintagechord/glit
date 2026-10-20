export type RadioRequestDraft = {
  title: string;
  body: string;
  story: string;
  prompt: number;
  titleCopied: boolean;
  bodyCopied: boolean;
  listeningUrl?: string;
};

export type RadioRequestSelection = {
  track?: string;
  program?: string;
  language?: "ko" | "en";
};

export type RadioRequestManualName = { title: string; artist: string };

export type RadioRequestProgress = {
  rules?: boolean;
  privacy?: boolean;
  posted?: boolean;
  playlist?: boolean;
  postUrl?: string;
  memo?: string;
  postedAt?: string;
};

export type RadioRequestWorkspaceState = {
  stationId: string;
  step: number;
  selections: Record<string, RadioRequestSelection>;
  manualNames: Record<string, RadioRequestManualName>;
  drafts: Record<string, RadioRequestDraft>;
  progress: Record<string, RadioRequestProgress>;
};

export type RadioRequestStorageStatus = "ready" | "restored" | "saved" | "unavailable";
export type RadioRequestWorkspaceSnapshot = {
  state: RadioRequestWorkspaceState;
  storageStatus: RadioRequestStorageStatus;
};
export type RadioRequestStateUpdate<T> = T | ((previous: T) => T);
export type RadioRequestWorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StoreOptions = { getStorage?: () => RadioRequestWorkspaceStorage | null };

export const RADIO_REQUEST_WORKSPACE_LIMITS = {
  entries: 64,
  key: 4096,
  serialized: 512 * 1024,
} as const;

export function radioRequestWorkspaceKey(submissionId: string) {
  return `onside:radio-request:v1:${encodeURIComponent(submissionId)}`;
}

export function createEmptyRadioRequestWorkspace(): RadioRequestWorkspaceState {
  return { stationId: "", step: 1, selections: {}, manualNames: {}, drafts: {}, progress: {} };
}

const serverSnapshot: RadioRequestWorkspaceSnapshot = {
  state: createEmptyRadioRequestWorkspace(),
  storageStatus: "ready",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const isText = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length <= limit;
const optionalText = (value: unknown, limit: number) => value === undefined || isText(value, limit);
const safeKey = (key: string) =>
  key.length > 0 && key.length <= RADIO_REQUEST_WORKSPACE_LIMITS.key &&
  !["__proto__", "constructor", "prototype"].includes(key);

function readMap<T>(value: unknown, read: (entry: unknown) => T | null): Record<string, T> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > RADIO_REQUEST_WORKSPACE_LIMITS.entries) return null;
  const result: Record<string, T> = {};
  for (const [key, entry] of entries) {
    if (!safeKey(key)) return null;
    const parsed = read(entry);
    if (parsed === null) return null;
    result[key] = parsed;
  }
  return result;
}

function readDraft(value: unknown, restoring: boolean): RadioRequestDraft | null {
  if (!isRecord(value) || !isText(value.title, 300) || !isText(value.body, 5000) ||
      !isText(value.story, 1000) || typeof value.prompt !== "number" ||
      !Number.isInteger(value.prompt) || value.prompt < 0 || value.prompt > 20 ||
      typeof value.titleCopied !== "boolean" || typeof value.bodyCopied !== "boolean" ||
      !optionalText(value.listeningUrl, 2000)) return null;
  return {
    title: value.title, body: value.body, story: value.story, prompt: value.prompt,
    // A restored draft cannot establish what is currently on the clipboard.
    titleCopied: restoring ? false : value.titleCopied,
    bodyCopied: restoring ? false : value.bodyCopied,
    ...(value.listeningUrl !== undefined ? { listeningUrl: value.listeningUrl as string } : {}),
  };
}

function readSelection(value: unknown): RadioRequestSelection | null {
  if (!isRecord(value) || !optionalText(value.track, RADIO_REQUEST_WORKSPACE_LIMITS.key) ||
      !optionalText(value.program, 120) ||
      (value.language !== undefined && value.language !== "ko" && value.language !== "en")) return null;
  return {
    ...(value.track !== undefined ? { track: value.track as string } : {}),
    ...(value.program !== undefined ? { program: value.program as string } : {}),
    ...(value.language !== undefined ? { language: value.language as "ko" | "en" } : {}),
  };
}

function readManualName(value: unknown): RadioRequestManualName | null {
  return isRecord(value) && isText(value.title, 200) && isText(value.artist, 200)
    ? { title: value.title, artist: value.artist } : null;
}

function readProgress(value: unknown): RadioRequestProgress | null {
  if (!isRecord(value) || !optionalText(value.postUrl, 2000) || !optionalText(value.memo, 1000)) return null;
  const result: RadioRequestProgress = {};
  for (const key of ["rules", "privacy", "posted", "playlist"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return null;
    if (typeof value[key] === "boolean") result[key] = value[key];
  }
  if (value.postedAt !== undefined) {
    if (!isText(value.postedAt, 32) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.postedAt) ||
        !Number.isFinite(Date.parse(value.postedAt))) return null;
    result.postedAt = value.postedAt;
  }
  if (value.postUrl !== undefined) result.postUrl = value.postUrl as string;
  if (value.memo !== undefined) result.memo = value.memo as string;
  return result;
}

function readState(value: unknown, restoring: boolean): RadioRequestWorkspaceState | null {
  if (!isRecord(value) || !isText(value.stationId, 256) ||
      typeof value.step !== "number" || !Number.isInteger(value.step) || value.step < 1 || value.step > 4) return null;
  const selections = readMap(value.selections, readSelection);
  const manualNames = readMap(value.manualNames, readManualName);
  const drafts = readMap(value.drafts, entry => readDraft(entry, restoring));
  const progress = readMap(value.progress, readProgress);
  if (!selections || !manualNames || !drafts || !progress) return null;
  return { stationId: value.stationId, step: value.step, selections, manualNames, drafts, progress };
}

/** Session data is UI state only. It never supplies review eligibility or authorization. */
export function parseRadioRequestWorkspace(raw: string, submissionId: string): RadioRequestWorkspaceState | null {
  if (raw.length > RADIO_REQUEST_WORKSPACE_LIMITS.serialized) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || value.submissionId !== submissionId) return null;
    return readState(value.state, true);
  } catch {
    return null;
  }
}

function browserStorage(): RadioRequestWorkspaceStorage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

export function createRadioRequestWorkspaceStore(submissionId: string, options: StoreOptions = {}) {
  const key = radioRequestWorkspaceKey(submissionId);
  const getStorage = options.getStorage ?? browserStorage;
  const listeners = new Set<() => void>();
  let snapshot: RadioRequestWorkspaceSnapshot = {
    state: createEmptyRadioRequestWorkspace(),
    storageStatus: "ready",
  };
  try {
    const storage = getStorage();
    if (!storage) {
      snapshot = { ...snapshot, storageStatus: "unavailable" };
    } else {
      const raw = storage.getItem(key);
      if (raw !== null) {
        const restored = parseRadioRequestWorkspace(raw, submissionId);
        snapshot = restored
          ? { state: restored, storageStatus: "restored" }
          : { ...snapshot, storageStatus: "unavailable" };
      }
    }
  } catch {
    snapshot = { ...snapshot, storageStatus: "unavailable" };
  }

  function persist(state: RadioRequestWorkspaceState): RadioRequestStorageStatus {
    try {
      // Validate a copy for storage; never truncate or discard active user input.
      const safeState = readState(state, false);
      if (!safeState) return "unavailable";
      const serialized = JSON.stringify({ version: 1, submissionId, state: safeState });
      if (serialized.length > RADIO_REQUEST_WORKSPACE_LIMITS.serialized) return "unavailable";
      const storage = getStorage();
      if (!storage) return "unavailable";
      storage.setItem(key, serialized);
      return "saved";
    } catch {
      return "unavailable";
    }
  }

  function publish(state: RadioRequestWorkspaceState, storageStatus: RadioRequestStorageStatus) {
    snapshot = { state, storageStatus };
    listeners.forEach(listener => listener());
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setField<K extends keyof RadioRequestWorkspaceState>(field: K, update: RadioRequestStateUpdate<RadioRequestWorkspaceState[K]>) {
      const previous = snapshot.state[field];
      const next = typeof update === "function"
        ? (update as (value: RadioRequestWorkspaceState[K]) => RadioRequestWorkspaceState[K])(previous)
        : update;
      if (Object.is(previous, next)) return;
      const state = { ...snapshot.state, [field]: next };
      publish(state, persist(state));
    },
    resetWorkspace() {
      let storageStatus: RadioRequestStorageStatus = "ready";
      try {
        const storage = getStorage();
        if (storage) storage.removeItem(key);
        else storageStatus = "unavailable";
      } catch {
        storageStatus = "unavailable";
      }
      publish(createEmptyRadioRequestWorkspace(), storageStatus);
    },
  };
}

export type RadioRequestWorkspaceStore = ReturnType<typeof createRadioRequestWorkspaceStore>;

/** One registry belongs to one browser tab; observers of the same submission share updates. */
export function createRadioRequestWorkspaceRegistry(options: StoreOptions = {}) {
  const stores = new Map<string, RadioRequestWorkspaceStore>();
  return {
    getStore(submissionId: string) {
      let store = stores.get(submissionId);
      if (!store) {
        store = createRadioRequestWorkspaceStore(submissionId, options);
        stores.set(submissionId, store);
      }
      return store;
    },
  };
}
