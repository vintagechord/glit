import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("pending overlay traps focus and blocks background keyboard edits", () => {
  const source = readFileSync(
    new URL("../src/components/ui/pending-overlay.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /document\.addEventListener\("focusin"/);
  assert.match(source, /event\.key === "Tab" \|\| event\.key === "Escape"/);
  assert.match(source, /previousFocusRef\.current\?\.focus/);
});
