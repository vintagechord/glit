import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createFileReviewJob, listReviewJobs } from "../src/lib/review-docs/jobs";
import { assertReviewFormats, createReviewWebCapabilities, reviewProcessor } from "../src/lib/review-docs/web-runtime";
import { runClaimedWebReviewJob, runWebReviewBatch } from "../src/lib/review-docs/web-runner";
import { isReviewDispatcherEnabled, startReviewDispatcher } from "../src/lib/review-docs/dispatcher";
import type { ReviewJob } from "../src/lib/review-docs/jobs-types";

process.env.SUPABASE_URL = "https://review-web-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
delete process.env.REVIEW_DOCS_WEB_DISABLED;
delete process.env.REVIEW_DOCS_WEB_CONVERTERS;

test("web fallback reports a missing migration, then recovers without forging a dedicated heartbeat", async (t) => {
  let now = Date.now(), missing = true, probes = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "review-web-test.supabase.co");
    if (url.pathname.endsWith("/claim_review_document_web_job")) {
      probes++;
      assert.equal(JSON.parse(String(init?.body)).p_check_only, true);
      return missing ? Response.json({ code: "PGRST202", message: "private test details" }, { status: 404 }) : Response.json([]);
    }
    assert.equal(init?.method, "GET", "status cannot write jobs or heartbeat");
    return Response.json([]);
  });
  const unavailable = await listReviewJobs("owner");
  assert.equal(unavailable.workerReady, false);
  assert.match(unavailable.workerError!, /0103/);
  missing = false; now += 16_000;
  const ready = await listReviewJobs("owner");
  assert.equal(ready.workerMode, "web"); assert.equal(ready.workerReady, true);
  assert.deepEqual(ready.supportedFormats, ["docx"]);
  assertReviewFormats(ready, ["기준파일.DOCX"]);
  assert.throws(() => assertReviewFormats(ready, ["기준파일.hwp"]), /DOCX로 저장/);
  assert.equal((await reviewProcessor(true)).workerMode, "dedicated");
  assert.equal(probes, 2);
});

test("real DOCX upload is persisted, claimed and analyzed by the web queue with no converter process", async (t) => {
  process.env.B2_S3_ENDPOINT = "https://s3.us-west-004.backblazeb2.com";
  process.env.B2_REGION = "us-west-004"; process.env.B2_BUCKET = "test-review-web";
  process.env.B2_KEY_ID = "test-key"; process.env.B2_APPLICATION_KEY = "test-secret";
  process.env.REVIEW_DOCS_PYTHON = "/does-not-exist";
  delete process.env.REVIEW_DOCS_B2_BUCKET;
  let row: ReviewJob | undefined;
  let claimCount = 0;
  const objects = new Map<string, Buffer>();
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.backblazeb2.com") return Response.json({ apiUrl: "https://api004.backblazeb2.com", accountId: "test", authorizationToken: "test" });
    if (url.hostname === "api004.backblazeb2.com") return Response.json({ buckets: [{ bucketName: "test-review-web", bucketType: "allPrivate" }] });
    assert.equal(url.hostname, "review-web-test.supabase.co");
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.pathname.endsWith("/review_document_worker_heartbeat")) { assert.equal(init?.method, "GET"); return Response.json([]); }
    if (url.pathname.endsWith("/create_review_document_job")) {
      row = { id: body.p_id, created_by: body.p_owner, mode: body.p_mode, input_kind: body.p_kind, sources: body.p_sources,
        application_date: "2026-09-10", status: "uploading", operation: "extract", version: 1, attempts: 0, extraction_attempts: 0 } as ReviewJob;
      return Response.json(row);
    }
    if (url.pathname.endsWith("/claim_review_document_web_job")) {
      if (body.p_check_only) return Response.json([]);
      assert.ok(row); assert.equal(row.status, "queued"); assert.equal(objects.size, 1);
      claimCount++;
      row = { ...row, status: "extracting", lease_token: body.p_token, lease_until: new Date(Date.now() + 90_000).toISOString(), attempts: 1, extraction_attempts: 1 };
      return Response.json([row]);
    }
    assert.ok(url.pathname.endsWith("/review_document_jobs")); assert.equal(init?.method, "PATCH");
    if (url.searchParams.has("lease_token")) assert.equal(url.searchParams.get("lease_token"), `eq.${row!.lease_token}`);
    row = { ...row!, ...body }; return Response.json([row]);
  });
  t.mock.method(S3Client.prototype, "send", async (command: PutObjectCommand | GetObjectCommand) => {
    const key = command.input.Key!;
    if (command instanceof PutObjectCommand) { objects.set(key, Buffer.from(command.input.Body as Buffer)); return {}; }
    assert.ok(command instanceof GetObjectCommand);
    const buffer = objects.get(key)!;
    return { ContentLength: buffer.length, Body: (async function* () { yield buffer; })() };
  });
  const upload = await createFileReviewJob("10000000-0000-4000-8000-000000000001", "album", [{ name: "기준파일.docx", mime: "", buffer: await readFile("tests/fixtures/review-docs/table-two-tracks.docx") }]);
  assert.equal(upload.job.status, "queued");
  await Promise.all([runWebReviewBatch(), runWebReviewBatch()]);
  assert.equal(claimCount, 1, "overlapping polls share one local batch");
  assert.equal(row!.status, "needs_review"); assert.equal(row!.lease_token, null);
  assert.equal(row!.draft_data!.albums[0].tracks.length, 2);
  assert.equal(row!.draft_data!.albums[0].tracks[0].lyrics, "반복 가사\n반복 가사\n끝 가사");
});

