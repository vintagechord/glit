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
  ]);
  captured.assertPrivate();
});

// Production 2026-11-16 and 11-19: the free Google route answered 429 and
// Lingva 403 to every request from the server. Each lyric line was still sent
// to both, twice, so one song made hundreds of requests that could not
// succeed and the customer waited for all of them before seeing the failure.
test("a provider that refuses the server is not asked again for the rest of the request", async (t) => {
  const captured = captureDiagnostics(t);
  const lines = Array.from({ length: 40 }, (_, index) => `Stay with me tonight number ${index + 1}`);
  const calls = { google: 0, lingva: 0 };
  const started = Date.now();
  const result = await translateLyricsBatch(lines, {
    fetchImpl: async (input) => {
      const google = new URL(String(input)).hostname === "translate.googleapis.com";
      calls[google ? "google" : "lingva"] += 1;
      return new Response("refused", { status: google ? 429 : 403 });
    },
  });
  assert.deepEqual(result, lines.map(() => ""));
  // Lines already in flight when the refusal arrives may each have asked once.
  assert.ok(calls.google <= 3, `google asked ${calls.google} times`);
  assert.ok(calls.lingva <= 3, `lingva asked ${calls.lingva} times`);
  assert.ok(Date.now() - started < 1_500, "no retry delays once nobody is left to ask");
  assert.ok(captured.logs.filter(([label]) => label === "[translate] failed attempt").length <= 3, "one failure line per line that was really tried");
  captured.assertPrivate();
});

test("one provider refusing does not stop the other, and a passing failure is still retried", async (t) => {
  captureDiagnostics(t);
  const lines = Array.from({ length: 12 }, (_, index) => `Hold me close ${index + 1}`);
  let google = 0;
  assert.deepEqual(await translateLyricsBatch(lines, {
    fetchImpl: async (input) => {
      if (new URL(String(input)).hostname === "translate.googleapis.com") { google += 1; return new Response("refused", { status: 429 }); }
      return Response.json({ translation: `꼭 안아줘 ${decodeURIComponent(String(input).split("/").at(-1) ?? "").split(" ").at(-1)}` });
    },
  }), lines.map((_, index) => `꼭 안아줘 ${index + 1}`));
  assert.ok(google <= 3, `google asked ${google} times`);

  // A 500 or a dropped connection may pass: the same provider is asked again.
  let attempts = 0;
  assert.deepEqual(await translateLyricsBatch(["Hold me close"], {
    fetchImpl: async (input) => {
      if (new URL(String(input)).hostname !== "translate.googleapis.com") return new Response("down", { status: 500 });
      attempts += 1;
      return attempts === 1 ? new Response("down", { status: 500 }) : Response.json([[["꼭 안아줘"]]]);
    },
  }), ["꼭 안아줘"]);
  assert.equal(attempts, 2);
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
