import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { translateLyricsBatch } from "../src/lib/server-lyrics-translation";

const privateMarker = "private-lyrics-or-credentials-do-not-log";

function captureDiagnostics(t: TestContext, apiKey?: string) {
  const originalKey = process.env.OPENAI_API_KEY;
  if (apiKey) process.env.OPENAI_API_KEY = apiKey;
  else delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  return {
    logs,
    diagnostics: () => logs.filter(([label]) => label === "[translate] provider failed").map(([, details]) => details),
    assertPrivate: () => {
      const output = JSON.stringify(logs);
      assert.ok(!output.includes(privateMarker));
      assert.ok(!output.includes("https://"));
    },
  };
}

test("provider diagnostics distinguish missing configuration and HTTP failures without exposing bodies or lyrics", async (t) => {
  const captured = captureDiagnostics(t);
  const result = await translateLyricsBatch([privateMarker], {
    fetchImpl: async (input) => new Response(privateMarker, {
      status: new URL(String(input)).hostname === "translate.googleapis.com" ? 429 : 403,
    }),
  });
  assert.deepEqual(result, [""]);
  assert.deepEqual(captured.diagnostics(), [
    { provider: "openai", category: "not_configured" },
    { provider: "google", category: "http", status: 429 },
    { provider: "lingva", category: "http", status: 403 },
    { provider: "google", category: "http", status: 429 },
    { provider: "lingva", category: "http", status: 403 },
  ]);
  captured.assertPrivate();
});

test("network and timeout diagnostics do not include raw error messages", async (t) => {
  const captured = captureDiagnostics(t);
  assert.deepEqual(await translateLyricsBatch([privateMarker], {
    fetchImpl: async (input) => {
      if (new URL(String(input)).hostname === "translate.googleapis.com") throw new TypeError(privateMarker);
      throw new DOMException(privateMarker, "TimeoutError");
    },
  }), [""]);
  assert.ok(captured.diagnostics().some((entry) => JSON.stringify(entry) === JSON.stringify({ provider: "google", category: "network" })));
  assert.ok(captured.diagnostics().some((entry) => JSON.stringify(entry) === JSON.stringify({ provider: "lingva", category: "timeout" })));
  captured.assertPrivate();
});

test("OpenAI HTTP diagnostics preserve fallback ordering and keep credentials private", async (t) => {
  const captured = captureDiagnostics(t, privateMarker);
  const calls: string[] = [];
  assert.deepEqual(await translateLyricsBatch([privateMarker], {
    fetchImpl: async (input) => {
      const host = new URL(String(input)).hostname;
      calls.push(host);
      if (host === "api.openai.com") return new Response(privateMarker, { status: 401 });
      return Response.json([[["번역 결과"]]]);
    },
  }), ["번역 결과"]);
  assert.deepEqual(calls, ["api.openai.com", "translate.googleapis.com"]);
  assert.deepEqual(captured.diagnostics(), [{ provider: "openai", category: "http", status: 401 }]);
  captured.assertPrivate();
});

test("malformed provider responses are safely diagnosed and the next provider still succeeds", async (t) => {
  const captured = captureDiagnostics(t);
  assert.deepEqual(await translateLyricsBatch([privateMarker], {
    fetchImpl: async (input) => {
      if (new URL(String(input)).hostname === "translate.googleapis.com") return new Response(privateMarker);
      return Response.json({ translation: "번역 결과" });
    },
  }), ["번역 결과"]);
  assert.deepEqual(captured.diagnostics(), [
    { provider: "openai", category: "not_configured" },
    { provider: "google", category: "invalid_response", status: 200 },
  ]);
  captured.assertPrivate();
});
