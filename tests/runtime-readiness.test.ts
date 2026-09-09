import assert from "node:assert/strict";
import test from "node:test";
import { buildRuntimeHealthPayload, createRuntimeConnectivityProbe } from "../src/lib/runtime-health-response";
import { GET as liveness } from "../src/app/healthz/route";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://readiness-fixture.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fixture-public-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-key";
process.env.NEXT_PUBLIC_SITE_URL = "https://app.fixture.invalid";
process.env.B2_S3_ENDPOINT = "https://s3.fixture.invalid";
process.env.B2_REGION = "fixture-region"; process.env.B2_BUCKET = "fixture-bucket";
process.env.B2_KEY_ID = "fixture-key"; process.env.B2_APPLICATION_KEY = "fixture-private-key";
process.env.INICIS_ENV = "prod"; process.env.INICIS_MID_PROD = "fixture-mid"; process.env.INICIS_SIGN_KEY_PROD = "fixture-sign";

test("configured but disconnected database fails readiness without exposing deployment secrets; liveness survives", async () => {
  const readiness = await buildRuntimeHealthPayload(async () => [{ name: "supabase auth connectivity", ok: false, severity: "error", detail: "private-token https://private.fixture.invalid" }]);
  assert.equal(readiness.status, 503); assert.equal(readiness.payload.ok, false);
  assert.ok(readiness.payload.checks.some((check) => check.name === "supabase auth connectivity" && !check.ok));
  assert.doesNotMatch(JSON.stringify(readiness), /private-token|private\.fixture|fixture-service|fixture-sign/);
  assert.equal(liveness().status, 200); assert.equal(await liveness().text(), "ok");
});

test("readiness deduplicates concurrent probes, retries failures promptly and can recover", async () => {
  let now = 0, calls = 0, connected = false;
  const probe = createRuntimeConnectivityProbe(async () => {
    calls++;
    return [{ name: "supabase auth connectivity", ok: connected, severity: "error" }];
  }, () => now);
  await Promise.all([probe(), probe(), probe()]); assert.equal(calls, 1);
  connected = true; now = 2_001;
  const recovered = await buildRuntimeHealthPayload(probe);
  assert.equal(calls, 2); assert.equal(recovered.status, 200);
  now += 5_000; await probe(); assert.equal(calls, 2);
  now += 5_001; await probe(); assert.equal(calls, 3);
});
