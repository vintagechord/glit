/** Stop awaiting stalled I/O as well as signalling cooperative network clients. */
export function awaitReviewAbort<T>(task: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(task);
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(task).then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
    if (signal.aborted) abort();
  });
}
