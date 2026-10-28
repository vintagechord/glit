import type { DashboardStatusData } from "@/lib/dashboard-status";

type RequestEntry = {
  controller: AbortController;
  promise: Promise<DashboardStatusData>;
  consumers: Set<symbol>;
  bypassCache: boolean;
  settled: boolean;
};

const aborted = () => new DOMException("The request was cancelled.", "AbortError");

export function createDashboardStatusResource({
  fetcher = (input, init) => fetch(input, init),
  now = Date.now,
  cacheTtlMs = 5_000,
  timeoutMs = 12_000,
}: {
  fetcher?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
  timeoutMs?: number;
} = {}) {
  const cache = new Map<string, { expiresAt: number; receivedAt: number; data: DashboardStatusData }>();
  const requests = new Map<string, RequestEntry>();

  function peek(viewerId: string) {
    const entry = cache.get(viewerId);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(viewerId);
      return null;
    }
    return entry.data;
  }

  function seed(viewerId: string, data: DashboardStatusData, receivedAt = now()) {
    const observedAt = Math.min(receivedAt, now());
    if ((cache.get(viewerId)?.receivedAt ?? -Infinity) > observedAt) return;
    cache.delete(viewerId);
    cache.set(viewerId, { data, receivedAt: observedAt, expiresAt: observedAt + cacheTtlMs });
    while (cache.size > 20) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  function subscribe(entry: RequestEntry, signal: AbortSignal) {
    if (signal.aborted) return Promise.reject(aborted());
    return new Promise<DashboardStatusData>((resolve, reject) => {
      const consumer = Symbol();
      entry.consumers.add(consumer);
      const cleanup = () => {
        signal.removeEventListener("abort", cancel);
        entry.consumers.delete(consumer);
        if (!entry.settled && entry.consumers.size === 0) entry.controller.abort();
      };
      const cancel = () => { cleanup(); reject(aborted()); };
      signal.addEventListener("abort", cancel, { once: true });
      entry.promise.then(
        (data) => { cleanup(); resolve(data); },
        (error) => { cleanup(); reject(error); },
      );
    });
  }

  async function read(
    viewerId: string,
    { signal, bypassCache = false }: { signal: AbortSignal; bypassCache?: boolean },
  ): Promise<DashboardStatusData> {
    if (signal.aborted) throw aborted();
    const cached = bypassCache ? null : peek(viewerId);
    if (cached) return cached;

    const pending = requests.get(viewerId);
    if (pending && !pending.controller.signal.aborted) {
      if (!bypassCache || pending.bypassCache) return subscribe(pending, signal);
      // A payment-return refresh must start after an older ordinary read,
      // without issuing both requests at once or accepting its older snapshot.
      await subscribe(pending, signal).catch((error) => {
        if (signal.aborted) throw error;
      });
      return read(viewerId, { signal, bypassCache: true });
    }

    const controller = new AbortController();
    const cacheAtStart = cache.get(viewerId);
    const entry: RequestEntry = {
      controller, consumers: new Set(), bypassCache, settled: false,
      promise: Promise.resolve({} as DashboardStatusData),
    };
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    entry.promise = (async () => {
      try {
        const response = await fetcher(
          bypassCache ? "/api/dashboard/status?refresh=1" : "/api/dashboard/status",
          { cache: "no-store", signal: controller.signal },
        );
        const data = await response.json().catch(() => null) as
          | (DashboardStatusData & { error?: string; viewerId?: string })
          | null;
        if (!response.ok || !data || data.error) {
          if (response.status === 401) cache.delete(viewerId);
          throw Object.assign(new Error(data?.error || "진행 현황을 불러오지 못했습니다."), { status: response.status });
        }
        // Another browser tab can change the session cookie while this page
        // still belongs to its previous viewer. Never label that response as
        // the old account's data or retain it under the old cache key.
        if (data.viewerId !== viewerId) {
          cache.delete(viewerId);
          throw Object.assign(new Error("로그인 정보가 변경되어 다시 확인하고 있습니다."), { status: 401 });
        }
        if (requests.get(viewerId) === entry && !controller.signal.aborted && cache.get(viewerId) === cacheAtStart) seed(viewerId, data);
        return data;
      } catch (error) {
        if (controller.signal.aborted && entry.consumers.size > 0) {
          throw new Error("진행 현황 응답이 지연되고 있습니다. 다시 시도해주세요.");
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        entry.settled = true;
        if (requests.get(viewerId) === entry) requests.delete(viewerId);
      }
    })();
    requests.set(viewerId, entry);
    return subscribe(entry, signal);
  }

  return { peek, seed, read };
}

export const dashboardStatusResource = createDashboardStatusResource();
