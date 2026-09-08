import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isMusicArchiveDispatcherEnabled, startMusicArchiveDispatcher, stopMusicArchiveDispatcher } from "../src/lib/music-archive/dispatcher";

const env = { NODE_ENV: "production", NEXT_RUNTIME: "nodejs", RENDER: "true", npm_lifecycle_event: "start" };
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
function harness(runBatch: () => Promise<unknown>) {
  const timers: { callback: () => void; delay: number; cancelled: boolean; unrefed: boolean }[] = [];
  const logs: string[] = [];
  const controller = startMusicArchiveDispatcher({
    env, runBatch, logError: (message) => logs.push(message),
    schedule: (callback, delay) => {
      const timer = { callback, delay, cancelled: false, unrefed: false, unref() { this.unrefed = true; } };
      timers.push(timer); return timer;
    },
    cancel: (value) => { const timer = timers.find((timer) => timer === value); if (timer) timer.cancelled = true; },
  });
  assert.ok(controller);
  return { controller, timers, logs, fire: async (index: number) => { assert.equal(timers[index].cancelled, false); timers[index].callback(); await flush(); } };
}

test("dispatcher requires native production npm start and stays off for builds, dev, edge, other platforms or disabled worker", () => {
  assert.equal(isMusicArchiveDispatcherEnabled(env), true);
  const excluded = [{ NODE_ENV: "development" }, { NEXT_RUNTIME: "edge" }, { RENDER: "false" }, { npm_lifecycle_event: "build" }, { npm_lifecycle_event: "music-archive:worker" }, { NEXT_PHASE: "phase-production-build" }, { MUSIC_ARCHIVE_WORKER_DISABLED: "true" }];
  for (const change of excluded) {
    let scheduled = false;
    assert.equal(isMusicArchiveDispatcherEnabled({ ...env, ...change }), false);
    assert.equal(startMusicArchiveDispatcher({ env: { ...env, ...change }, schedule: () => { scheduled = true; return {}; } }), null);
    assert.equal(scheduled, false);
  }
  assert.equal(isMusicArchiveDispatcherEnabled({}), false);
});

test("start returns immediately, unrefs timer, runs shared batch once per tick and clears timer on stop", async () => {
  let calls = 0;
  const h = harness(async () => { calls++; });
  try {
    assert.equal(calls, 0); assert.equal(h.timers.length, 1); assert.equal(h.timers[0].delay, 3000); assert.equal(h.timers[0].unrefed, true);
    await h.fire(0); assert.equal(calls, 1); assert.equal(h.timers.length, 2); assert.equal(h.timers[1].delay, 3000);
    await h.fire(1); assert.equal(calls, 2);
    await h.controller.stop(); assert.equal(h.timers[2].cancelled, true);
  } finally { await stopMusicArchiveDispatcher(); }
});

test("repeated registration shares a singleton and never overlaps an unresolved batch", async () => {
  let calls = 0; let release!: () => void;
  const h = harness(() => { calls++; return new Promise<void>((resolve) => { release = resolve; }); });
  try {
    const second = startMusicArchiveDispatcher({ env, runBatch: async () => { throw new Error("duplicate runner"); } });
    assert.equal(second, h.controller);
    await h.fire(0); assert.equal(calls, 1); assert.equal(h.timers.length, 1);
    h.timers[0].callback(); await flush(); assert.equal(calls, 1);
    release(); await flush(); assert.equal(h.timers.length, 2);
  } finally { release?.(); await stopMusicArchiveDispatcher(); }
});

test("provider/db failures are redacted, back off 15 seconds, and recover on the next tick", async () => {
  let calls = 0;
  const h = harness(async () => { if (++calls === 1) throw new Error("secret-token https://private.test/user"); });
  try {
    await h.fire(0); assert.equal(h.timers[1].delay, 15000); assert.equal(h.logs.length, 1);
    assert.doesNotMatch(h.logs[0], /secret|private|token/);
    await h.fire(1); assert.equal(calls, 2); assert.equal(h.timers[2].delay, 3000);
  } finally { await stopMusicArchiveDispatcher(); }
});

test("stop drains an active batch without scheduling more work and permits a clean restart", async () => {
  let release!: () => void;
  const h = harness(() => new Promise<void>((resolve) => { release = resolve; }));
  await h.fire(0);
  let stopped = false;
  const stop = h.controller.stop().then(() => { stopped = true; });
  await flush(); assert.equal(stopped, false);
  assert.equal(startMusicArchiveDispatcher({ env }), h.controller);
  release(); await stop; assert.equal(h.timers.length, 1);
  const next = harness(async () => {});
  try { assert.notEqual(next.controller, h.controller); assert.equal(next.timers.length, 1); }
  finally { await stopMusicArchiveDispatcher(); }
});

test("instrumentation guards the dynamic import and never awaits archive batch work during server registration", () => {
  const source = readFileSync(new URL("../src/instrumentation.ts", import.meta.url), "utf8");
  assert.match(source, /process\.env\.NEXT_RUNTIME !== "nodejs"/);
  assert.match(source, /process\.env\.npm_lifecycle_event !== "start"/);
  assert.match(source, /process\.env\.NEXT_PHASE === "phase-production-build"/);
  assert.match(source, /void import\("\.\/lib\/music-archive\/dispatcher"\)/);
  assert.doesNotMatch(source, /await |runArchiveBatch|from ["'].*sync/);
});
