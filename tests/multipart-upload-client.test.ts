import assert from "node:assert/strict";
import test from "node:test";
import {
  clearMultipartResumeState,
  isFinalUploadError,
  loadMultipartResumeState,
  MULTIPART_SIGN_BATCH,
  multipartRetryDelayMs,
  requestWithRetry,
  runMultipartWorkers,
  saveMultipartResumeState,
  uploadMultipartParts,
  type MultipartResumeState,
} from "../src/lib/multipart-upload-client";

const state = (): MultipartResumeState => ({
  grantId: "grant", uploadId: "upload", key: "submission/file.wav",
  partSize: 20 * 1024 * 1024, parts: { 1: "etag" }, createdAt: Date.now(),
});

test("multipart resumes survive storage round trips and reject expired or corrupt state", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  } });
  try {
    const valid = state();
    saveMultipartResumeState("resume", valid);
    assert.deepEqual(loadMultipartResumeState("resume"), valid);
    for (const invalid of [
      null, { ...valid, createdAt: Date.now() - 25 * 60 * 60 * 1_000 },
      { ...valid, partSize: -1 }, { ...valid, parts: { 0: "etag" } },
      { ...valid, parts: { 1: false } }, { ...valid, parts: [] },
    ]) {
      values.set("resume", JSON.stringify(invalid));
      assert.equal(loadMultipartResumeState("resume"), null);
      assert.equal(values.has("resume"), false);
    }
    values.set("resume", "{");
    assert.equal(loadMultipartResumeState("resume"), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("blocked browser storage never prevents an upload or its completion", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    get localStorage() { throw new Error("Storage is blocked"); },
  } });
  try {
    assert.equal(loadMultipartResumeState("resume"), null);
    assert.doesNotThrow(() => saveMultipartResumeState("resume", state()));
    assert.doesNotThrow(() => clearMultipartResumeState("resume"));
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("multipart failure waits for active parts and stops scheduling before retry is offered", async () => {
  const started: number[] = [];
  let settled = false;
  let release!: () => void;
  const activePart = new Promise<void>((resolve) => { release = resolve; });
  const expected = new Error("part failed");
  const run = runMultipartWorkers([1, 2, 3, 4], 2, async (part) => {
    started.push(part);
    if (part === 1) throw expected;
    await activePart;
  });
  const checked = assert.rejects(run, (error) => error === expected).then(() => { settled = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(started, [1, 2]);
  release();
  await checked;
  assert.deepEqual(started, [1, 2]);
});

test("multipart workers upload each requested part once with bounded concurrency", async () => {
  const parts: number[] = [];
  let active = 0; let peak = 0;
  await runMultipartWorkers([1, 2, 3, 4, 5], 2, async (part) => {
    peak = Math.max(peak, ++active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    parts.push(part); active--;
  });
  assert.equal(peak, 2);
  assert.deepEqual(parts.sort(), [1, 2, 3, 4, 5]);
});

// A 4GB file in 20MB parts, sent over a connection slow enough that one part
// takes 30 seconds: the whole upload takes far longer than a signed URL lives.
test("a slow 4GB upload signs parts in batches just in time and never PUTs to an expired URL", async () => {
  const partCount = Math.ceil((4 * 1024 ** 3) / (20 * 1024 ** 2));
  const lifetimeSeconds = 1_200;
  let clock = 0;
  const issuedAt = new Map<string, number>();
  const batches: number[][] = [];
  const sent: number[] = [];
  await uploadMultipartParts({
    partNumbers: Array.from({ length: partCount }, (_, index) => index + 1),
    concurrency: 3,
    now: () => clock,
    sleep: async () => undefined,
    waitForOnline: async () => undefined,
    sign: async (partNumbers) => {
      batches.push(partNumbers);
      const urls = partNumbers.map((partNumber) => {
        const url = `https://b2.invalid/part-${partNumber}?signed=${clock}`;
        issuedAt.set(url, clock);
        return { partNumber, url };
      });
      return { urls, expiresInSeconds: lifetimeSeconds };
    },
    putPart: async (partNumber, url) => {
      assert.ok(clock - issuedAt.get(url)! < lifetimeSeconds * 1_000, `part ${partNumber} used an expired URL`);
      clock += 30_000;
      sent.push(partNumber);
    },
  });
  assert.equal(partCount, 205);
  assert.deepEqual([...sent].sort((a, b) => a - b), Array.from({ length: partCount }, (_, index) => index + 1));
  assert.ok(batches.every((batch) => batch.length <= MULTIPART_SIGN_BATCH));
  // Far fewer signing requests than parts, well inside the per-IP limit.
  assert.ok(batches.length <= 20, `signed ${batches.length} times`);
});

test("a failed part is retried with a fresh URL after growing pauses", async () => {
  const pauses: number[] = [];
  const signed: number[][] = [];
  let failures = 2;
  const used: string[] = [];
  await uploadMultipartParts({
    partNumbers: [1, 2],
    concurrency: 1,
    sleep: async (ms) => { pauses.push(ms); },
    waitForOnline: async () => undefined,
    sign: async (partNumbers) => {
      signed.push(partNumbers);
      return { urls: partNumbers.map((partNumber) => ({ partNumber, url: `u${partNumber}-${signed.length}` })), expiresInSeconds: 3_600 };
    },
    putPart: async (partNumber, url) => {
      used.push(url);
      if (partNumber === 1 && failures-- > 0) throw new Error("Upload failed (network/CORS)");
    },
  });
  assert.deepEqual(pauses, [1_000, 2_000]);
  assert.deepEqual(used, ["u1-1", "u1-2", "u1-3", "u2-1"]);
  assert.equal(multipartRetryDelayMs(8), 30_000);
});

test("a refused or expired grant stops at once instead of retrying", async () => {
  let attempts = 0;
  await assert.rejects(uploadMultipartParts({
    partNumbers: [1, 2, 3],
    concurrency: 2,
    sleep: async () => undefined,
    waitForOnline: async () => undefined,
    sign: async () => {
      attempts += 1;
      throw Object.assign(new Error("업로드 유효 시간이 만료되었습니다. 다시 시작해주세요."), { status: 410 });
    },
    putPart: async () => undefined,
  }), /만료/);
  assert.ok(attempts <= 2);
  assert.equal(isFinalUploadError(Object.assign(new Error("busy"), { status: 429 })), false);
  assert.equal(isFinalUploadError(Object.assign(new Error("server"), { status: 503 })), false);
  assert.equal(isFinalUploadError(new TypeError("Failed to fetch")), false);
});

test("completion requests are repeated after network errors, 429 and 5xx, but not after a refusal", async () => {
  const noWait = { sleep: async () => undefined, waitForOnline: async () => undefined };
  const answers: Array<number | Error> = [new TypeError("Failed to fetch"), 503, 429, 200];
  let calls = 0;
  const ok = await requestWithRetry(async () => {
    const answer = answers[calls++];
    if (answer instanceof Error) throw answer;
    return new Response("{}", { status: answer });
  }, noWait);
  assert.equal(ok.status, 200);
  assert.equal(calls, 4);

  calls = 0;
  const refused = await requestWithRetry(async () => { calls += 1; return new Response("{}", { status: 409 }); }, noWait);
  assert.equal(refused.status, 409);
  assert.equal(calls, 1);

  calls = 0;
  const stillDown = await requestWithRetry(async () => { calls += 1; return new Response("{}", { status: 503 }); }, { ...noWait, delaysMs: [1, 1] });
  assert.equal(stillDown.status, 503);
  assert.equal(calls, 3);
});
