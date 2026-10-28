/**
 * Explicit live navigation QA using one disposable, empty member account.
 * No email, submissions, orders, payments, traces or screenshots are created.
 * The account is removed in finally; output contains only timings/counts.
 * NAV_QA_BASE_URL=https://... NAV_QA_OUTPUT=/tmp/result.json npx tsx scripts/navigation-perf-smoke.ts
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, type Browser } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

async function main() {
  process.loadEnvFile(".env.local");
  const target = process.env.NAV_QA_BASE_URL;
  assert.ok(target, "Set NAV_QA_BASE_URL explicitly.");
  const origin = new URL(target).origin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(url && key, "Supabase QA configuration is required.");
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = randomBytes(12).toString("hex");
  const email = `nav-qa-${suffix}@example.invalid`;
  const password = `Qa1!${randomBytes(24).toString("base64url")}`;
  const cleanupPath = path.join(tmpdir(), `glit-nav-qa-${suffix}.json`);
  let userId: string | undefined;
  let browser: Browser | undefined;
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: "Temporary navigation QA", qa_only: true } });
    assert.equal(created.error, null, "Dedicated account creation failed.");
    userId = created.data.user?.id;
    assert.ok(userId);
    await writeFile(cleanupPath, JSON.stringify({ userId, purpose: "Disposable navigation QA cleanup" }), { mode: 0o600, flag: "wx" });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin}/login?next=%2Fmypage%2Fprofile`);
    await page.getByLabel("이메일", { exact: true }).fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.waitForURL(`${origin}/mypage/profile`, { timeout: 60_000 });
    await expect(page.getByLabel("담당자명", { exact: true })).toBeVisible();

    const samples: { route: string; milliseconds: number; statusApiRequests: number; ordersApiRequests: number; documentRequests: number }[] = [];
    for (const route of ["/mypage", "/mypage/orders"]) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (new URL(page.url()).pathname !== "/mypage/profile") {
          await page.locator('main a[href="/mypage/profile"]').first().click();
          await expect(page.getByLabel("담당자명", { exact: true })).toBeVisible();
        }
        const sample = { route, milliseconds: 0, statusApiRequests: 0, ordersApiRequests: 0, documentRequests: 0 };
        const listener = (request: import("@playwright/test").Request) => {
          const pathname = new URL(request.url()).pathname;
          if (pathname === "/api/dashboard/status") sample.statusApiRequests += 1;
          if (pathname === "/api/orders") sample.ordersApiRequests += 1;
          if (request.isNavigationRequest() && request.resourceType() === "document") sample.documentRequests += 1;
        };
        page.on("request", listener);
        const startedAt = performance.now();
        await page.locator(`main a[href="${route}"]`).first().click();
        await expect(page.getByText(route === "/mypage" ? "현재 표시할 심의 현황이 없습니다." : "주문 내역이 없습니다.", { exact: true })).toBeVisible({ timeout: 60_000 });
        sample.milliseconds = Math.round(performance.now() - startedAt);
        // Include any redundant hydration request started just after the seed renders.
        await page.waitForTimeout(500);
        page.off("request", listener);
        assert.equal(sample.documentRequests, 0, "Member navigation restarted the document.");
        samples.push(sample);
      }
    }
    const status = await context.request.get(`${origin}/api/dashboard/status`);
    assert.equal(status.status(), 200);
    assert.match(status.headers()["cache-control"] ?? "", /private.*no-store/);
    const result = { measuredAt: new Date().toISOString(), origin, fixture: "disposable empty member", samples, statusServerTiming: status.headers()["server-timing"] ?? null };
    if (process.env.NAV_QA_OUTPUT) await writeFile(process.env.NAV_QA_OUTPUT, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser?.close();
    if (userId) {
      const deleted = await admin.auth.admin.deleteUser(userId);
      assert.equal(deleted.error, null, `Temporary account cleanup failed; cleanup record: ${cleanupPath}`);
      await unlink(cleanupPath);
      console.log("Disposable navigation QA account deleted.");
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Navigation QA failed.");
  process.exitCode = 1;
});
