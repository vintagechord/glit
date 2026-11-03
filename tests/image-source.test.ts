import assert from "node:assert/strict";
import test from "node:test";

import { matchRemotePattern } from "next/dist/shared/lib/match-remote-pattern";
import { buildImageRemotePatterns } from "../src/lib/image-remote-patterns";
import { isAllowedImageSource } from "../src/lib/image-source";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  B2_S3_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  B2_BUCKET: "onside-files",
};

const accepted = [
  "https://project.supabase.co/storage/v1/object/public/banner/a.png",
  "https://project.supabase.co/storage/v1/object/sign/banner/a.png?token=x",
  "https://s3.us-west-004.backblazeb2.com/onside-files/banner/a.webp",
  "https://onside-files.s3.us-west-004.backblazeb2.com/banner/a.webp",
  "https://image.genie.co.kr/a.jpg",
];
const rejected = [
  "https://otherproject.supabase.co/storage/v1/object/public/banner/a.png",
  "https://project.supabase.co/rest/v1/profiles",
  "https://f005.backblazeb2.com/file/bucket/a.webp",
  "https://s3.us-west-004.backblazeb2.com/someone-elses-bucket/a.png",
  "https://attacker.s3.us-west-004.backblazeb2.com/a.png",
  "http://project.supabase.co/storage/v1/object/public/banner/a.png",
  "https://example.com/a.png",
];

test("image source accepts local paths and only the storage next/image optimizes", () => {
  assert.equal(isAllowedImageSource("/media/hero/poster.jpg", env), true);
  for (const value of accepted) assert.equal(isAllowedImageSource(value, env), true, value);
  for (const value of rejected) assert.equal(isAllowedImageSource(value, env), false, value);
});

test("the save-time check agrees with next/image's matcher for the same patterns", () => {
  const patterns = buildImageRemotePatterns(env);
  for (const value of [...accepted, ...rejected]) {
    const optimized = patterns.some((pattern) => matchRemotePattern(pattern, new URL(value)));
    assert.equal(isAllowedImageSource(value, env), optimized, value);
  }
});

test("missing storage settings leave only local paths and the music cover host", () => {
  assert.equal(isAllowedImageSource("/media/hero/poster.jpg", {}), true);
  assert.equal(isAllowedImageSource("https://image.genie.co.kr/a.jpg", {}), true);
  assert.equal(isAllowedImageSource(accepted[0], {}), false);
  assert.equal(isAllowedImageSource(accepted[2], {}), false);
  // Local Supabase keeps its own port.
  const local = { SUPABASE_URL: "http://127.0.0.1:54321" };
  assert.equal(isAllowedImageSource("http://127.0.0.1:54321/storage/v1/object/public/banner/a.png", local), true);
  assert.equal(isAllowedImageSource("http://127.0.0.1:9999/storage/v1/object/public/banner/a.png", local), false);
});

test("image source rejects unsafe and unsupported values", () => {
  for (const value of [
    "//evil.example/banner.png",
    "/\\evil.example/banner.png",
    "javascript:alert(1)",
    "https://user:pass@project.supabase.co/storage/v1/object/public/banner/a.png",
    "https://project.supabase.co:444/storage/v1/object/public/banner/a.png",
    "https://image.genie.co.kr:8443/a.jpg",
    "",
  ]) {
    assert.equal(isAllowedImageSource(value, env), false, value);
  }
});
