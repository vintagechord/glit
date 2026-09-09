import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { runWebReviewBatch } from "../src/lib/review-docs/web-runner";
import { createReviewUrlFetcher } from "../src/lib/review-docs/urls";
import type { ReviewJob } from "../src/lib/review-docs/jobs-types";

process.env.SUPABASE_URL = "https://queue-recovery.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fixture-public";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service";
process.env.B2_S3_ENDPOINT = "https://s3.us-west-004.backblazeb2.com";
process.env.B2_REGION = "us-west-004"; process.env.B2_BUCKET = "queue-recovery";
process.env.B2_KEY_ID = "fixture-key"; process.env.B2_APPLICATION_KEY = "fixture-secret";
delete process.env.REVIEW_DOCS_B2_BUCKET;
delete process.env.REVIEW_DOCS_WEB_DISABLED;

test("a stalled S3 response body times out, releases the web singleton and can complete on a later batch", async (t) => {
  const buffer = await readFile("tests/fixtures/review-docs/table-two-tracks.docx");
  const owner = "10000000-0000-4000-8000-000000000001", id = "20000000-0000-4000-8000-000000000001";
  let row = { id, created_by: owner, mode: "album", input_kind: "files", status: "queued", operation: "extract", version: 1,
    attempts: 0, extraction_attempts: 0, application_date: "2026-09-10", sources: [{ id: "30000000-0000-4000-8000-000000000001", name: "fixture.docx", mime: "", sha256: createHash("sha256").update(buffer).digest("hex"),
      objectKey: `submissions/review-doc-jobs/${owner}/${id}/30000000-0000-4000-8000-000000000001` }] } as ReviewJob;
  let claims = 0, stalled = true, destroyed = false;
  let resumeStalledBody!: (value: IteratorResult<Uint8Array>) => void;
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    schedule(callback, ms === 900_000 ? 25 : ms, ...args)) as typeof setTimeout);
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.backblazeb2.com") return Response.json({ apiUrl: "https://api004.backblazeb2.com", accountId: "fixture", authorizationToken: "fixture" });
    if (url.hostname === "api004.backblazeb2.com") return Response.json({ buckets: [{ bucketName: "queue-recovery", bucketType: "allPrivate" }] });
    assert.equal(url.hostname, "queue-recovery.supabase.co");
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.pathname.endsWith("/claim_review_document_web_job")) {
      claims++;
      row = { ...row, status: "extracting", lease_token: body.p_token, lease_until: new Date(Date.now() + 90_000).toISOString(), attempts: claims, extraction_attempts: claims };
      return Response.json([row]);
    }
    assert.equal(init?.method, "PATCH");
    assert.equal(url.searchParams.get("lease_token"), `eq.${row.lease_token}`);
    row = { ...row, ...body }; return Response.json([{ id: row.id }]);
  });
  t.mock.method(S3Client.prototype, "send", async (command: GetObjectCommand) => {
    assert.ok(command instanceof GetObjectCommand);
    if (!stalled) return { ContentLength: buffer.length, Body: (async function* () { yield buffer; })() };
    return { ContentLength: buffer.length, Body: {
      destroy() { destroyed = true; },
      [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Uint8Array>>((resolve) => { resumeStalledBody = resolve; }) }; },
    } };
  });
  t.mock.method(console, "info", () => {});
  await runWebReviewBatch();
  assert.equal(row.status, "queued"); assert.equal(row.error_code, "WORKER_INTERRUPTED");
  assert.equal(destroyed, true, "the stalled socket must be closed");
  stalled = false;
  await runWebReviewBatch();
  assert.equal(claims, 2, "the old pending Promise must not pin every subsequent poll");
  assert.equal(row.status, "needs_review");
  assert.equal(row.draft_data!.albums[0].tracks.length, 2);
  resumeStalledBody({ done: false, value: buffer });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(row.status, "needs_review", "late source data must not mutate the recovered version");
});

test("review URL requests preserve caller cancellation, including requests waiting for a concurrency slot", async () => {
  const pending: AbortSignal[] = [];
  const fetcher = createReviewUrlFetcher(async (_input, init) => {
    const signal = init!.signal!; pending.push(signal);
    return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const requests = controllers.map((controller, index) => fetcher(`https://www.melon.com/album/detail.htm?albumId=${100 + index}`, { signal: controller.signal }));
  const settled = Promise.allSettled(requests);
  assert.equal(pending.length, 3);
  controllers[3].abort(new DOMException("cancel queued request", "AbortError"));
  controllers.slice(0, 3).forEach((controller) => controller.abort());
  const results = await settled;
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(pending.length, 3, "a cancelled queued request must not start later");
  assert.ok(pending.every((signal) => signal.aborted));
});
