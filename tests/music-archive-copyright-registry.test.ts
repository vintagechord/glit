import assert from "node:assert/strict";
import test from "node:test";
import { CopyrightRegistryError, copyrightRegistryQuerySchema, getCopyrightRegistrationDetail, searchCopyrightRegistrations } from "../src/lib/music-archive/copyright-registry";

const row = { REG_ID: "C-2026-000001", CONT_TITLE: "동명 작품", AUTHOR_NAME: "합성 저작자", REG_DATE: "2026-09-08" };
const payload = (data: unknown[] = [row], values: Record<string, unknown> = {}) => ({ page: 1, perPage: 10, currentCount: data.length, matchCount: data.length, totalCount: 780000, data, ...values });
const now = () => new Date("2026-09-08T12:00:00Z");

test("uses the published API parameters and returns attributed candidates without asserting member rights", async () => {
  let calls = 0;
  const fetchImpl = (async (input, init) => {
    calls++; const url = new URL(String(input));
    assert.equal(url.origin, "https://api.odcloud.kr");
    assert.equal(url.pathname, "/api/CpyrRegInforService/v1/getCpyrRegInforUniList");
    assert.equal(url.searchParams.get("cond[CONT_TITLE::LIKE]"), "제목 & 구분");
    assert.equal(url.searchParams.get("cond[AUTHOR_NAME::LIKE]"), "저작자");
    assert.equal(url.searchParams.get("perPage"), "10");
    assert.equal(url.searchParams.get("serviceKey"), "test-key+/=");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    return Response.json(payload([{ ...row, DISPOSAL_NAME: "not requested", PRIVATE_UNKNOWN_FIELD: "discard" }], { matchCount: 11 }));
  }) as typeof fetch;
  const result = await searchCopyrightRegistrations({ title: "제목 & 구분", writer: "저작자" }, { apiKey: "test-key+/=", fetchImpl, now });
  assert.equal(calls, 1); assert.equal(result.status, "success"); assert.equal(result.nextPage, 2);
  assert.deepEqual(result.candidates[0], { provider: "copyright_commission", registrationNumber: row.REG_ID, title: row.CONT_TITLE, authorName: row.AUTHOR_NAME, registrationDate: row.REG_DATE, officialUrl: "https://www.data.go.kr/data/15106731/openapi.do", checkedAt: now().toISOString() });
  assert.ok(!JSON.stringify(result).includes("test-key"));
  assert.ok(!JSON.stringify(result).includes("DISPOSAL_NAME"));
  assert.ok(!("completed" in result)); assert.ok(!("ownershipVerified" in result));
});

test("a real zero-result envelope is distinct from missing credentials and provider failures", async () => {
  const result = await searchCopyrightRegistrations({ writer: "일치하지 않음" }, { apiKey: "test", fetchImpl: (async () => Response.json(payload([]))) as typeof fetch, now });
  assert.equal(result.status, "no_results"); assert.equal(result.matchCount, 0); assert.equal(result.nextPage, null);
  let requests = 0;
  await assert.rejects(searchCopyrightRegistrations({ title: "작품" }, { apiKey: " ", fetchImpl: (async () => { requests++; throw new Error("unexpected"); }) as typeof fetch }),
    (error) => error instanceof CopyrightRegistryError && error.code === "CONFIGURATION_REQUIRED");
  assert.equal(requests, 0);
  for (const [status, code] of [[401, "PERMISSION_REQUIRED"], [403, "PERMISSION_REQUIRED"], [429, "RATE_LIMIT"], [503, "TEMPORARY_ERROR"]] as const) {
    await assert.rejects(searchCopyrightRegistrations({ title: "작품" }, { apiKey: "test", fetchImpl: (async () => new Response("secret response", { status })) as typeof fetch }),
      (error) => error instanceof CopyrightRegistryError && error.code === code && !error.message.includes("secret"));
  }
});

test("explicit detail checks work type and registration identity without copying private extras", async () => {
  const result = await getCopyrightRegistrationDetail(row.REG_ID, { apiKey: "test", now, fetchImpl: (async input => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/CpyrRegInforService/v1/getCpyrRegInforUniDetail");
    assert.equal(url.searchParams.get("cond[REG_ID::EQ]"), row.REG_ID);
    return Response.json(payload([{ ...row, CONT_CLASS_NAME: "음악", REG_REASON: "unused", DISPOSAL_NAME: "unused" }]));
  }) as typeof fetch });
  assert.equal(result?.workType, "음악");
  assert.ok(!JSON.stringify(result).includes("unused"));
  await assert.rejects(getCopyrightRegistrationDetail(row.REG_ID, { apiKey: "test", fetchImpl: (async () => Response.json(payload([{ ...row, REG_ID: "different" }]))) as typeof fetch }),
    (error) => error instanceof CopyrightRegistryError && error.code === "INVALID_RESPONSE");
});

test("wrong page, malformed and oversized responses fail closed instead of claiming a successful lookup", async () => {
  for (const response of [Response.json(payload([row], { page: 2 })), Response.json({ data: [] }), Response.json(payload([row], { currentCount: 0 })), new Response("not JSON"), new Response("x", { headers: { "Content-Length": "1048577" } }), new Response("x".repeat(1048577))]) {
    await assert.rejects(searchCopyrightRegistrations({ title: "곡" }, { apiKey: "test", fetchImpl: (async () => response) as typeof fetch }),
      (error) => error instanceof CopyrightRegistryError && error.code === "INVALID_RESPONSE");
  }
});

test("raw network exceptions cannot expose service keys", async () => {
  await assert.rejects(searchCopyrightRegistrations({ title: "곡" }, { apiKey: "sensitive-key", fetchImpl: (async () => { throw new Error("request failed https://api.odcloud.kr/?serviceKey=sensitive-key"); }) as typeof fetch }),
    (error) => error instanceof CopyrightRegistryError && error.code === "TEMPORARY_ERROR" && !error.message.includes("sensitive-key"));
});

test("empty searches, excessive pagination and injected API targets are rejected before requests", () => {
  for (const input of [{}, { title: " " }, { title: "x".repeat(201) }, { title: "곡\n명" }, { writer: "a", page: 0 }, { writer: "a", page: 101 }, { title: "곡", url: "https://localhost" }, { title: "곡", serviceKey: "injected" }]) {
    assert.equal(copyrightRegistryQuerySchema.safeParse(input).success, false);
  }
});
