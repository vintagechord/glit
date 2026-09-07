import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPrivateReviewBucket, assertReviewObjectKey, reviewObjectKey } from "../src/lib/review-docs/storage";
import { publicReviewJob, type ReviewJob } from "../src/lib/review-docs/jobs-types";

process.env.B2_S3_ENDPOINT = "https://s3.us-west-004.backblazeb2.com";
process.env.B2_REGION = "us-west-004";
process.env.B2_BUCKET = "test-review-documents";
process.env.B2_PREFIX = "restricted/submissions";
process.env.B2_KEY_ID = "local-test-key";
process.env.B2_APPLICATION_KEY = "local-test-secret";
delete process.env.REVIEW_DOCS_B2_BUCKET;

function privacyFetch(type: string, endpoint = "https://api004.backblazeb2.com") {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json(calls.length === 1 ? { accountId: "test-account", authorizationToken: "not-a-real-token", apiUrl: endpoint } : { buckets: [{ bucketName: "test-review-documents", bucketType: type }] });
  };
  return { fetchImpl, calls };
}
test("review storage checks actual allPrivate bucket and refuses public prefix camouflage", async () => {
  const privateCase = privacyFetch("allPrivate");
  assert.equal(await assertPrivateReviewBucket(privateCase.fetchImpl), "test-review-documents");
  assert.equal(privateCase.calls.length, 2);
  assert.ok(privateCase.calls.every((call) => call.init?.redirect === "error"));
  await assert.rejects(assertPrivateReviewBucket(privacyFetch("allPublic").fetchImpl), /비공개 B2/);
  await assert.rejects(assertPrivateReviewBucket(privacyFetch("restricted").fetchImpl), /비공개 B2/);
});
test("B2 native endpoint is checked before forwarding its auth token", async () => {
  const state = privacyFetch("allPrivate", "http://169.254.169.254");
  await assert.rejects(assertPrivateReviewBucket(state.fetchImpl), /API 주소/);
  assert.equal(state.calls.length, 1);
});
test("review storage object keys bind owner/job and reject traversal and customer-file cleanup", () => {
  const owner = "10000000-0000-4000-8000-000000000001";
  const job = "20000000-0000-4000-8000-000000000001";
  const file = "30000000-0000-4000-8000-000000000001";
  const key = reviewObjectKey(owner, job, file);
  assert.equal(key, `restricted/submissions/review-doc-jobs/${owner}/${job}/${file}`);
  assert.doesNotThrow(() => assertReviewObjectKey(key, owner, job));
  assert.throws(() => assertReviewObjectKey(key, file, job));
  assert.throws(() => assertReviewObjectKey(`restricted/submissions/${owner}/${job}/${file}`, owner, job));
  assert.throws(() => assertReviewObjectKey(`review-doc-jobs/${owner}/${job}/${file}`, owner, job));
  assert.throws(() => reviewObjectKey(owner, job, "../secret"));
  assert.throws(() => assertReviewObjectKey(`${key}/../file`, owner, job));
  assert.throws(() => assertReviewObjectKey(`${key}/../${file}`, owner, job));
  assert.throws(() => assertReviewObjectKey(`${key}/${file}`, owner, job));
});
test("job responses hide private storage keys, snapshot and stale outputs", () => {
  const job = { id: "job", status: "completed", version: 2, result_version: 1,
    sources: [{ id: "source", name: "자료.docx", objectKey: "private-input" }],
    outputs: [{ id: "file", name: "가사.docx", objectKey: "private-output" }],
    zip_output: { objectKey: "private-zip" }, snapshot_data: { secret: true },
    draft_data: null, extracted_data: null,
  } as unknown as ReviewJob;
  const hidden = publicReviewJob(job);
  assert.deepEqual(hidden.outputs, []); assert.equal(hidden.has_zip, false);
  assert.ok(!JSON.stringify(hidden).includes("private-")); assert.ok(!("snapshot_data" in hidden));
  const current = publicReviewJob({ ...job, result_version: 2 });
  assert.equal(current.outputs.length, 1); assert.equal(current.has_zip, true);
  const expired = publicReviewJob({ ...job, result_version: 2, expires_at: "2000-01-01T00:00:00Z" });
  assert.equal(expired.status, "expired"); assert.equal(expired.data, null);
  assert.deepEqual(expired.sources, []); assert.deepEqual(expired.outputs, []);
});
