import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardStatusResource } from "../src/features/home/dashboard-status-resource";
import type { DashboardStatusData } from "../src/lib/dashboard-status";

const snapshot = (title: string): DashboardStatusData => ({
  albumSubmissions: [{ id: title, title, status: "IN_PROGRESS", created_at: "2026-10-28T00:00:00Z", updated_at: "2026-10-28T00:00:00Z" }],
  mvSubmissions: [], albumStationsMap: {}, mvStationsMap: {},
});
const signal = () => new AbortController().signal;
function fixture() {
  const calls: { url: string; signal: AbortSignal; finish: (data: DashboardStatusData, status?: number, viewerId?: string) => void }[] = [];
  const fetcher: typeof fetch = (url, options) => new Promise((resolve, reject) => {
    const requestSignal = options?.signal as AbortSignal;
    requestSignal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    calls.push({ url: String(url), signal: requestSignal, finish: (data, status = 200, viewerId = "a") => resolve(Response.json({ ...data, viewerId }, { status })) });
  });
  let now = 0;
  const resource = createDashboardStatusResource({ fetcher, now: () => now });
  return { calls, resource, advance: (ms: number) => { now += ms; } };
}

test("fresh server snapshots avoid a request, expire quickly, and stay isolated by account", async () => {
  const f = fixture(); const first = snapshot("account-a");
  f.resource.seed("a", first);
  assert.equal(await f.resource.read("a", { signal: signal() }), first);
  assert.equal(f.calls.length, 0);
  assert.equal(f.resource.peek("b"), null);
  const second = f.resource.read("b", { signal: signal() });
  f.calls[0].finish(snapshot("account-b"), 200, "b"); await second;
  assert.equal(f.resource.peek("a")?.albumSubmissions[0].title, "account-a");
  f.advance(5_001);
  assert.equal(f.resource.peek("a"), null);
  const next = f.resource.read("a", { signal: signal() });
  assert.equal(f.calls.length, 2);
  f.calls[1].finish(snapshot("fresh-a"));
  assert.equal((await next).albumSubmissions[0].title, "fresh-a");
});

test("overlapping consumers share one request and cancelling one does not interrupt the other", async () => {
  const f = fixture(); const one = new AbortController(); const two = new AbortController();
  const first = f.resource.read("a", { signal: one.signal });
  const second = f.resource.read("a", { signal: two.signal });
  assert.equal(f.calls.length, 1);
  one.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(f.calls[0].signal.aborted, false);
  f.calls[0].finish(snapshot("shared"));
  assert.equal((await second).albumSubmissions[0].title, "shared");
});

test("the last departing consumer cancels network work and a returning page starts a new request", async () => {
  const f = fixture(); const controller = new AbortController();
  const first = f.resource.read("a", { signal: controller.signal });
  controller.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(f.calls[0].signal.aborted, true);
  const next = f.resource.read("a", { signal: signal() });
  assert.equal(f.calls.length, 2);
  f.calls[1].finish(snapshot("returned"));
  assert.equal((await next).albumSubmissions[0].title, "returned");
});

test("explicit refresh waits for an older request then shares one fresh read", async () => {
  const f = fixture();
  const ordinary = f.resource.read("a", { signal: signal() });
  const refreshOne = f.resource.read("a", { signal: signal(), bypassCache: true });
  const refreshTwo = f.resource.read("a", { signal: signal(), bypassCache: true });
  assert.equal(f.calls.length, 1);
  f.calls[0].finish(snapshot("before-payment")); await ordinary;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].url, "/api/dashboard/status?refresh=1");
  f.calls[1].finish(snapshot("paid"));
  assert.equal((await refreshOne).albumSubmissions[0].title, "paid");
  assert.equal((await refreshTwo).albumSubmissions[0].title, "paid");
});

test("a late request cannot replace a newer server snapshot in the cache", async () => {
  const f = fixture();
  const old = f.resource.read("a", { signal: signal() });
  f.resource.seed("a", snapshot("server-newer"));
  f.calls[0].finish(snapshot("request-older")); await old;
  assert.equal(f.resource.peek("a")?.albumSubmissions[0].title, "server-newer");
});

test("an unauthorized refresh clears the account snapshot", async () => {
  const f = fixture(); f.resource.seed("a", snapshot("private"));
  const refresh = f.resource.read("a", { signal: signal(), bypassCache: true });
  f.calls[0].finish(snapshot("unused"), 401);
  await assert.rejects(refresh, { status: 401 });
  assert.equal(f.resource.peek("a"), null);
});

test("a cross-tab account switch cannot cache the new account's payload under the previous viewer", async () => {
  const f = fixture(); f.resource.seed("a", snapshot("private-a"));
  const refresh = f.resource.read("a", { signal: signal(), bypassCache: true });
  f.calls[0].finish(snapshot("private-b"), 200, "b");
  await assert.rejects(refresh, { status: 401 });
  assert.equal(f.resource.peek("a"), null);
  assert.equal(f.resource.peek("b"), null);
});

test("restoring an old server snapshot does not renew its freshness or overwrite a newer read", () => {
  const f = fixture(); f.resource.seed("a", snapshot("server"), 0);
  f.advance(5_001);
  f.resource.seed("a", snapshot("server"), 0);
  assert.equal(f.resource.peek("a"), null);
  f.resource.seed("a", snapshot("newer"));
  f.resource.seed("a", snapshot("server"), 0);
  assert.equal(f.resource.peek("a")?.albumSubmissions[0].title, "newer");
});
