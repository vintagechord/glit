import { createHash } from "node:crypto";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  namespace: string;
  identifier: string;
  limit: number;
  windowMs: number;
  cost?: number;
  now?: number;
  /** What to do when the shared limiter cannot answer. Mail endpoints keep
   * "deny"; actions that send nothing (login) may fall back to this instance's
   * in-memory limit instead of turning a database hiccup into a lockout. */
  onUnavailable?: "deny" | "memory";
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
};

const storeSymbol = Symbol.for("onside.request-rate-limit.store");
const maxEntries = 10_000;

const getStore = () => {
  const runtime = globalThis as typeof globalThis & {
    [storeSymbol]?: Map<string, RateLimitEntry>;
  };
  runtime[storeSymbol] ??= new Map<string, RateLimitEntry>();
  return runtime[storeSymbol];
};

const digestIdentifier = (namespace: string, identifier: string) =>
  createHash("sha256")
    .update(`${namespace}\0${identifier.trim().toLowerCase()}`)
    .digest("hex");

const pruneStore = (store: Map<string, RateLimitEntry>, now: number) => {
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
  while (store.size >= maxEntries) {
    const oldestKey = store.keys().next().value as string | undefined;
    if (!oldestKey) break;
    store.delete(oldestKey);
  }
};

export const consumeRateLimit = ({
  namespace,
  identifier,
  limit,
  windowMs,
  cost = 1,
  now = Date.now(),
}: RateLimitOptions): RateLimitResult => {
  const safeLimit = Math.max(1, Math.trunc(limit));
  const safeCost = Math.max(1, Math.trunc(cost));
  const safeWindowMs = Math.max(1_000, Math.trunc(windowMs));
  const store = getStore();
  if (store.size >= maxEntries || store.size % 128 === 0) {
    pruneStore(store, now);
  }

  const key = digestIdentifier(namespace, identifier || "unknown");
  const current = store.get(key);
  const entry =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + safeWindowMs }
      : current;

  if (entry.count + safeCost > safeLimit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)),
      resetAt: entry.resetAt,
    };
  }

  entry.count += safeCost;
  store.delete(key);
  store.set(key, entry);
  return {
    allowed: true,
    remaining: Math.max(0, safeLimit - entry.count),
    retryAfterSeconds: 0,
    resetAt: entry.resetAt,
  };
};

/** Shared across instances/restarts. Only hashed identifiers leave the app.
 * Fail closed when the database cannot enforce a limit; do not turn an outage
 * into an unrestricted email endpoint. Local tests can inject an RPC adapter.
 */
export async function consumePersistentRateLimit(
  options: RateLimitOptions,
  rpc?: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<RateLimitResult> {
  if (process.env.NODE_ENV === "test" && !rpc) return consumeRateLimit(options);
  const windowMs = Math.min(86_400_000, Math.max(1_000, Math.trunc(options.windowMs)));
  const denied: RateLimitResult = { allowed: false, remaining: 0, retryAfterSeconds: 60, resetAt: Date.now() + 60_000 };
  const fallback = () => {
    if (options.onUnavailable !== "memory") return denied;
    console.error("[RateLimit] shared limiter unavailable; using in-memory limit", { namespace: options.namespace });
    return consumeRateLimit(options);
  };
  try {
    let call = rpc;
    if (!call) {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const db = createAdminClient();
      call = (name, args) => db.rpc(name, args);
    }
    const { data, error } = await call("consume_email_rate_limit", {
      p_key: digestIdentifier(options.namespace, options.identifier || "unknown"),
      p_limit: Math.max(1, Math.trunc(options.limit)),
      p_window_ms: windowMs,
      p_cost: Math.max(1, Math.trunc(options.cost ?? 1)),
    });
    if (error || !data || typeof data !== "object") return fallback();
    const result = data as RateLimitResult;
    if (typeof result.allowed !== "boolean" || !Number.isFinite(result.resetAt) || !Number.isFinite(result.remaining) || !Number.isFinite(result.retryAfterSeconds)) return fallback();
    return result;
  } catch {
    return fallback();
  }
}

export const getRequestIdentifier = (headers: Pick<Headers, "get">) => {
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0],
  ];
  return candidates.find((value) => value?.trim())?.trim() || "unknown";
};
