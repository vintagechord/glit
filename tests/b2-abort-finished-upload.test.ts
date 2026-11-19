import assert from "node:assert/strict";
import test from "node:test";

process.env.B2_S3_ENDPOINT = "https://s3.fixture.invalid";
process.env.B2_REGION = "fixture";
process.env.B2_BUCKET = "fixture-bucket";
process.env.B2_PREFIX = "submissions";
process.env.B2_KEY_ID = "fixture-key";
process.env.B2_APPLICATION_KEY = "fixture-secret";

// Backblaze answers the abort of an upload that is already completed or
// aborted with 403 AccessDenied "not entitled", not S3's NoSuchUpload
// (measured on the production bucket 2026-11-19: of two aborts of one upload
// the second is denied, while ListParts says NoSuchUpload). Every cleanup of a
// finished upload therefore failed and was retried forever: seven queue rows,
// the oldest 24 attempts over 16 days, and the files they pointed at stayed.

const failure = (name: string) => Object.assign(new Error(name), { name });

async function withClient(answers: { abort: () => unknown; listParts?: () => unknown }) {
  const { abortMultipartUpload, getB2Config } = await import("../src/lib/b2");
  const sent: string[] = [];
  const client = getB2Config().client as unknown as { send: (command: { constructor: { name: string }; input: Record<string, unknown> }) => Promise<unknown> };
  const original = client.send;
  client.send = async (command) => {
    const name = command.constructor.name;
    sent.push(name);
    assert.equal(command.input.Key, "submissions/owner/album/id/song.wav");
    assert.equal(command.input.UploadId, "upload-1");
    if (name === "AbortMultipartUploadCommand") return answers.abort();
    if (name === "ListPartsCommand" && answers.listParts) return answers.listParts();
    throw new Error(`unexpected ${name}`);
  };
  const run = () => abortMultipartUpload({ objectKey: "submissions/owner/album/id/song.wav", uploadId: "upload-1" });
  return { run, sent, restore: () => { client.send = original; } };
}

test("an open upload is aborted with one request", async () => {
  const b2 = await withClient({ abort: () => ({}) });
  try {
    assert.equal(await b2.run(), "aborted");
    assert.deepEqual(b2.sent, ["AbortMultipartUploadCommand"]);
  } finally { b2.restore(); }
});

test("S3's own answer for a finished upload means nothing is left to abort", async () => {
  const b2 = await withClient({ abort: () => { throw failure("NoSuchUpload"); } });
  try {
    assert.equal(await b2.run(), "gone");
    assert.deepEqual(b2.sent, ["AbortMultipartUploadCommand"]);
  } finally { b2.restore(); }
});

test("Backblaze's denial for a finished upload is settled by asking for its parts", async () => {
  const b2 = await withClient({ abort: () => { throw failure("AccessDenied"); }, listParts: () => { throw failure("NoSuchUpload"); } });
  try {
    assert.equal(await b2.run(), "gone");
    assert.deepEqual(b2.sent, ["AbortMultipartUploadCommand", "ListPartsCommand"]);
  } finally { b2.restore(); }
});

test("a denial for an upload that still exists is a real permission failure", async () => {
  const b2 = await withClient({ abort: () => { throw failure("AccessDenied"); }, listParts: () => ({ Parts: [] }) });
  try {
    await assert.rejects(b2.run(), { name: "AccessDenied" });
  } finally { b2.restore(); }
});

test("a denial that cannot be checked, and any other failure, stay failures", async () => {
  const unchecked = await withClient({ abort: () => { throw failure("AccessDenied"); }, listParts: () => { throw failure("ServiceUnavailable"); } });
  try {
    await assert.rejects(unchecked.run(), { name: "AccessDenied" });
  } finally { unchecked.restore(); }
  const down = await withClient({ abort: () => { throw failure("InternalError"); } });
  try {
    await assert.rejects(down.run(), { name: "InternalError" });
    assert.deepEqual(down.sent, ["AbortMultipartUploadCommand"]);
  } finally { down.restore(); }
});
