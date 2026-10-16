export type MultipartResumeState = {
  grantId: string;
  uploadId: string;
  key: string;
  partSize: number;
  parts: Record<number, string>;
  createdAt: number;
};

const resumeMaxAgeMs = 24 * 60 * 60 * 1_000;

export function clearMultipartResumeState(resumeKey: string) {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(resumeKey);
  } catch {
    // Browser storage is optional; cleanup must not turn an uploaded file into a failure.
  }
}

export function loadMultipartResumeState(resumeKey: string): MultipartResumeState | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(resumeKey);
    if (!raw) return null;
    const state = JSON.parse(raw) as MultipartResumeState | null;
    const valid = state &&
      typeof state.grantId === "string" && state.grantId.length > 0 &&
      typeof state.uploadId === "string" && state.uploadId.length > 0 &&
      typeof state.key === "string" && state.key.length > 0 &&
      Number.isSafeInteger(state.partSize) && state.partSize > 0 &&
      Number.isFinite(state.createdAt) && state.createdAt <= Date.now() &&
      Date.now() - state.createdAt <= resumeMaxAgeMs &&
      state.parts && typeof state.parts === "object" && !Array.isArray(state.parts) &&
      Object.entries(state.parts).every(([part, etag]) =>
        /^[1-9]\d*$/.test(part) && Number(part) <= 10_000 &&
        typeof etag === "string" && etag.length > 0,
      );
    if (valid) return state;
    clearMultipartResumeState(resumeKey);
  } catch {
    clearMultipartResumeState(resumeKey);
  }
  return null;
}

export function saveMultipartResumeState(resumeKey: string, state: MultipartResumeState) {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(resumeKey, JSON.stringify(state));
    }
  } catch {
    // Uploads still work when private browsing or storage limits prevent resuming.
  }
}

/** Finish active workers before exposing a retry, so old callbacks cannot race it. */
export async function runMultipartWorkers(
  partNumbers: number[],
  concurrency: number,
  uploadPart: (partNumber: number) => Promise<void>,
) {
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  const count = Math.min(Math.max(1, Math.trunc(concurrency) || 1), partNumbers.length);
  await Promise.all(Array.from({ length: count }, async () => {
    while (!failed && cursor < partNumbers.length) {
      const partNumber = partNumbers[cursor++];
      try {
        await uploadPart(partNumber);
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  }));
  if (failed) throw failure;
}
