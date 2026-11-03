import assert from "node:assert/strict";
import test from "node:test";

import { getInicisTimestamp } from "../src/lib/inicis/crypto";

test("Inicis timestamps are Korean time regardless of the server time zone", () => {
  // 2026-11-02 15:30:05 UTC is 2026-11-03 00:30:05 in Seoul.
  assert.equal(getInicisTimestamp(new Date("2026-11-02T15:30:05Z")), "20261103003005");
  assert.equal(getInicisTimestamp(new Date("2026-12-31T15:00:00Z")), "20270101000000");
});
