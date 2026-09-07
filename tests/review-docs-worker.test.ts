import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import PizZip from "pizzip";
import { processReviewJob } from "../src/lib/review-docs/worker";
import type { ReviewJob } from "../src/lib/review-docs/jobs-types";
import { normalizedReviewFixture } from "./fixtures/review-docs/normalized";
import { recordManualReviewEdits } from "../src/lib/review-docs/manual-edits";

process.env.SUPABASE_URL = "https://review-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.B2_S3_ENDPOINT = "https://s3.us-west-004.backblazeb2.com";
process.env.B2_REGION = "us-west-004"; process.env.B2_BUCKET = "test-review-documents";
process.env.B2_KEY_ID = "test-key"; process.env.B2_APPLICATION_KEY = "test-secret";
delete process.env.REVIEW_DOCS_B2_BUCKET;

test("server detects deliberate empty edits independently of client reviewed flags", () => {
  const base = normalizedReviewFixture(); const draft = structuredClone(base);
  draft.albums[0].company = ""; draft.albums[0].tracks[0].lyrics = "";
  const recorded = recordManualReviewEdits(draft, base);
  assert.ok(recorded.albums[0].reviewedFields.includes("company"));
  assert.ok(recorded.albums[0].tracks[0].reviewedFields.includes("lyrics"));
  assert.ok(!recorded.albums[0].tracks[0].reviewedFields.includes("title"));
  assert.notEqual(recorded.albums[0].tracks[0].reviewedFields, draft.albums[0].tracks[0].reviewedFields);
});

test("worker generates a frozen snapshot, records every object and completes only after private persistence", async (t) => {
  let row = {
    id: "20000000-0000-4000-8000-000000000001", created_by: "10000000-0000-4000-8000-000000000001",
    mode: "album", status: "generating", operation: "generate", version: 3, attempts: 1,
    lease_token: "30000000-0000-4000-8000-000000000001", lease_until: new Date(Date.now() + 90000).toISOString(),
    snapshot_data: normalizedReviewFixture(), outputs: [], result_version: null,
  } as unknown as ReviewJob;
  const originalSnapshot = JSON.stringify(row.snapshot_data);
  const blobs = new Map<string, Buffer>(); const artifacts = new Map<string, string>();
  const states: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.backblazeb2.com") return Response.json({ apiUrl: "https://api004.backblazeb2.com", accountId: "test", authorizationToken: "test" });
    if (url.hostname === "api004.backblazeb2.com") return Response.json({ buckets: [{ bucketName: "test-review-documents", bucketType: "allPrivate" }] });
    assert.equal(url.hostname, "review-test.supabase.co", "unmocked network request");
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.pathname.endsWith("/review_document_artifacts")) { artifacts.set(body.id, body.object_key); return Response.json(null, { status: 201 }); }
    assert.equal(init?.method, "PATCH");
    assert.equal(url.searchParams.get("lease_token"), `eq.${row.lease_token}`);
    assert.equal(url.searchParams.get("version"), "eq.3");
    if (body.status === "completed") {
      assert.equal(blobs.size, 10); assert.equal(artifacts.size, 10);
      assert.equal(body.result_version, 3);
      for (const file of [...body.outputs, body.zip_output]) {
        assert.equal(createHash("sha256").update(blobs.get(file.objectKey)!).digest("hex"), file.sha256);
      }
    }
    states.push(body.status); row = { ...row, ...body };
    return Response.json([{ id: row.id }]);
  });
  t.mock.method(S3Client.prototype, "send", async (command: PutObjectCommand) => {
    assert.ok(command instanceof PutObjectCommand);
    const key = command.input.Key!;
    assert.ok([...artifacts.values()].includes(key), "object uploaded before cleanup metadata");
    blobs.set(key, Buffer.from(command.input.Body as Buffer)); return {};
  });
  await processReviewJob({ ...row });
  assert.equal(row.status, "completed"); assert.equal(row.lease_token, null);
  assert.equal(JSON.stringify(row.snapshot_data), originalSnapshot);
  assert.deepEqual(row.counts, { albumCount: 1, trackCount: 2, docxCount: 9 });
  assert.deepEqual(row.validation, { structureChecked: true, rendered: false });
  assert.ok(states.includes("validating"));
  const zip = new PizZip(blobs.get(row.zip_output!.objectKey)!, { checkCRC32: true });
  assert.equal(zip.file(/\.docx$/).length, 9);
});

test("cancelled lease never publishes a completed result or uploads generated documents", async (t) => {
  const job = { id: "job", created_by: "owner", mode: "mv", operation: "generate", version: 1, attempts: 1, lease_token: "old-token", snapshot_data: { ...normalizedReviewFixture(), mode: "mv" } } as unknown as ReviewJob;
  let uploads = 0; const writes: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.backblazeb2.com") return Response.json({ apiUrl: "https://api004.backblazeb2.com", accountId: "test", authorizationToken: "test" });
    if (url.hostname === "api004.backblazeb2.com") return Response.json({ buckets: [{ bucketName: "test-review-documents", bucketType: "allPrivate" }] });
    assert.equal(url.hostname, "review-test.supabase.co"); writes.push(JSON.parse(String(init?.body)));
    return Response.json([]); // cancellation already cleared the lease in the database
  });
  t.mock.method(S3Client.prototype, "send", async () => { uploads++; return {}; });
  await processReviewJob(job);
  assert.equal(uploads, 0); assert.equal(writes.length, 1);
  assert.ok(!JSON.stringify(writes).includes("completed"));
});
