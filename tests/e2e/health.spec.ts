import { test, expect } from "@playwright/test";

const baseUrl = process.env.NEXT_E2E_BASE_URL;

test.describe("env health", () => {
  test.skip(!process.env.CI && (!baseUrl || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)),
    "Set NEXT_E2E_BASE_URL to a deployed environment; local dev servers do not hold production mail secrets.");

  test("deployed health endpoint has no blocking errors", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);

    const body = (await res.json()) as {
      ok?: boolean;
      errorCount?: number;
      checks?: Array<{ name: string; ok: boolean; severity: "error" | "warning"; detail?: string }>;
    };

    expect(body.ok).toBe(true);
    expect(body.errorCount).toBe(0);
    expect(body.checks?.filter((check) => check.severity === "error" && !check.ok)).toEqual([]);
  });
});
