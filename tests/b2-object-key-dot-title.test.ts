import assert from "node:assert/strict";
import test from "node:test";

process.env.B2_S3_ENDPOINT = "https://s3.fixture.invalid";
process.env.B2_REGION = "fixture";
process.env.B2_BUCKET = "fixture-bucket";
process.env.B2_PREFIX = "submissions";
process.env.B2_KEY_ID = "fixture-key";
process.env.B2_APPLICATION_KEY = "fixture-secret";

// A release titled "." or ".." became a dot segment in the object key
// (submissions/<owner>/../<submission>/…): browsers rewrite it out of the
// presigned URL, and the ownership check refuses it, so no file could upload.

const owner = "11111111-1111-4111-8111-111111111111";
const submission = "22222222-2222-4222-8222-222222222222";

for (const title of [".", "..", " .. "]) {
  test(`an upload for a release titled ${JSON.stringify(title)} gets a key its owner can use`, async () => {
    const { buildObjectKey } = await import("../src/lib/b2");
    const { isSubmissionObjectKeyOwned } = await import("../src/lib/submission-object-key");
    const key = buildObjectKey({ userId: owner, submissionId: submission, title, filename: "track.wav" });
    assert.equal(key.split("/")[2], "untitled");
    assert.equal(
      isSubmissionObjectKeyOwned({ objectKey: key, prefix: "submissions", submissionId: submission, submissionUserId: owner }),
      true,
    );
  });
}

test("titles that merely contain dots keep their name", async () => {
  const { buildObjectKey } = await import("../src/lib/b2");
  for (const title of ["...", "Vol.1", "._"]) {
    const key = buildObjectKey({ userId: owner, submissionId: submission, title, filename: "track.wav" });
    assert.equal(key.split("/")[2], title);
  }
});
