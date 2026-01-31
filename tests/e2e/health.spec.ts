import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";

const baseUrl = process.env.NEXT_E2E_BASE_URL;

test.describe("env health", () => {
  test.skip(!process.env.CI && !baseUrl, "Set NEXT_E2E_BASE_URL or run in CI to enable.");

  test("npm run health passes", async () => {
    const result = spawnSync("npm", ["run", "health"], {
      shell: false,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env },
    });
    if (result.status !== 0) {
      console.error(result.stdout);
      console.error(result.stderr);
    }
    expect(result.status).toBe(0);
  });
});
