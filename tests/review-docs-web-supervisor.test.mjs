import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { startReviewWebServices } from "../scripts/review-docs/start-web.mjs";

function fixture() {
  const children = [], timers = [], signals = [];
  const controller = startReviewWebServices({
    env: { NODE_ENV: "production", FIXTURE: "yes" },
    spawn: (executable, args, options) => {
      const child = Object.assign(new EventEmitter(), { pid: children.length + 100, executable, args, options });
      children.push(child); return child;
    },
    schedule: (callback, delay) => { const timer = { callback, delay, cancelled: false, unref() {} }; timers.push(timer); return timer; },
    cancel: (timer) => { timer.cancelled = true; },
    kill: (child, signal) => { if (child) signals.push([child.pid, signal]); },
  });
  return { controller, children, timers, signals };
}

test("combined container launches real web and checked worker commands and retries worker exits once", () => {
  const f = fixture();
  assert.equal(f.children.length, 2);
  assert.deepEqual(f.children[0].args, ["node_modules/next/dist/bin/next", "start"]);
  assert.equal(f.children[0].options.env.npm_lifecycle_event, "start");
  assert.equal(f.children[1].args.at(-1), "scripts/review-docs/worker.ts");
  f.children[1].emit("error", new Error("fixture")); f.children[1].emit("exit", 1);
  assert.equal(f.timers.length, 1); assert.equal(f.timers[0].delay, 15_000);
  f.timers[0].callback(); assert.equal(f.children.length, 3);
  f.controller.stop();
  assert.deepEqual(f.signals, [[100, "SIGTERM"], [102, "SIGTERM"]]);
  f.children[2].emit("exit", 0);
  assert.equal(f.timers.length, 2, "shutdown must not restart the worker");
});

test("web failure shuts down the worker and pending restart cannot resurrect it", () => {
  const previous = process.exitCode;
  const f = fixture();
  try {
    f.children[1].emit("exit", 1);
    f.children[0].emit("exit", 1);
    assert.equal(f.timers[0].cancelled, true);
    f.timers[0].callback(); assert.equal(f.children.length, 2);
    f.timers[1].callback(); assert.ok(f.signals.some(([, signal]) => signal === "SIGKILL"));
  } finally { process.exitCode = previous; }
});
