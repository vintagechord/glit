import assert from "node:assert/strict";
import test from "node:test";
import {
  clearMultipartResumeState,
  loadMultipartResumeState,
  runMultipartWorkers,
  saveMultipartResumeState,
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
