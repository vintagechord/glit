import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { handleMobiliansReturn } from "../src/app/api/mobilians/return/handler";

test("Mobilians return handler parses text/html URL-encoded callbacks", async () => {
  const req = new NextRequest("https://onside.co.kr/api/mobilians/return", {
    method: "POST",
    headers: {
      "content-type": "text/html; charset=euc-kr",
    },
    body: "code=9999&amount=1000&message=failed",
  });

  const res = await handleMobiliansReturn(req);
  const location = res.headers.get("location") ?? "";

  assert.equal(res.status, 303);
  assert.match(location, /status=ERROR/);
  assert.match(location, /resultCode=9999/);
});
