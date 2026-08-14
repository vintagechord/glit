import assert from "node:assert/strict";
import test from "node:test";

import { GET as getUserCancel } from "../src/app/api/service/subscription/inicis_cancel/route";
import { GET as getAdminCancel } from "../src/app/api/wmadmin/b/membership/inicis_cancel/route";

test("subscription cancellation rejects state-changing GET requests", async () => {
  for (const handler of [getUserCancel, getAdminCancel]) {
    const response = handler();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
    assert.deepEqual(await response.json(), { error: "Method Not Allowed" });
  }
});
