import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { matchRemotePattern } from "next/dist/shared/lib/match-remote-pattern";
import { buildImageRemotePatterns } from "../next.config";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://ownproject.supabase.co",
  B2_S3_ENDPOINT: "https://s3.us-west-004.backblazeb2.com/",
  B2_BUCKET: "onside-files",
};
const allowed = (patterns: ReturnType<typeof buildImageRemotePatterns>, href: string) =>
  patterns.some((pattern) => matchRemotePattern(pattern, new URL(href)));

test("the image optimizer accepts only this project's Supabase storage and B2 bucket", () => {
  const patterns = buildImageRemotePatterns(env);
  for (const href of [
    "https://ownproject.supabase.co/storage/v1/object/public/banner/a.png",
    "https://ownproject.supabase.co/storage/v1/object/sign/banner/a.png?token=x",
    "https://s3.us-west-004.backblazeb2.com/onside-files/submissions/a.png?X-Amz-Signature=x",
    "https://onside-files.s3.us-west-004.backblazeb2.com/submissions/a.png",
    "https://image.genie.co.kr/Y/IMAGE/a.jpg",
  ]) assert.equal(allowed(patterns, href), true, href);
  for (const href of [
    "https://otherproject.supabase.co/storage/v1/object/public/banner/a.png",
    "https://ownproject.supabase.co.evil.example/storage/v1/object/public/a.png",
    "https://ownproject.supabase.co/rest/v1/profiles",
    "https://s3.us-west-004.backblazeb2.com/someone-elses-bucket/a.png",
    "https://attacker.s3.us-west-004.backblazeb2.com/onside-files/a.png",
    "https://f004.backblazeb2.com/file/onside-files/a.png",
    "http://ownproject.supabase.co/storage/v1/object/public/banner/a.png",
    "https://ownproject.supabase.co:8443/storage/v1/object/public/banner/a.png",
  ]) assert.equal(allowed(patterns, href), false, href);
});

test("missing or unusable storage settings add no storage host instead of a wildcard", () => {
  const empty = buildImageRemotePatterns({});
  assert.deepEqual(empty.map((pattern) => pattern.hostname), ["image.genie.co.kr"]);
  const invalid = buildImageRemotePatterns({ NEXT_PUBLIC_SUPABASE_URL: "not a url", B2_S3_ENDPOINT: "https://s3.example.invalid", B2_BUCKET: "*" });
  assert.deepEqual(invalid.map((pattern) => pattern.hostname), ["image.genie.co.kr"]);
  // Local Supabase keeps working with its own port.
  const local = buildImageRemotePatterns({ SUPABASE_URL: "http://127.0.0.1:54321" });
  assert.equal(allowed(local, "http://127.0.0.1:54321/storage/v1/object/public/banner/a.png"), true);
  assert.equal(allowed(local, "http://127.0.0.1:9999/storage/v1/object/public/banner/a.png"), false);
  const config = readFileSync("next.config.ts", "utf8");
  assert.doesNotMatch(config, /hostname: "[^"]*\*/, "no wildcard hostnames");
  assert.match(config, /remotePatterns: imageRemotePatterns/);
});
