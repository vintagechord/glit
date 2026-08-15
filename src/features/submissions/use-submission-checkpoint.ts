"use client";

import * as React from "react";

import {
  createSubmissionCheckpointRecord,
  getSubmissionCheckpointHash,
  getSubmissionCheckpointPrevious,
  initializeSubmissionCheckpoint,
  markSubmissionCheckpointSaved,
  revertSubmissionCheckpointToSaved,
  sanitizeSubmissionCheckpointData,
  updateSubmissionCheckpoint,
  writeSubmissionCheckpoint,
  type SubmissionCheckpointCandidate,
  type SubmissionCheckpointKind,
  type SubmissionCheckpointRecord,
  type SubmissionCheckpointSnapshot,
  type SubmissionCheckpointStorage,
} from "@/lib/submission-checkpoint";

export type SubmissionCheckpointStatus =
  | "idle"
  | "recovery"
  | "local"
  | "saving"
  | "saved"
  | "error";

export type SubmissionCheckpointSaveReason = "auto" | "retry" | "flush";

export type SubmissionCheckpointSaveResult =
  | void
  | {
      ok?: boolean;
      error?: string;
      savedAt?: number;
      /**
       * Keep the snapshot pending locally without reporting an error. This is
       * used while editing an existing cart item: the original SUBMITTED row
       * must stay payable until the user explicitly confirms the edit.
       */
      serverSaved?: boolean;
    };

export type SubmissionCheckpointViewState = {
  status: SubmissionCheckpointStatus;
  error: string | null;
  lastSavedAt: number | null;
};

export type UseSubmissionCheckpointOptions<T> = {
  kind: SubmissionCheckpointKind;
  storageKey: string | null;
  submissionId: string | null;
  snapshot: T;
  enabled: boolean;
  save: (
    snapshot: T,
    context: { reason: SubmissionCheckpointSaveReason },
  ) => Promise<SubmissionCheckpointSaveResult>;
  onRecover: (snapshot: T) => void;
  serverUpdatedAt?: string | number | Date | null;
  debounceMs?: number;
  maxAgeMs?: number;
  initialDataIsServerState?: boolean;
  storage?: SubmissionCheckpointStorage;
};

const defaultDebounceMs = 1_200;

const toTimestamp = (value: string | number | Date | null | undefined) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value !== "string" || !value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const getBrowserStorage = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const normalizeSaveResult = (result: SubmissionCheckpointSaveResult) => {
  if (result && (result.ok === false || result.error)) {
    return {
      ok: false as const,
      error: result.error || "신청서를 저장하지 못했습니다.",
      savedAt: null,
    };
  }
  return {
    ok: true as const,
    error: null,
    savedAt: result?.savedAt ?? Date.now(),
    serverSaved: result?.serverSaved !== false,
  };
};

