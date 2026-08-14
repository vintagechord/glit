import assert from "node:assert/strict";
import test from "node:test";

import { getSafeInternalPath } from "../src/lib/safe-internal-path";

test("internal redirect paths preserve safe query and hash values", () => {
  assert.equal(
    getSafeInternalPath(" /en/mypage/cart?added=123#summary "),
    "/en/mypage/cart?added=123#summary",
  );
});

test("external and backslash-normalized redirect targets are rejected", () => {
  for (const value of [
    "https://evil.example/path",
    "//evil.example/path",
    "/\\evil.example/path",
    "\\\\evil.example/path",
    "javascript:alert(1)",
    "dashboard",
  ]) {
    assert.equal(getSafeInternalPath(value), null, value);
  }
});
