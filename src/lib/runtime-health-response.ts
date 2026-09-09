import { NextResponse } from "next/server";

import {
  runRuntimeConfigChecks,
  summarizeRuntimeHealth,
  type RuntimeHealthCheck,
} from "@/lib/runtime-health";
import { checkSupabaseConnection } from "@/lib/supabase/health";
import { getSupabaseEnv } from "@/lib/supabase/env";

const headers = {
  "cache-control": "no-store, max-age=0",
};

export function createRuntimeConnectivityProbe(
  probe: () => Promise<RuntimeHealthCheck[]> = checkSupabaseConnection,
  now: () => number = Date.now,
) {
  let cached: { key: string; expires: number; checks: RuntimeHealthCheck[] } | undefined;
  let pending: { key: string; promise: Promise<RuntimeHealthCheck[]> } | undefined;
  return async () => {
    const { url, anonKey } = getSupabaseEnv();
    const key = `${url}:${anonKey}`;
    if (cached?.key === key && cached.expires > now()) return cached.checks;
    if (pending?.key === key) return pending.promise;
    const promise = Promise.resolve().then(probe).catch(() => [
      { name: "supabase connectivity", ok: false, severity: "error" as const },
    ]).then((checks) => {
      cached = { key, checks, expires: now() + (checks.every((check) => check.ok) ? 10_000 : 2_000) };
      return checks;
    }).finally(() => { if (pending?.promise === promise) pending = undefined; });
    pending = { key, promise };
    return promise;
  };
}

const readRuntimeConnectivity = createRuntimeConnectivityProbe();

export async function buildRuntimeHealthPayload(connectionProbe = readRuntimeConnectivity) {
  const checks = runRuntimeConfigChecks({
    includeOptionalNotifications: true,
  });
  // /healthz stays a local liveness probe. Readiness also verifies real auth/API
  // connectivity using GET health and HEAD catalog requests, never customer rows.
  if (checks.find((check) => check.name === "supabase env")?.ok) checks.push(...await connectionProbe());
  const summary = summarizeRuntimeHealth(checks);
  return {
    payload: {
      ok: summary.ok,
      errorCount: summary.errorCount,
      warningCount: summary.warningCount,
      // Public probes need state, not deployment internals such as the exact
      // missing environment-variable names.
      checks: checks.map(({ name, ok, severity }) => ({ name, ok, severity })),
    },
    status: summary.ok ? 200 : 503,
  };
}

export async function buildRuntimeHealthResponse() {
  const { payload, status } = await buildRuntimeHealthPayload();
  return NextResponse.json(payload, { status, headers });
}

export async function buildRuntimeHealthHeadResponse() {
  const { status } = await buildRuntimeHealthPayload();
  return new Response(null, { status, headers });
}
