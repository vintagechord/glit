import assert from "node:assert/strict";
import test from "node:test";
import { checkSupabaseConfig, checkSupabaseConnection } from "../src/lib/supabase/health";
import { validateSupabaseUrl } from "../src/lib/supabase/env";

async function withEnv(run: () => unknown) {
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
  try { await run(); } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

test("Supabase config accepts supported publishable-key alias and rejects malformed or secret public config", async () => withEnv(() => {
  assert.equal(checkSupabaseConfig().ok, true);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://user:secret@project.supabase.co";
  assert.equal(checkSupabaseConfig().ok, false);
  assert.doesNotMatch(checkSupabaseConfig().detail ?? "", /user:secret/);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_secret_do_not_expose";
  assert.equal(checkSupabaseConfig().ok, false);
}));

test("Supabase URL validation permits local/test URLs but rejects unsafe syntax", () => {
  assert.equal(validateSupabaseUrl("http://localhost:54321/"), "http://localhost:54321");
  for (const value of ["not a url", "file:///etc/passwd", "https://host/path?key=value", "https://host/#fragment"]) assert.throws(() => validateSupabaseUrl(value));
});

test("live health verifies Auth and catalog read-only without sending service credentials", async () => withEnv(async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetcher: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), method: String(options?.method) });
    assert.equal(new Headers(options?.headers).get("apikey"), "sb_publishable_test");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    return new Response(null, { status: 200 });
  };
  const checks = await checkSupabaseConnection(fetcher);
  assert.equal(checks.every((check) => check.ok), true);
  assert.deepEqual(calls, [
    { url: "https://project.supabase.co/auth/v1/health", method: "GET" },
    { url: "https://project.supabase.co/rest/v1/packages?select=id&limit=0", method: "HEAD" },
  ]);
}));

test("live health identifies DNS outage and HTTP failures with redacted diagnostics", async () => withEnv(async () => {
  const unreachable: typeof fetch = async () => { throw new TypeError("fetch failed secret payload", { cause: { code: "ENOTFOUND" } }); };
  const checks = await checkSupabaseConnection(unreachable);
  assert.equal(checks.every((check) => !check.ok), true);
  assert.match(checks[0].detail ?? "", /DNS resolution failed/);
  assert.doesNotMatch(JSON.stringify(checks), /secret payload/);
  const invalidKey: typeof fetch = async () => new Response(null, { status: 401 });
  assert.match((await checkSupabaseConnection(invalidKey))[0].detail ?? "", /HTTP 401/);
}));
