import assert from "node:assert/strict";
import test from "node:test";

import { safeAdminRedirectPath } from "../src/lib/admin/redirect";

test("safeAdminRedirectPath keeps local admin destinations", () => {
  assert.equal(
    safeAdminRedirectPath("/admin/submissions?page=2#row"),
    "/admin/submissions?page=2#row",
  );
  assert.equal(safeAdminRedirectPath("/admin"), "/admin");
});

test("safeAdminRedirectPath rejects external and non-admin destinations", () => {
  for (const value of [
    "https://evil.example/",
    "//evil.example/admin",
    "/dashboard",
    "/administrator",
    "javascript:alert(1)",
  ]) {
    assert.equal(safeAdminRedirectPath(value, "/admin/artists"), "/admin/artists");
  }
});