test("web lease renewal stops on cancellation and never extends beyond the job deadline", async () => {
  let callback!: () => void, finish!: () => void;
  let now = 0, renewals = 0, clearCount = 0;
  const run = runClaimedWebReviewJob({} as ReviewJob, {
    process: () => new Promise<void>((resolve) => { finish = resolve; }),
    renew: async () => { renewals++; return false; }, now: () => now,
    every: ((fn: () => void) => { callback = fn; return 1; }) as unknown as typeof setInterval,
    clear: (() => { clearCount++; }) as unknown as typeof clearInterval,
  });
  callback(); await new Promise<void>((resolve) => setImmediate(resolve));
  callback(); assert.equal(renewals, 1);
  now = 901_000; callback(); assert.equal(renewals, 1);
  finish(); await run; assert.equal(clearCount, 1);
});

test("production dispatcher resumes jobs without a browser and stays off during builds", async () => {
  const env = { NODE_ENV: "production", NEXT_RUNTIME: "nodejs", RENDER: "true", npm_lifecycle_event: "start" };
  assert.equal(isReviewDispatcherEnabled(env), true);
  for (const change of [{ NEXT_PHASE: "phase-production-build" }, { NODE_ENV: "development" }, { REVIEW_DOCS_WEB_DISABLED: "true" }, { npm_lifecycle_event: "build" }]) assert.equal(isReviewDispatcherEnabled({ ...env, ...change }), false);
  let callback!: () => void, calls = 0, unrefed = 0;
  const controller = startReviewDispatcher({ env, run: async () => { calls++; }, schedule: (fn) => { callback = fn; return { unref: () => { unrefed++; } }; }, cancel: () => {} });
  assert.ok(controller); assert.equal(calls, 0); assert.equal(unrefed, 1);
  callback(); await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(unrefed, 2);
  await controller.stop();
});


test("converter opt-in shares its real readiness probe and caches success for five minutes", async () => {
  let now = 0, checks = 0, release!: () => void;
  const env: Record<string, string | undefined> = {};
  const capabilities = createReviewWebCapabilities({ env: () => env, now: () => now,
    checkConverters: async () => { checks++; await new Promise<void>(resolve => { release = resolve; }); },
  });
  assert.deepEqual(await capabilities(), ["docx"]); assert.equal(checks, 0);
  env.REVIEW_DOCS_WEB_CONVERTERS = "true";
  const pending = [capabilities(), capabilities(), capabilities()];
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(checks, 1); release();
  assert.deepEqual(await Promise.all(pending), Array.from({ length: 3 }, () => ["doc", "docx", "hwp", "pdf"]));
  now = 299_999; assert.deepEqual(await capabilities(), ["doc", "docx", "hwp", "pdf"]); assert.equal(checks, 1);
  now = 300_001; const renewed = capabilities();
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(checks, 2); release(); await renewed;
  env.REVIEW_DOCS_WEB_CONVERTERS = "false"; assert.deepEqual(await capabilities(), ["docx"]); assert.equal(checks, 2);
});

