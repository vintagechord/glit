import assert from "node:assert/strict";
import test from "node:test";
import {
  copyrightLookupInputSchema, prepareCopyrightLookup,
} from "../src/lib/music-archive/copyright-providers";

test("KOMCA opens its verified official search page without fabricated lookup or rights", () => {
  const result = prepareCopyrightLookup({ agency: "komca", title: "같은 이름의 노래", writer: "동명 작곡가" });
  assert.equal(result.officialUrl, "https://www.komca.or.kr/srch2/srch_01.jsp");
  assert.equal(result.copyText, "작품명: 같은 이름의 노래\n저작자: 동명 작곡가");
  for (const field of ["status", "checkedAt", "candidates", "owner", "ownershipVerified", "completed", "registered", "rights", "statusChanged"]) assert.ok(!(field in result));
});

test("KOSCAP navigation uses the observed public GET form, preserving Korean and punctuation", () => {
  const result = prepareCopyrightLookup({ agency: "koscap", title: "  봄 & 달빛 (Clean)  ", writer: "작사자/작곡가 + A" });
  const url = new URL(result.officialUrl);
  assert.equal(url.origin, "https://www.koscap.or.kr");
  assert.equal(url.pathname, "/v2/music/search_list");
  assert.equal(url.searchParams.get("f_song_name"), "봄 & 달빛 (Clean)");
  assert.equal(url.searchParams.get("f_artist"), "작사자/작곡가 + A");
  assert.equal(url.searchParams.get("page_cnt"), "10");
  assert.equal(url.searchParams.size, 3);
});

test("lookup preparation never performs external requests even with a supplied search term", (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("unlicensed provider request attempted"); });
  for (const agency of ["komca", "koscap"] as const) {
    assert.doesNotThrow(() => prepareCopyrightLookup({ agency, writer: "저작자" }));
    const titleOnly = prepareCopyrightLookup({ agency, title: "곡명" });
    assert.equal(titleOnly.query.writer, "");
    assert.ok(!titleOnly.copyText.includes("undefined"));
  }
});

test("untrusted query fields cannot become a custom host, protocol, path or extra form parameter", () => {
  const result = prepareCopyrightLookup({ agency: "koscap", title: "https://127.0.0.1/x?admin=true&f_artist=fake", writer: '<script>alert("x")</script>' });
  const url = new URL(result.officialUrl);
  assert.equal(url.origin, "https://www.koscap.or.kr");
  assert.equal(url.searchParams.get("admin"), null);
  assert.equal(url.searchParams.get("f_song_name"), result.query.title);
  assert.equal(url.searchParams.get("f_artist"), result.query.writer);
  for (const input of [
    { agency: "komca", title: "", writer: " " },
    { agency: "unknown", title: "곡" },
    { agency: "koscap", title: "x".repeat(201) },
    { agency: "koscap", title: "곡\n다른 줄" },
    { agency: "koscap", writer: "이름\u0000" },
    { agency: "koscap", title: "곡", officialUrl: "http://localhost" },
    { agency: "koscap", title: "곡", automaticApproved: true },
  ]) assert.equal(copyrightLookupInputSchema.safeParse(input).success, false);
});
