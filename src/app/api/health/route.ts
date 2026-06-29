import { NextResponse } from "next/server";

import {
  runRuntimeConfigChecks,
  summarizeRuntimeHealth,
} from "@/lib/runtime-health";

export function GET() {
  const checks = runRuntimeConfigChecks({
    includeOptionalNotifications: true,
  });
  const summary = summarizeRuntimeHealth(checks);
  return NextResponse.json(
    {
      ok: summary.ok,
      errorCount: summary.errorCount,
      warningCount: summary.warningCount,
      checks,
    },
    { status: summary.ok ? 200 : 503 },
  );
}
