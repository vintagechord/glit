/**
 * Explicitly invoked authentication QA against a running app and configured
 * Supabase project. Creates exactly one disposable account and deletes it in
 * finally. Never requests email delivery or records browser traces/screenshots.
 *
 * AUTH_QA_BASE_URL=https://... AUTH_QA_LINK_MODE=action npx tsx scripts/auth-live-smoke.ts
 * AUTH_QA_BASE_URL=http://127.0.0.1:3000 AUTH_QA_LINK_MODE=token_hash npx tsx scripts/auth-live-smoke.ts
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

async function main() {
  process.loadEnvFile(".env.local");
  const baseUrl = process.env.AUTH_QA_BASE_URL;
  assert.ok(baseUrl, "Set AUTH_QA_BASE_URL explicitly.");
  const target = new URL(baseUrl);
  assert.ok(["http:", "https:"].includes(target.protocol));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert.ok(supabaseUrl && serviceKey && anonKey, "Supabase QA configuration is required.");
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonymous = () => createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = randomBytes(12).toString("hex");
  const email = `auth-qa-${suffix}@example.invalid`;
  const oldPassword = `Qa1!${randomBytes(24).toString("base64url")}`;
  const newPassword = `Qa2!${randomBytes(24).toString("base64url")}`;
  const cleanupPath = path.join(tmpdir(), `glit-auth-qa-${suffix}.json`);
  let userId: string | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let stage = "create dedicated account";
  const passed: string[] = [];
  const pass = (name: string) => { passed.push(name); console.log(JSON.stringify({ passed: name })); };
  try {
    const created = await admin.auth.admin.createUser({
      email, password: oldPassword, email_confirm: true,
      user_metadata: { name: "Temporary auth QA", qa_only: true },
    });
    assert.equal(created.error, null, "Dedicated account creation failed.");
    userId = created.data.user?.id;
    assert.ok(userId);
    await writeFile(cleanupPath, JSON.stringify({ userId, purpose: "Disposable auth QA cleanup" }), { mode: 0o600, flag: "wx" });
    pass(stage);

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    let page = await context.newPage();
    const login = async (password: string) => {
      await page.goto(new URL("/login?next=%2Fmypage", target).href);
      await page.getByLabel("이메일", { exact: true }).fill(email);
      await page.getByLabel("비밀번호", { exact: true }).fill(password);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/mypage", { timeout: 30_000 });
      const status = await context!.request.get(new URL("/api/dashboard/status", target).href);
      assert.equal(status.status(), 200, "Logged-in server request did not retain its session.");
    };
    stage = "browser login with initial password and server session";
    await login(oldPassword);
    pass(stage);

    if (process.env.AUTH_QA_ROUTE_AUDIT === "1") {
      stage = "save the dedicated profile twice without losing entered values";
      await page.goto(new URL("/mypage/profile", target).href);
      for (const name of ["Temporary QA first save", "Temporary QA second save"]) {
        await page.getByLabel("담당자명", { exact: true }).fill(name);
        await page.getByLabel("연락처", { exact: true }).fill("01000000000");
        await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
        await expect(page.getByRole("button", { name: "프로필 저장", exact: true })).toBeEnabled();
        await expect(page.getByRole("status").filter({ hasText: "프로필이 저장되었습니다." })).toBeVisible();
        await expect(page.getByLabel("담당자명", { exact: true })).toHaveValue(name);
        const profile: { data: { name: string } | null; error: unknown } = await admin.from("profiles").select("name").eq("user_id", userId).single();
        assert.equal(profile.error, null);
        assert.equal(profile.data?.name, name);
      }
      pass(stage);

      const inspectRoutes = async (routes: string[]) => {
        for (const route of routes) {
          stage = `render ${route}`;
          // HTTP only: no administrator hydration, read-receipt PATCH, uploads,
          // customer changes, payment, email, screenshots, or private page output.
          const response = await context!.request.get(new URL(route, target).href, { timeout: 60_000 });
          const html = await response.text();
          assert.equal(response.status(), 200, `Route failed: ${route}`);
          assert.equal(new URL(response.url()).pathname, route, `Unexpected redirect: ${route}`);
          assert.ok(!html.includes('id="__next_error__"') && !html.includes('"digest":"'), `Server render failed: ${route}`);
          pass(stage);
        }
      };
      await inspectRoutes(["/mypage", "/mypage/drafts", "/mypage/cart", "/mypage/orders", "/mypage/history", "/mypage/music", "/mypage/credits", "/mypage/profile", "/dashboard/new/album", "/dashboard/new/mv", "/karaoke-request", "/subscription"]);
      stage = "grant the disposable QA account temporary administrator access";
      const promoted = await admin.from("profiles").update({ role: "admin" }).eq("user_id", userId).eq("role", "user").select("user_id").single();
      assert.equal(promoted.error, null);
      assert.equal(promoted.data?.user_id, userId);
      try {
        await inspectRoutes(["/admin", "/admin/submissions", "/admin/users", "/admin/artists", "/admin/files", "/admin/credits", "/admin/credits/requests", "/admin/magazine", "/admin/banners", "/admin/config", "/admin/inquiries", "/admin/chat", "/admin/music", "/admin/karaoke", "/admin/review-docs", "/admin/payments"]);
      } finally {
        const demoted = await admin.from("profiles").update({ role: "user" }).eq("user_id", userId);
        assert.equal(demoted.error, null, "Temporary QA role cleanup failed.");
      }
    }

    if (process.env.AUTH_QA_API_AUDIT === "1") {
      const inspectApis = async (routes: string[]) => {
        for (const route of routes) {
          stage = `read ${route}`;
          const response = await context!.request.get(new URL(route, target).href, { timeout: 60_000 });
          assert.equal(response.status(), 200, `API failed: ${route}`);
          const result = await response.json();
          assert.ok(result && !result.error, `API returned an error: ${route}`);
          pass(stage);
        }
      };
      await inspectApis(["/api/dashboard/status", "/api/cart/count", "/api/orders", "/api/music-archive"]);
      const promoted = await admin.from("profiles").update({ role: "admin" }).eq("user_id", userId).eq("role", "user").select("user_id").single();
      assert.equal(promoted.error, null);
      assert.equal(promoted.data?.user_id, userId);
      try {
        // Deliberately excludes review jobs GET, which can resume queued work.
        await inspectApis(["/api/music-archive?action=admin", "/api/admin/chat", "/api/admin/mv-submissions", "/api/admin/mv-rating-assets"]);
      } finally {
        const demoted = await admin.from("profiles").update({ role: "user" }).eq("user_id", userId);
        assert.equal(demoted.error, null, "Temporary QA role cleanup failed.");
      }
    }

    stage = "generate recovery link without email";
    const generated = await admin.auth.admin.generateLink({
      type: "recovery", email,
      options: { redirectTo: new URL("/reset-password", target).href },
    });
    assert.equal(generated.error, null, "Recovery link generation failed.");
    assert.ok(generated.data.properties?.hashed_token && generated.data.properties.action_link);
    pass(stage);
    await context.close();
    context = await browser.newContext();
    page = await context.newPage();
    const recoveryUrl = new URL("/reset-password", target);
    recoveryUrl.searchParams.set("token_hash", generated.data.properties.hashed_token);
    recoveryUrl.searchParams.set("type", "recovery");
    const link = process.env.AUTH_QA_LINK_MODE === "action"
      ? generated.data.properties.action_link
      : recoveryUrl.href;
    stage = "verify recovery link in a fresh browser session";
    await page.goto(link);
    await expect(page.getByLabel("새 비밀번호", { exact: true })).toBeEnabled({ timeout: 30_000 });
    assert.equal(new URL(page.url()).origin, target.origin, "Recovery did not return to the configured QA app.");
    await expect.poll(() => new URL(page.url()).search + new URL(page.url()).hash).toBe("");
    pass(stage);

    stage = "update dedicated account password through recovery form";
    await page.getByLabel("새 비밀번호", { exact: true }).fill(newPassword);
    await page.getByLabel("새 비밀번호 확인", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "변경하기", exact: true }).click();
    await expect(page.getByText("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.", { exact: true })).toBeVisible({ timeout: 30_000 });
    pass(stage);
    await context.close();
    context = await browser.newContext();
    page = await context.newPage();
    stage = "browser login with new password and server session";
    await login(newPassword);
    pass(stage);

    stage = "old password is rejected by provider";
    const previous = await anonymous().auth.signInWithPassword({ email, password: oldPassword });
    assert.ok(previous.error, "The old password unexpectedly remained valid.");
    assert.equal(previous.data.session, null);
    pass(stage);
    console.log(JSON.stringify({ ok: true, target: target.origin, verifiedSteps: passed.length }));
  } catch (error) {
    // Playwright timeout messages include token-bearing URLs and entered values.
    // Deliberately report the stage and error class without serializing errors.
    console.error(JSON.stringify({ ok: false, stage, errorType: error instanceof Error ? error.name : "UnknownError", passed }));
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (userId) {
      try {
        const removed = await admin.auth.admin.deleteUser(userId);
        if (removed.error) throw new Error("Cleanup failed");
        const check = await admin.auth.admin.getUserById(userId);
        if (check.data.user || !check.error ||
          (check.error.status !== 404 && check.error.code !== "user_not_found")) {
          throw new Error("Cleanup verification failed");
        }
        await unlink(cleanupPath).catch(() => {});
        console.log(JSON.stringify({ cleanup: "dedicated account deleted and absence verified" }));
      } catch {
        console.error(JSON.stringify({ cleanup: "failed or unverified", privateCleanupRecord: cleanupPath }));
        process.exitCode = 1;
      }
    }
  }
}

void main().catch(() => {
  console.error("Auth QA setup failed before test execution.");
  process.exitCode = 1;
});
