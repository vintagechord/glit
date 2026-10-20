"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  createRadioRequestWorkspaceRegistry,
  createRadioRequestWorkspaceStore,
  type RadioRequestStateUpdate,
  type RadioRequestWorkspaceState,
} from "@/lib/radio-request-workspace";

const browserRegistry = createRadioRequestWorkspaceRegistry();

export function useRadioRequestWorkspace(submissionId: string) {
  const store = useMemo(
    // Never put a server-rendered user's state in the shared module registry.
    () => typeof window === "undefined"
      ? createRadioRequestWorkspaceStore(submissionId, { getStorage: () => null })
      : browserRegistry.getStore(submissionId),
    [submissionId],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const setters = useMemo(() => ({
    setStationId: (update: RadioRequestStateUpdate<string>) => store.setField("stationId", update),
    setStep: (update: RadioRequestStateUpdate<number>) => store.setField("step", update),
    setSelections: (update: RadioRequestStateUpdate<RadioRequestWorkspaceState["selections"]>) => store.setField("selections", update),
    setManualNames: (update: RadioRequestStateUpdate<RadioRequestWorkspaceState["manualNames"]>) => store.setField("manualNames", update),
    setDrafts: (update: RadioRequestStateUpdate<RadioRequestWorkspaceState["drafts"]>) => store.setField("drafts", update),
    setProgress: (update: RadioRequestStateUpdate<RadioRequestWorkspaceState["progress"]>) => store.setField("progress", update),
    resetWorkspace: store.resetWorkspace,
  }), [store]);
  return { ...snapshot.state, storageStatus: snapshot.storageStatus, ...setters };
}
