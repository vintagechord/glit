#!/usr/bin/env tsx
/**
 * Lightweight environment and API contract health checks.
 *
 * Run via: npm run health
 */

import process from "node:process";
import { loadEnvConfig } from "@next/env";

import {
  runRuntimeConfigChecks,
  summarizeRuntimeHealth,
} from "../src/lib/runtime-health";

loadEnvConfig(process.cwd());

const checks = runRuntimeConfigChecks({ strict: true });
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
