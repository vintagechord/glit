import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { runSpellcheckPipeline } from "../../src/lib/spellcheck/engine";

function fixture(t: TestContext) {
  const prior = process.env.SPELLCHECK_SERVICE_URL;
  process.env.SPELLCHECK_SERVICE_URL = "https://spellcheck.fixture.invalid";
  t.after(() => { if (prior === undefined) delete process.env.SPELLCHECK_SERVICE_URL; else process.env.SPELLCHECK_SERVICE_URL = prior; });
  t.mock.method(console, "info", () => {});
}

test("optional spellcheck disconnect retains bundled corrections and a retry can use the recovered service", async (t) => {
  fixture(t);
  let unavailable = true, calls = 0, now = Date.now();
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (unavailable) throw new TypeError("fixture disconnect");
    return Response.json({ correctedText: "나는 가방에 들어갔어. 연결이 복구됐다." });
  });
  const input = { text: "나는 가방에 드러갓어. 연결 점검.", mode: "balanced" as const, domain: "general" as const };
  const first = await runSpellcheckPipeline(input);
  assert.ok(first.correctedText.includes("들어갔어"));
  assert.equal(first.meta.providers.find((provider) => provider.name === "external_api")?.ok, false);
  unavailable = false; now += 6_000;
  const recovered = await runSpellcheckPipeline(input);
  assert.equal(calls, 2, "a degraded result must not be cached for five minutes");
  assert.equal(recovered.meta.providers.find((provider) => provider.name === "external_api")?.ok, true);
});

test("a hanging spellcheck service is aborted at its deadline while local corrections still return", async (t) => {
  fixture(t);
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => { signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }); });
  });
  const result = await runSpellcheckPipeline({ text: "나는 가방에 드러갓어. 대기 시간 검사.", mode: "balanced", domain: "general" });
  assert.equal(signal?.aborted, true);
  assert.ok(result.correctedText.includes("들어갔어"));
  assert.deepEqual(result.meta.providers.find((provider) => provider.name === "external_api")?.warnings, ["timeout"]);
});
