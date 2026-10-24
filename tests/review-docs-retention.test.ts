import assert from "node:assert/strict";
import test from "node:test";
import { S3Client } from "@aws-sdk/client-s3";
import { assertJobLive } from "../src/lib/review-docs/jobs";
import { publicReviewJob, REVIEW_JOB_LIMITS, type ReviewJob } from "../src/lib/review-docs/jobs-types";
import { cleanupReviewJobs } from "../src/lib/review-docs/worker";
import { hasUnlimitedReviewRetention, isReviewJobExpired } from "../src/lib/review-docs/retention";

const fixture = (overrides: Partial<ReviewJob> = {}) => ({
  id: "fixture", status: "completed", expires_at: "infinity", version: 3, result_version: 3,
  created_at: "2000-01-01T00:00:00Z", draft_data: { albums: [] },
  sources: [{ id: "source", name: "application.docx", objectKey: "private-source" }],
  outputs: [{ id: "output", name: "result.docx", objectKey: "private-result", size: 123 }],
  zip_output: { id: "zip", name: "documents.zip", objectKey: "private-zip", size: 456 },
  ...overrides,
} as ReviewJob);

test("unbounded retained jobs keep source/result access regardless of age without leaking object keys", () => {
  const job = fixture();
  assert.equal(REVIEW_JOB_LIMITS.retentionDays, null);
  assert.equal(REVIEW_JOB_LIMITS.retentionPolicy, "until_admin_deletion");
  assert.equal(hasUnlimitedReviewRetention(job.expires_at), true);
  assert.equal(isReviewJobExpired(job, Date.parse("2200-01-01T00:00:00Z")), false);
  assert.doesNotThrow(() => assertJobLive(job));
  const visible = publicReviewJob(job);
  assert.equal(visible.status, "completed");
  assert.equal(visible.sources.length, 1);
  assert.equal(visible.outputs.length, 1);
  assert.equal(visible.has_zip, true);
  assert.deepEqual(visible.data, { albums: [] });
  assert.ok(!JSON.stringify(visible).includes("private-"));
});

test("retention does not revive explicit expiry, stale results, or malformed database deadlines", () => {
  for (const overrides of [{ status: "expired" as const }, { expires_at: "2000-01-01T00:00:00Z" }, { expires_at: "-infinity" }, { expires_at: "invalid" }, { expires_at: "" }]) {
    const job = fixture(overrides);
    assert.equal(isReviewJobExpired(job), true);
    assert.throws(() => assertJobLive(job), /만료/);
    const hidden = publicReviewJob(job);
    assert.equal(hidden.status, "expired");
    assert.deepEqual(hidden.sources, []);
    assert.deepEqual(hidden.outputs, []);
    assert.equal(hidden.has_zip, false);
    assert.equal(hidden.data, null);
  }
  const stale = publicReviewJob(fixture({ result_version: 2 }));
  assert.deepEqual(stale.outputs, []);
  assert.equal(stale.has_zip, false);
  assert.equal(isReviewJobExpired(fixture({ expires_at: "2099-01-01T00:00:00Z" }), Date.parse("2026-01-01T00:00:00Z")), false);
});

test("scheduled cleanup never deletes persistent source/result objects or 90-day job history", async (t) => {
  let databaseCalls = 0;
  let storageCalls = 0;
  t.mock.method(globalThis, "fetch", async () => { databaseCalls++; throw new Error("Unexpected database or storage request"); });
  t.mock.method(S3Client.prototype, "send", async () => { storageCalls++; throw new Error("Unexpected object operation"); });
  await cleanupReviewJobs();
  await cleanupReviewJobs();
  assert.equal(databaseCalls, 0);
  assert.equal(storageCalls, 0);
});
