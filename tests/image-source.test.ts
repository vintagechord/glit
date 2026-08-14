import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedImageSource } from "../src/lib/image-source";

test("image source accepts local and configured remote image hosts", () => {
  assert.equal(isAllowedImageSource("/media/hero/poster.jpg"), true);
  assert.equal(
    isAllowedImageSource(
      "https://project.supabase.co/storage/v1/object/public/banner/a.png",
    ),
    true,
  );
  assert.equal(
    isAllowedImageSource("https://f005.backblazeb2.com/file/bucket/a.webp"),
    true,
  );
  assert.equal(isAllowedImageSource("https://image.genie.co.kr/a.jpg"), true);
});

test("image source rejects unsafe and unsupported values", () => {
  for (const value of [
    "//evil.example/banner.png",
    "javascript:alert(1)",
    "http://project.supabase.co/a.png",
    "https://example.com/a.png",
    "https://user:pass@project.supabase.co/a.png",
    "https://project.supabase.co:444/a.png",
  ]) {
    assert.equal(isAllowedImageSource(value), false, value);
  }
});
