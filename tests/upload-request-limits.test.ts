import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { UPLOAD_REQUESTS_PER_IP_PER_HOUR } from "../src/lib/upload-request-limits";

// Every upload start shared one per-IP counter capped at 60 an hour, and so did
// every completion, while one application may hold 100 files. The 61st file of
// a single 100-track album was refused with 429 for up to an hour.

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("one IP can start and finish every file of a full application, with a fallback start for each", () => {
  const actions = read("src/features/submissions/actions.ts");
  const caps = ["MAX_ALBUM_TRACKS", "MAX_SUBMISSION_FILES"].map((name) => {
    const match = actions.match(new RegExp(`const ${name} = (\\d+);`));
    assert.ok(match, `${name} is defined`);
    return Number(match[1]);
  });
  assert.ok(UPLOAD_REQUESTS_PER_IP_PER_HOUR >= 2 * Math.max(...caps));
});

const sites: Array<[string, string]> = [
  ["src/app/api/uploads/init/route.ts", "upload-init-ip"],
  ["src/app/api/uploads/multipart/init/route.ts", "upload-init-ip"],
  ["src/app/api/uploads/direct/route.ts", "upload-init-ip"],
  ["src/app/api/uploads/presign/route.ts", "upload-init-ip"],
  ["src/app/api/upload-url/route.ts", "upload-init-ip"],
  ["src/app/api/uploads/complete/route.ts", "upload-complete-ip"],
  ["src/app/api/uploads/multipart/complete/route.ts", "upload-multipart-complete-ip"],
];

for (const [path, namespace] of sites) {
  test(`${path} limits ${namespace} with the shared hourly allowance`, () => {
    const source = read(path);
    const call = source.match(new RegExp(`namespace: "${namespace}"[\\s\\S]{0,200}?limit: ([A-Z_0-9]+)`));
    assert.ok(call, `${namespace} limiter found`);
    assert.equal(call[1], "UPLOAD_REQUESTS_PER_IP_PER_HOUR");
  });
}
