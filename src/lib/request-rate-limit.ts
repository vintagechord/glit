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

export const getRequestIdentifier = (headers: Pick<Headers, "get">) => {
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0],
  ];
  return candidates.find((value) => value?.trim())?.trim() || "unknown";
};
