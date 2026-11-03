/** Browser-side retry rules for supplement uploads. */

export const supplementResumeKey = (
  submissionId: string,
  requestId: string,
  file: Pick<File, "name" | "size" | "lastModified">,
) => `supplement-multipart:${submissionId}:${requestId}:${file.name}:${file.size}:${file.lastModified}`;

export const httpStatus = (cause: unknown) => {
  const status = (cause as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : 0;
};

/** Lost connections, timeouts, server errors and rate limits may pass;
 * a validation, permission or state error will not. */
export const isTransientFailure = (cause: unknown) => {
  const status = httpStatus(cause);
  if (status) return status >= 500 || status === 408 || status === 429;
  return cause instanceof Error && ["TypeError", "TimeoutError"].includes(cause.name);
};

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });

/** Retries transient failures with exponential backoff (1s, 2s, 4s, 8s…). */
export async function retryTransient<T>(
  run: () => Promise<T>,
  signal: AbortSignal,
  attempts: number,
  baseDelayMs = 1_000,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (cause) {
      if (signal.aborted || attempt >= attempts || !isTransientFailure(cause)) throw cause;
      const delay = Math.min(8 * baseDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await pause(delay + Math.floor(Math.random() * (baseDelayMs / 4)), signal);
    }
  }
}
