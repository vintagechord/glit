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

export type SignedPartUrls = {
  urls: Array<{ partNumber: number; url: string }>;
  expiresInSeconds?: number;
};

/** An error that more attempts cannot fix (the grant is gone, refused or
 * expired, or the browser cannot read the part receipt). */
export const isFinalUploadError = (error: unknown) => {
  const { status, final } = (error ?? {}) as { status?: number; final?: boolean };
  return final === true || [400, 401, 403, 404, 409, 410].includes(status ?? 0);
};

/** Minimum time a signed part URL must still be valid when its PUT starts. */
const SIGNED_URL_MARGIN_MS = 60_000;
export const MULTIPART_SIGN_BATCH = 50;
export const MULTIPART_PART_ATTEMPTS = 8;

/** 1s, 2s, 4s … capped at 30s: about 90 seconds of patience per part. */
export const multipartRetryDelayMs = (attempt: number) =>
  Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wait (up to two minutes) for the browser to report a connection again. */
export const waitUntilOnline = (maxWaitMs = 120_000) =>
  new Promise<void>((resolve) => {
    if (typeof window === "undefined" || typeof navigator === "undefined" || navigator.onLine !== false) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      resolve();
    };
    const timer = setTimeout(done, maxWaitMs);
    window.addEventListener("online", done);
  });

/**
 * Upload the remaining parts of a multipart upload.
 *
 * URLs are signed just before they are needed, a batch at a time, and are
 * re-signed once they are close to expiry, so a slow multi-gigabyte upload
 * never PUTs to an expired URL and never asks for one URL per part (which
 * the signing rate limit would refuse). A failed part is retried with a
 * fresh URL and growing pauses; a dropped connection waits for "online".
 */
export async function uploadMultipartParts(options: {
  partNumbers: number[];
  concurrency: number;
  sign: (partNumbers: number[]) => Promise<SignedPartUrls>;
  putPart: (partNumber: number, url: string) => Promise<void>;
  batchSize?: number;
  maxAttempts?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  waitForOnline?: () => Promise<void>;
}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? pause;
  const waitForOnline = options.waitForOnline ?? (() => waitUntilOnline());
  const batchSize = Math.max(1, options.batchSize ?? MULTIPART_SIGN_BATCH);
  const maxAttempts = Math.max(1, options.maxAttempts ?? MULTIPART_PART_ATTEMPTS);
  const order = options.partNumbers;
  const pending = new Set(order);
  const urls = new Map<number, { url: string; usableUntil: number }>();
  let signing: Promise<void> | null = null;

  const freshUrl = (partNumber: number) => {
    const cached = urls.get(partNumber);
    return cached && cached.usableUntil > now() ? cached.url : null;
  };

  const urlFor = async (partNumber: number) => {
    for (let signedForThisPart = false; ; ) {
      const cached = freshUrl(partNumber);
      if (cached) return cached;
      if (signing) {
        await signing;
        continue;
      }
      if (signedForThisPart) throw new Error("업로드 URL을 생성할 수 없습니다.");
      const start = Math.max(0, order.indexOf(partNumber));
      const batch = [
        partNumber,
        ...order.slice(start).filter((candidate) =>
          candidate !== partNumber && pending.has(candidate) && !freshUrl(candidate)),
      ].slice(0, batchSize);
      const requestedAt = now();
      const current = options.sign(batch).then((signed) => {
        const lifetimeMs = Math.max(0, (signed.expiresInSeconds ?? 600) * 1_000);
        const usableUntil = requestedAt + Math.max(10_000, lifetimeMs - SIGNED_URL_MARGIN_MS);
        for (const item of signed.urls) urls.set(item.partNumber, { url: item.url, usableUntil });
      });
      signing = current;
      signedForThisPart = true;
      try {
        await current;
      } finally {
        if (signing === current) signing = null;
      }
    }
  };

  await runMultipartWorkers(order, options.concurrency, async (partNumber) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await options.putPart(partNumber, await urlFor(partNumber));
        pending.delete(partNumber);
        return;
      } catch (error) {
        // An expired or refused signature is replaced on the next attempt.
        urls.delete(partNumber);
        if (attempt >= maxAttempts || isFinalUploadError(error)) throw error;
        await waitForOnline();
        await sleep(multipartRetryDelayMs(attempt));
      }
    }
  });
}

/**
 * Send a completion request again after a network failure, a timeout, a 429
 * or a 5xx answer. Completion is idempotent (the server replays a stored
 * receipt for the same manifest), so a retry can never store a file twice.
 */
export async function requestWithRetry(
  send: () => Promise<Response>,
  options: { delaysMs?: number[]; sleep?: (ms: number) => Promise<void>; waitForOnline?: () => Promise<void> } = {},
) {
  const delays = options.delaysMs ?? [2_000, 5_000, 10_000, 20_000];
  const sleep = options.sleep ?? pause;
  const waitForOnline = options.waitForOnline ?? (() => waitUntilOnline());
  for (let attempt = 0; ; attempt += 1) {
    const last = attempt >= delays.length;
    try {
      const response = await send();
      const transient = response.status >= 500 || response.status === 429 || response.status === 408;
      if (!transient || last) return response;
    } catch (error) {
      if (last) throw error;
    }
    await waitForOnline();
    await sleep(delays[attempt]);
  }
}
