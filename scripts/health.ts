#!/usr/bin/env tsx
/**
 * Lightweight environment and API contract health checks.
 *
 * Run via: npm run health
 */

import process from "node:process";
import { loadEnvConfig } from "@next/env";
import { checkSupabaseConnection } from "../src/lib/supabase/health";

import {
  runRuntimeConfigChecks,
  summarizeRuntimeHealth,
} from "../src/lib/runtime-health";

loadEnvConfig(process.cwd());

async function main() {
  const live = process.argv.includes("--live");
  const checks = runRuntimeConfigChecks({ strict: true });
  if (live) checks.push(...await checkSupabaseConnection());
  const summary = summarizeRuntimeHealth(checks);

  checks.forEach((check) => {
    const marker = check.ok ? "ok" : check.severity === "warning" ? "warn" : "fail";
    const detail = check.detail ? `: ${check.detail}` : "";
    console.log(`[${marker}] ${check.name}${detail}`);
  });

  if (!summary.ok) {
    process.exitCode = 1;
    console.error(
      `\nHealth failed (${summary.errorCount} error${
        summary.errorCount > 1 ? "s" : ""
      }, ${summary.warningCount} warning${summary.warningCount > 1 ? "s" : ""}).`,
    );
  } else {
    console.log(
      `\nAll required configuration is present (${summary.warningCount} warning${
        summary.warningCount > 1 ? "s" : ""
      }).`,
    );
  }
  if (!live) console.log("Connectivity was not tested. Run npm run health -- --live for read-only Auth and product catalog checks.");
}

void main().catch(() => {
  console.error("Health checks could not complete.");
  process.exitCode = 1;
});
