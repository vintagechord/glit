import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("public banner renderers reject protocol-relative and unknown schemes", () => {
  for (const path of [
    "src/components/site/home-hero-ad-banner-client.tsx",
    "src/components/site/strip-ad-banner-client.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /raw\.startsWith\("\/\/"\)\) return null/);
    assert.match(source, /raw\.includes\(":\/\/"\)\) return null/);
  }

  const leftBanner = read("src/components/site/left-ad-banner.tsx");
  assert.match(leftBanner, /parsed\.protocol === "https:"/);
  assert.match(leftBanner, /parsed\.protocol === "http:"/);
});