test("missing converter dependencies retain native DOCX and recover after a bounded failure cache", async () => {
  let now = 0, checks = 0, failed = true;
  const env = { REVIEW_DOCS_WEB_CONVERTERS: "true", REVIEW_DOCS_PYTHON: "/fixture/python" };
  const capabilities = createReviewWebCapabilities({ env: () => env, now: () => now,
    checkConverters: async () => { checks++; if (failed) throw new Error("private converter details"); },
  });
  assert.deepEqual(await capabilities(), ["docx"]);
  now = 14_999; assert.deepEqual(await capabilities(), ["docx"]); assert.equal(checks, 1);
  failed = false; now = 15_001; assert.deepEqual(await capabilities(), ["doc", "docx", "hwp", "pdf"]); assert.equal(checks, 2);
  env.REVIEW_DOCS_PYTHON = "/new/python"; failed = true;
  assert.deepEqual(await capabilities(), ["docx"]); assert.equal(checks, 3);
});

test("full-format web readiness and claims use the same capability RPC without publishing heartbeat", async (t) => {
  let now = Date.now(), missing = true;
  t.mock.method(Date, "now", () => now);
  const formats = ["doc", "docx", "hwp", "pdf"];
  const requests: { p_check_only: boolean; p_supported_formats: string[] }[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "review-web-test.supabase.co");
    assert.ok(url.pathname.endsWith("/claim_review_document_web_job"), "capability checks never write a dedicated heartbeat");
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (body.p_supported_formats) assert.deepEqual(body.p_supported_formats, formats);
    return missing ? Response.json({ code: "PGRST202", message: "secret" }, { status: 404 }) : Response.json([]);
  });
  const unavailable = await reviewProcessor(false, async () => formats);
  assert.equal(unavailable.workerReady, false); assert.match(unavailable.workerError!, /0103/);
  missing = false; now += 16_000;
  const ready = await reviewProcessor(false, async () => formats);
  assert.equal(ready.workerMode, "web"); assert.deepEqual(ready.supportedFormats, formats);
  assert.doesNotThrow(() => assertReviewFormats(ready, ["legacy.DOC", "한글.hwp", "scan.pdf", "native.docx"]));
  const state = globalThis as typeof globalThis & { __reviewWebCleanupAt?: number };
  const previous = state.__reviewWebCleanupAt; state.__reviewWebCleanupAt = now + 60_000;
  try { await runWebReviewBatch(async () => formats); }
  finally { state.__reviewWebCleanupAt = previous; }
  assert.deepEqual(requests.map(request => request.p_check_only), [true, true, true, false]);
});

test("a missing full-format RPC keeps native analysis available and claims only DOCX/URL jobs", async (t) => {
  const formats = ["doc", "docx", "hwp", "pdf"];
  const claims: { p_check_only?: boolean; p_supported_formats?: string[] }[] = [];
  let fullReady = false;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "review-web-test.supabase.co");
    assert.ok(url.pathname.endsWith("/claim_review_document_web_job"));
    const body = JSON.parse(String(init?.body)); claims.push(body);
    if (body.p_supported_formats && !fullReady) return Response.json({ code: "PGRST202", message: "fixture missing converter RPC" }, { status: 404 });
    return Response.json([]);
  });
  const ready = await reviewProcessor(false, async () => formats, true);
  assert.equal(ready.workerReady, true); assert.equal(ready.workerMode, "web");
  assert.deepEqual(ready.supportedFormats, ["docx"]);
  assert.doesNotThrow(() => assertReviewFormats(ready, ["native.docx"]));
  assert.throws(() => assertReviewFormats(ready, ["scan.pdf"]), /DOCX로 저장/);
  const state = globalThis as typeof globalThis & { __reviewWebCleanupAt?: number };
  const previous = state.__reviewWebCleanupAt; state.__reviewWebCleanupAt = Date.now() + 60_000;
  try { await runWebReviewBatch(async () => formats); }
  finally { state.__reviewWebCleanupAt = previous; }
  assert.deepEqual(claims.map(({ p_check_only, p_supported_formats }) => ({ check: !!p_check_only, full: !!p_supported_formats })), [
    { check: true, full: true }, { check: true, full: false },
    { check: false, full: true }, { check: false, full: false },
  ]);
  fullReady = true;
  const refreshed = await reviewProcessor(false, async () => formats, true);
  assert.deepEqual(refreshed.supportedFormats, formats, "manual connection retry bypasses cached partial readiness");
});

test("database permission failures are not hidden by native RPC fallback", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ code: "42501", message: "private fixture details" }, { status: 403 });
  });
  const processor = await reviewProcessor(false, async () => ["doc", "docx", "hwp", "pdf"], true);
  assert.equal(processor.workerReady, false); assert.equal(calls, 1);
  assert.match(processor.workerError!, /저장소에 연결할 수 없습니다/);
});
