/** Bound small API requests, including reading their response body.
 * Do not use this deadline for large file transfers. Requests are never retried.
 */
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 20_000,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (input instanceof Request) signals.push(input.signal);
  if (init?.signal) signals.push(init.signal);

  // Keep the deadline active after headers arrive: json()/text() can stall too.
  // AbortSignal.timeout uses an unreferenced timer on the server.
  return fetcher(input, { ...init, signal: AbortSignal.any(signals) });
}
