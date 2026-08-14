import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every public upload initializer is rate limited", () => {
  for (const path of [
    "src/app/api/upload-url/route.ts",
    "src/app/api/uploads/init/route.ts",
    "src/app/api/uploads/presign/route.ts",
    "src/app/api/uploads/multipart/init/route.ts",
    "src/app/api/uploads/direct/route.ts",
  ]) {
    const source = read(path);
    assert.match(source, /namespace: "upload-init-ip"/, path);
    assert.match(source, /status: 429/, path);
    assert.match(source, /"Retry-After"/, path);
  }
});

test("multipart part signing has bounded unique part numbers and rate limiting", () => {
  const source = read("src/app/api/uploads/multipart/presign/route.ts");
  const complete = read("src/app/api/uploads/multipart/complete/route.ts");
  const b2Source = read("src/lib/b2.ts");

  assert.match(source, /grantId: z\.string\(\)\.uuid\(\)/);
  assert.match(source, /multipartGrantMatches/);
  assert.match(source, /getMultipartPartSize/);
  assert.match(source, /contentLength: sizeBytes!/);
  assert.match(source, /\.max\(10_000\)/);
  assert.match(source, /new Set\(values\)\.size === values\.length/);
  assert.match(source, /namespace: "upload-multipart-presign-ip"/);
  assert.match(source, /status: 429/);
  assert.match(complete, /claim_multipart_upload_grant/);
  assert.match(complete, /markMultipartGrantCompleted/);
  assert.match(b2Source, /ContentLength: params\.contentLength/);
});

test("direct uploads enforce actual byte and multipart limits without raw client metadata logs", () => {
  const source = read("src/app/api/uploads/direct/route.ts");

  assert.match(source, /fileSize: MAX_DIRECT_UPLOAD_BYTES/);
  assert.match(source, /MAX_DIRECT_UPLOAD_BYTES = 128 \* 1024 \* 1024/);
  assert.match(source, /fields: MAX_MULTIPART_FIELDS/);
  assert.match(source, /parts: MAX_MULTIPART_PARTS/);
  assert.match(source, /file\.on\("limit"/);
  assert.match(source, /nextFilePart\.sizeBytes \+= chunk\.length/);
  assert.match(
    source,
    /completedFilePart\.sizeBytes !== completedParsedData\.sizeBytes/,
  );
  assert.match(source, /cleanupStartedUpload/);
  assert.doesNotMatch(source, /request\.headers\.get\("user-agent"\)/);
  assert.doesNotMatch(source, /request\.headers\.get\("x-forwarded-for"\)/);
  assert.doesNotMatch(source, /error instanceof B2ConfigError/);
  assert.doesNotMatch(source, /detail: (?:String\(error\)|error\.message)/);
  assert.match(source, /submissionIdHash: getStorageLogId/);
  assert.match(source, /namespace: "upload-single-put-bytes-submission"/);
  assert.match(source, /namespace: "upload-single-put-bytes-owner"/);
  assert.match(source, /cost: quotaCost/);
  assert.match(source, /contentLengthBytes/);
  assert.doesNotMatch(source, /fieldNames: Object\.keys\(fields\)/);
});

test("multipart grants are owner-bound, one-shot and retry expired aborts", () => {
  const migration = read("supabase/migrations/0081_multipart_upload_grants.sql");
  const grants = read("src/lib/multipart-upload-grants.ts");
  const wizard = read("src/features/submissions/mv-wizard.tsx");
  const albumWizard = read("src/features/submissions/album-wizard.tsx");

  assert.match(migration, /owner_key text not null/);
  assert.match(migration, /declared_size_bytes bigint not null/);
  assert.match(migration, /claim_multipart_upload_grant/);
  assert.match(migration, /status = 'COMPLETING'/);
  assert.match(migration, /lease_expired_multipart_upload_aborts/);
  assert.match(migration, /for update skip locked/);
  assert.match(grants, /Keep ABORTING as a retryable lease state/);
  assert.match(wizard, /grantId: string/);
  assert.match(wizard, /\[400, 403, 409, 410\]\.includes\(res\.status\)/);
  assert.match(
    wizard,
    /\[400, 403, 409, 410\]\.includes\(completeRes\.status\)/,
  );
  assert.match(albumWizard, /albumMultipartThresholdBytes = 32 \* 1024 \* 1024/);
  assert.match(albumWizard, /grantId: string/);
  assert.match(albumWizard, /kind: "AUDIO"/);
  assert.match(
    albumWizard,
    /\[400, 403, 409, 410\]\.includes\(completeResponse\.status\)/,
  );
});

test("single PUTs bind content length and ignore client access URLs", () => {
  const init = read("src/app/api/uploads/init/route.ts");
  const complete = read("src/app/api/uploads/complete/route.ts");

  assert.match(init, /ContentLength: sizeBytes/);
  assert.match(init, /MAX_SINGLE_PUT_BYTES = 128 \* 1024 \* 1024/);
  assert.match(init, /Math\.min\(60 \* 60, Math\.max\(60/);
  assert.match(init, /namespace: "upload-single-put-bytes-submission"/);
  assert.match(init, /namespace: "upload-single-put-bytes-owner"/);
  assert.match(init, /cost: quotaCost/);
  assert.match(init, /readBoundedJsonBody/);
  assert.doesNotMatch(complete, /accessUrl: z\.string/);
  assert.doesNotMatch(complete, /providedAccessUrl/);
  assert.match(complete, /presignGetUrl\(normalizedKey/);
  assert.match(complete, /deleteUnreferencedObjectOnFailure/);
});

test("the unbound legacy Supabase upload route fails closed", () => {
  const source = read("src/app/api/upload-url/route.ts");

  assert.match(source, /status: 410/);
  assert.doesNotMatch(source, /createSignedUploadUrl/);
});

test("karaoke presign fails closed for guests and signs the declared content length", () => {
  const source = read("src/app/api/uploads/presign/route.ts");
  const b2Source = read("src/lib/b2.ts");

  assert.match(source, /MAX_GENERIC_BYTES = 512 \* 1024 \* 1024/);
  assert.match(source, /namespace: "upload-karaoke-request-user"/);
  assert.match(source, /비회원 첨부 파일은 지원하지 않습니다/);
  assert.match(source, /contentLength: sizeBytes/);
  assert.match(b2Source, /ContentLength: params\.contentLength/);
  assert.match(b2Source, /clampExpirySeconds/);
});