export function useSubmissionCheckpoint<T>({
  kind,
  storageKey,
  submissionId,
  snapshot,
  enabled,
  save,
  onRecover,
  serverUpdatedAt,
  debounceMs = defaultDebounceMs,
  maxAgeMs,
  initialDataIsServerState = true,
  storage: providedStorage,
}: UseSubmissionCheckpointOptions<T>) {
  const [view, setView] = React.useState<SubmissionCheckpointViewState>({
    status: "idle",
    error: null,
    lastSavedAt: null,
  });
  const [recovery, setRecovery] = React.useState<
    SubmissionCheckpointCandidate<T> | null
  >(null);
  const [previous, setPrevious] = React.useState<
    SubmissionCheckpointCandidate<T> | null
  >(null);
  const [initializationRevision, setInitializationRevision] = React.useState(0);

  const mountedRef = React.useRef(false);
  const recordRef = React.useRef<SubmissionCheckpointRecord<T> | null>(null);
  const initializedIdentityRef = React.useRef<string | null>(null);
  const blockedForRecoveryRef = React.useRef(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = React.useRef<Promise<boolean> | null>(null);
  const exclusiveQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const exclusiveDepthRef = React.useRef(0);
  const saveLatestRef = React.useRef<
    (reason: SubmissionCheckpointSaveReason) => Promise<boolean>
  >(async () => false);
  const snapshotRef = React.useRef(snapshot);
  const saveRef = React.useRef(save);
  const onRecoverRef = React.useRef(onRecover);

  snapshotRef.current = snapshot;
  saveRef.current = save;
  onRecoverRef.current = onRecover;

  const identity =
    enabled && storageKey && submissionId
      ? `${kind}:${submissionId}:${storageKey}`
      : null;
  const serverUpdatedAtTimestamp = toTimestamp(serverUpdatedAt);
  const activeConfigRef = React.useRef({
    identity,
    kind,
    storageKey,
    submissionId,
    debounceMs,
    storage: providedStorage ?? null,
  });
  activeConfigRef.current = {
    identity,
    kind,
    storageKey,
    submissionId,
    debounceMs,
    storage: providedStorage ?? null,
  };

  const snapshotHash = React.useMemo(() => {
    try {
      return getSubmissionCheckpointHash(snapshot);
    } catch {
      return null;
    }
  }, [snapshot]);

  const getStorage = React.useCallback(
    () => activeConfigRef.current.storage ?? getBrowserStorage(),
    [],
  );

  const clearTimer = React.useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const updateRecordView = React.useCallback(
    (record: SubmissionCheckpointRecord<T>) => {
      recordRef.current = record;
      if (!mountedRef.current) return;
      setPrevious(getSubmissionCheckpointPrevious(record));
    },
    [],
  );

  const persist = React.useCallback(
    (record: SubmissionCheckpointRecord<T>) => {
      const config = activeConfigRef.current;
      const storage = getStorage();
      if (!storage || !config.storageKey) {
        return { ok: false as const, error: "브라우저 임시 저장을 사용할 수 없습니다." };
      }
      const result = writeSubmissionCheckpoint({
        storage,
        storageKey: config.storageKey,
        record,
      });
      updateRecordView(record);
      return result.ok
        ? { ok: true as const, error: null }
        : { ok: false as const, error: result.error };
    },
    [getStorage, updateRecordView],
  );

  const scheduleSave = React.useCallback(
    (delayMs?: number) => {
      clearTimer();
      const record = recordRef.current;
      if (
        !record?.pendingServerSave ||
        blockedForRecoveryRef.current ||
        exclusiveDepthRef.current > 0
      ) {
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void saveLatestRef.current("auto");
      }, Math.max(0, delayMs ?? activeConfigRef.current.debounceMs));
    },
    [clearTimer],
  );

  const saveLatest = React.useCallback(
    async (reason: SubmissionCheckpointSaveReason): Promise<boolean> => {
      clearTimer();
      if (blockedForRecoveryRef.current) return false;
      if (exclusiveDepthRef.current > 0) return false;

      if (inFlightRef.current) {
        await inFlightRef.current;
        const latest = recordRef.current;
        if (!latest?.pendingServerSave) return true;
        return saveLatestRef.current(reason);
      }

      const record = recordRef.current;
      const config = activeConfigRef.current;
      if (
        !record ||
        !record.pendingServerSave ||
        !config.identity ||
        !config.storageKey ||
        !config.submissionId
      ) {
        return Boolean(record && !record.pendingServerSave);
      }

      const candidate: SubmissionCheckpointSnapshot<T> = {
        ...record.working,
      };
      const candidateRevision = record.revision;
      const candidateIdentity = config.identity;
      if (mountedRef.current) {
        setView((current) => ({
          ...current,
          status: "saving",
          error: null,
        }));
      }

      const request = (async () => {
        try {
          return normalizeSaveResult(
            await saveRef.current(candidate.data, { reason }),
          );
        } catch (error) {
          return {
            ok: false as const,
            error:
              error instanceof Error && error.message
                ? error.message
                : "신청서를 저장하지 못했습니다.",
            savedAt: null,
          };
        }
      })();
      inFlightRef.current = request.then((result) => result.ok);
      const result = await request;
      inFlightRef.current = null;

      if (activeConfigRef.current.identity !== candidateIdentity) {
        return result.ok;
      }

      const latest = recordRef.current;
      if (!latest) return result.ok;
      if (!result.ok) {
        if (mountedRef.current) {
          setView((current) => ({
            ...current,
            status:
              latest.working.hash === candidate.hash ? "error" : "local",
            error:
              latest.working.hash === candidate.hash ? result.error : null,
          }));
        }
        if (latest.working.hash !== candidate.hash) scheduleSave(0);
        return false;
      }

      if (!result.serverSaved) {
        // The browser copy is intentionally the only updated copy for now.
        // Do not mark the server baseline as saved and do not immediately
        // reschedule the same deferred write in a tight loop.
        if (mountedRef.current) {
          setView((current) => ({
            status: "local",
            error: null,
            lastSavedAt: current.lastSavedAt,
          }));
        }
        return true;
      }

      const savedRecord = markSubmissionCheckpointSaved({
        record: latest,
        revision: candidateRevision,
        hash: candidate.hash,
        snapshot: candidate,
        savedAt: result.savedAt ?? Date.now(),
      });
      const persisted = persist(savedRecord);
      if (!persisted.ok) {
        const compactRecord = {
          ...savedRecord,
          previousSaved: null,
        };
        const compactResult = persist(compactRecord);
        if (!compactResult.ok) {
          const storage = getStorage();
          const storageKey = activeConfigRef.current.storageKey;
          if (storage && storageKey) {
            try {
              storage.removeItem(storageKey);
            } catch {
              // The server is saved; avoid presenting a stale local recovery.
            }
          }
        }
      }
      if (mountedRef.current) {
        setView({
          status: savedRecord.pendingServerSave ? "local" : "saved",
          error: null,
          lastSavedAt: result.savedAt ?? Date.now(),
        });
      }
      if (savedRecord.pendingServerSave) scheduleSave(0);
      return true;
    },
    [clearTimer, getStorage, persist, scheduleSave],
  );
  saveLatestRef.current = saveLatest;

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  React.useEffect(() => {
    clearTimer();
    initializedIdentityRef.current = null;
    blockedForRecoveryRef.current = false;
    recordRef.current = null;
    setRecovery(null);
    setPrevious(null);

    if (!identity || !storageKey || !submissionId) {
      setView({ status: "idle", error: null, lastSavedAt: null });
      return;
    }
    const storage = getStorage();
    if (!storage) {
      setView({
        status: "error",
        error: "브라우저 임시 저장을 사용할 수 없습니다.",
        lastSavedAt: null,
      });
      return;
    }

    const initialized = initializeSubmissionCheckpoint({
      storage,
      storageKey,
      kind,
      submissionId,
      currentData: snapshotRef.current,
      serverUpdatedAt: serverUpdatedAtTimestamp,
      initialDataIsServerState,
      maxAgeMs,
    });
    initializedIdentityRef.current = identity;
    recordRef.current = initialized.record;
    setPrevious(getSubmissionCheckpointPrevious(initialized.record));
    setInitializationRevision((current) => current + 1);

    if (initialized.recovery) {
      blockedForRecoveryRef.current = true;
      setRecovery(initialized.recovery);
      setView({
        status: "recovery",
        error: null,
        lastSavedAt: initialized.record.saved?.savedAt ?? null,
      });
      return;
    }

    setView({
      status: initialized.shouldSave ? "local" : "saved",
      error: null,
      lastSavedAt: initialized.record.saved?.savedAt ?? null,
    });
    if (initialized.shouldSave) scheduleSave();
  }, [
    clearTimer,
    getStorage,
    identity,
    initialDataIsServerState,
    kind,
    maxAgeMs,
    scheduleSave,
    serverUpdatedAtTimestamp,
    storageKey,
    submissionId,
  ]);

  React.useEffect(() => {
    if (
      !identity ||
      initializedIdentityRef.current !== identity ||
      blockedForRecoveryRef.current ||
      !recordRef.current ||
      !snapshotHash
    ) {
      return;
    }
    if (recordRef.current.working.hash === snapshotHash) return;

    const next = updateSubmissionCheckpoint(
      recordRef.current,
      snapshotRef.current,
    );
    const result = persist(next);
    if (next.pendingServerSave) {
      setView((current) => ({
        status: result.ok ? "local" : "error",
        error: result.error,
        lastSavedAt: current.lastSavedAt,
      }));
      scheduleSave();
    } else {
      setView({
        status: "saved",
        error: null,
        lastSavedAt: next.saved?.savedAt ?? null,
      });
    }
  }, [
    identity,
    initializationRevision,
    persist,
    scheduleSave,
    snapshotHash,
  ]);

  React.useEffect(() => {
    const handleOnline = () => {
      if (recordRef.current?.pendingServerSave) {
        void saveLatestRef.current("retry");
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  const retry = React.useCallback(
    () => saveLatestRef.current("retry"),
    [],
  );
  const flush = React.useCallback(
    () => saveLatestRef.current("flush"),
    [],
  );

  const recover = React.useCallback(() => {
    if (!recovery || !recordRef.current) return;
    blockedForRecoveryRef.current = false;
    setRecovery(null);
    onRecoverRef.current(recovery.data);
    setView((current) => ({
      status: recordRef.current?.pendingServerSave ? "local" : "saved",
      error: null,
      lastSavedAt: current.lastSavedAt,
    }));
    if (recordRef.current.pendingServerSave) scheduleSave(0);
  }, [recovery, scheduleSave]);

  const discardRecovery = React.useCallback(() => {
    const config = activeConfigRef.current;
    const current = recordRef.current;
    if (!config.submissionId) return;
    const seeded = createSubmissionCheckpointRecord({
      kind: config.kind,
      submissionId: config.submissionId,
      data: snapshotRef.current,
      serverSaved: true,
    });
    if (current?.saved && current.saved.hash !== seeded.saved?.hash) {
      seeded.previousSaved = current.saved;
    }
    blockedForRecoveryRef.current = false;
    setRecovery(null);
    persist(seeded);
    setView({
      status: "saved",
      error: null,
      lastSavedAt: seeded.saved?.savedAt ?? null,
    });
  }, [persist]);

  const revertToSaved = React.useCallback(() => {
    const current = recordRef.current;
    if (!current) return false;
    const reverted = revertSubmissionCheckpointToSaved(current);
    if (!reverted) return false;
    const result = persist(reverted);
    onRecoverRef.current(reverted.working.data);
    setView((state) => ({
      status: reverted.pendingServerSave
        ? result.ok
          ? "local"
          : "error"
        : "saved",
      error: result.error,
      lastSavedAt: state.lastSavedAt,
    }));
    if (reverted.pendingServerSave) scheduleSave(0);
    return true;
  }, [persist, scheduleSave]);

  const markSaved = React.useCallback(
    (data: T = snapshotRef.current, savedAt = Date.now()) => {
      const current = recordRef.current;
      if (!current) return;
      const safeData = sanitizeSubmissionCheckpointData(data);
      const candidate: SubmissionCheckpointSnapshot<T> = {
        data: safeData,
        capturedAt: savedAt,
        hash: getSubmissionCheckpointHash(safeData),
      };
      const saved = markSubmissionCheckpointSaved({
        record: current,
        revision: current.revision,
        hash: candidate.hash,
        snapshot: candidate,
        savedAt,
      });
      const result = persist(saved);
      setView({
        status: saved.pendingServerSave
          ? result.ok
            ? "local"
            : "error"
          : "saved",
        error: result.error,
        lastSavedAt: savedAt,
      });
      if (saved.pendingServerSave) scheduleSave(0);
    },
    [persist, scheduleSave],
  );

  const runExclusive = React.useCallback(
    async <R,>(task: () => Promise<R>) => {
      clearTimer();
      exclusiveDepthRef.current += 1;
      const previousTask = exclusiveQueueRef.current;
      let releaseTask!: () => void;
      const currentTask = new Promise<void>((resolve) => {
        releaseTask = resolve;
      });
      exclusiveQueueRef.current = previousTask
        .catch(() => undefined)
        .then(() => currentTask);
      try {
        await previousTask.catch(() => undefined);
        if (inFlightRef.current) await inFlightRef.current;
        return await task();
      } finally {
        releaseTask();
        exclusiveDepthRef.current = Math.max(0, exclusiveDepthRef.current - 1);
        if (recordRef.current?.pendingServerSave) scheduleSave();
      }
    },
    [clearTimer, scheduleSave],
  );

  const clear = React.useCallback(() => {
    clearTimer();
    const config = activeConfigRef.current;
    const storage = getStorage();
    if (storage && config.storageKey) {
      try {
        storage.removeItem(config.storageKey);
      } catch {
        // The exact checkpoint is best-effort cleanup after final submission.
      }
    }
    recordRef.current = null;
    blockedForRecoveryRef.current = false;
    setRecovery(null);
    setPrevious(null);
    setView({ status: "idle", error: null, lastSavedAt: null });
  }, [clearTimer, getStorage]);

  return {
    ...view,
    isDirty: Boolean(recordRef.current?.pendingServerSave),
    recovery,
    previous,
    retry,
    flush,
    recover,
    discardRecovery,
    revertToSaved,
    markSaved,
    runExclusive,
    clear,
  };
}
