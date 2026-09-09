import assert from "node:assert/strict";
import test from "node:test";
import { watchUploadProgress } from "../src/lib/upload-watchdog";

class Transfer extends EventTarget {
  upload = new EventTarget();
  aborted = 0;
  abort() { this.aborted += 1; this.dispatchEvent(new Event("loadend")); }
  progress(loaded: number, download = false) {
    const event = Object.assign(new Event("progress"), { loaded });
    (download ? this : this.upload).dispatchEvent(event);
  }
}

test("a stalled transfer rejects and aborts once, allowing the form to recover", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const xhr = new Transfer(); const failures: Error[] = [];
  watchUploadProgress(xhr as unknown as XMLHttpRequest, error => failures.push(error), 100);
  t.mock.timers.tick(100);
  assert.equal(xhr.aborted, 1);
  assert.match(failures[0].message, /다시 시도하거나 이메일/);
  t.mock.timers.tick(500);
  assert.equal(failures.length, 1);
});

test("an upload with continuing byte progress can exceed the idle timeout", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const xhr = new Transfer(); const failures: Error[] = [];
  watchUploadProgress(xhr as unknown as XMLHttpRequest, error => failures.push(error), 100);
  for (let loaded = 1; loaded <= 6; loaded++) { t.mock.timers.tick(80); xhr.progress(loaded); }
  t.mock.timers.tick(80); xhr.progress(1, true);
  assert.equal(xhr.aborted, 0); assert.deepEqual(failures, []);
  xhr.dispatchEvent(new Event("loadend"));
  t.mock.timers.tick(500);
  assert.equal(xhr.aborted, 0);
});

test("unchanged progress does not keep a dead connection alive", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const xhr = new Transfer(); const failures: Error[] = [];
  watchUploadProgress(xhr as unknown as XMLHttpRequest, error => failures.push(error), 100);
  xhr.progress(1);
  t.mock.timers.tick(80); xhr.progress(1);
  t.mock.timers.tick(20);
  assert.equal(xhr.aborted, 1); assert.equal(failures.length, 1);
});
