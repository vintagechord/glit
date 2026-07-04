import { NextResponse } from "next/server";

import {
  runRuntimeConfigChecks,
  summarizeRuntimeHealth,
} from "@/lib/runtime-health";

const headers = {
  "cache-control": "no-store, max-age=0",
};

export function buildRuntimeHealthPayload() {
  const checks = runRuntimeConfigChecks({
    includeOptionalNotifications: true,
  });
  const summary = summarizeRuntimeHealth(checks);
  return {
    payload: {
      ok: summary.ok,
      errorCount: summary.errorCount,
      warningCount: summary.warningCount,
      checks,
    },
    status: summary.ok ? 200 : 503,
  };
}

export function buildRuntimeHealthResponse() {
  const { payload, status } = buildRuntimeHealthPayload();
  return NextResponse.json(payload, { status, headers });
}

export function buildRuntimeHealthHeadResponse() {
  const { status } = buildRuntimeHealthPayload();
  return new Response(null, { status, headers });
}
