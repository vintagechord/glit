import assert from "node:assert/strict";
import { test } from "node:test";
import { createUrlReviewJob, listReviewJobs } from "../src/lib/review-docs/jobs";
import { ReviewJobError } from "../src/lib/review-docs/jobs-types";

process.env.SUPABASE_URL = "https://review-status-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

test("heartbeat lookup failures remain database errors instead of reporting an offline worker", async (t) => {
  let code = "42501";
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "review-status-test.supabase.co", "unexpected network request");
    if (url.pathname.endsWith("/review_document_jobs")) return Response.json([]);
    assert.ok(url.pathname.endsWith("/review_document_worker_heartbeat"));
    return Response.json({ code, message: "fixture database failure" }, { status: 403 });
  });
  await assert.rejects(listReviewJobs("owner"), (error: unknown) => error instanceof ReviewJobError && error.code === "DATABASE_UNAVAILABLE");
  code = "42P01";
  await assert.rejects(listReviewJobs("owner"), (error: unknown) => error instanceof ReviewJobError && error.code === "MIGRATION_REQUIRED");
});

test("missing, expired and malformed heartbeats never enable or enqueue new document jobs", async (t) => {
  const now = Date.parse("2026-09-08T09:00:00Z");
  t.mock.method(Date, "now", () => now);
  let heartbeat: { updated_at: string }[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "review-status-test.supabase.co", "unexpected network request");
    assert.equal(init?.method, "GET", "an unavailable worker must not cause a write");
    if (url.pathname.endsWith("/review_document_jobs")) return Response.json([]);
    assert.ok(url.pathname.endsWith("/review_document_worker_heartbeat"));
    return Response.json(heartbeat);
  });
  for (const updated_at of [null, "invalid-date", new Date(now - 90_001).toISOString(), new Date(now - 90_000).toISOString()]) {
    heartbeat = updated_at ? [{ updated_at }] : [];
    assert.equal((await listReviewJobs("owner")).workerReady, false);
    await assert.rejects(createUrlReviewJob("owner", { mode: "album", urls: ["https://www.melon.com/album/detail.htm?albumId=123456"] }),
      (error: unknown) => error instanceof ReviewJobError && error.code === "WORKER_UNAVAILABLE");
  }
  heartbeat = [{ updated_at: new Date(now - 89_999).toISOString() }];
  assert.equal((await listReviewJobs("owner")).workerReady, true);
});
