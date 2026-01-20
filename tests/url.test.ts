import assert from "node:assert/strict";
import test from "node:test";

import { buildUrl } from "../src/lib/url";

test("buildUrl normalizes trailing slashes", () => {
  const url = buildUrl("/api/inicis/return", "https://example.com/");
  assert.equal(url, "https://example.com/api/inicis/return");
});

test("buildUrl preserves query params without duplication", () => {
  const url = buildUrl("/api/inicis/close?oid=abc&cancel=1", "https://example.com/base");
  assert.equal(url, "https://example.com/api/inicis/close?oid=abc&cancel=1");
});
