import { expect, test, type Page } from "@playwright/test";

const fixtureEmail = "auth-ui@example.invalid";
const fixturePassword = "Fixture-pass-123!";
const connectionError = "인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요. 문제가 계속되면 고객센터에 문의해주세요.";
type ActionResult = { error?: string; message?: string; retryAfterSeconds?: number };

/** UI coverage only: no real login, reset emails, or account changes. */
async function mockAuth(page: Page, options: {
  actionResult?: ActionResult;
  expiredRecovery?: boolean;
  failedPasswordUpdate?: boolean;
} = {}) {
  const calls = { actions: 0, verifications: 0, passwordUpdates: 0 };
  const user = {
    id: "11111111-1111-4111-8111-111111111111", email: fixtureEmail,
    aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  };
  const encoded = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.fixture`;
  const session = {
    access_token: accessToken, refresh_token: "fixture-refresh-token", token_type: "bearer",
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
  };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/auth/v1/")) {
      if (url.pathname.endsWith("/verify")) {
        calls.verifications++;
        await route.fulfill(options.expiredRecovery
          ? { status: 403, json: { error_code: "otp_expired", message: "Expired fixture token" } }
          : { json: session });
        return;
      }
      if (url.pathname.endsWith("/user")) {
        if (request.method() === "PUT") {
          calls.passwordUpdates++;
          if (options.failedPasswordUpdate) {
            await route.fulfill({ status: 422, json: { error_code: "same_password", message: "New password should be different" } });
            return;
          }
        }
        await route.fulfill({ json: user });
        return;
      }
      if (url.pathname.endsWith("/logout")) {
        await route.fulfill({ json: {} });
        return;
      }
      await route.fulfill({ status: 400, json: { code: "unexpected_fixture_request" } });
      return;
    }
    if (request.headers()["next-action"]) {
      calls.actions++;
      await route.fulfill({
        contentType: "text/x-component",
        body: `0:${JSON.stringify({ a: options.actionResult ?? {}, f: "" })}\n`,
      });
      return;
    }
    if (["GET", "HEAD", "OPTIONS"].includes(request.method()) || url.pathname === "/__nextjs_original-stack-frames") {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 409, json: { error: "Unexpected mutation blocked by auth UI test." } });
  });
  return calls;
}

for (const error of ["이메일 또는 비밀번호를 확인해주세요.", connectionError]) {
  test(`login shows a recoverable Korean error: ${error.slice(0, 16)}`, async ({ page }) => {
    const calls = await mockAuth(page, { actionResult: { error } });
    await page.goto("/login");
    await page.getByLabel("이메일", { exact: true }).fill(fixtureEmail);
    await page.getByLabel("비밀번호", { exact: true }).fill(fixturePassword);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page.getByText(error, { exact: true })).toBeVisible();
    await expect(page.getByLabel("이메일", { exact: true })).toHaveValue(fixtureEmail);
    await expect(page.getByRole("button", { name: "로그인", exact: true })).toBeEnabled();
    expect(calls.actions).toBe(1);
  });
}

test("reset request displays a generic success without sending email", async ({ page }) => {
  const message = "가입된 이메일이라면 비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해주세요.";
  const calls = await mockAuth(page, { actionResult: { message, retryAfterSeconds: 60 } });
  await page.goto("/forgot-password");
  await page.getByLabel("이메일", { exact: true }).fill(fixtureEmail);
  await page.getByRole("button", { name: "링크 보내기", exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByLabel("이메일", { exact: true })).toHaveValue(fixtureEmail);
  await expect(page.getByRole("button", { name: /초 후 다시 보내기$/ })).toBeDisabled();
  await expect(page.getByText(/가장 최근 메일의 링크/)).toBeVisible();
  expect(calls.actions).toBe(1);
});

test("reset sender failure is shown without success and limits repeated requests", async ({ page }) => {
  await page.clock.install();
  const error = "재설정 메일을 발송하지 못했습니다. 잠시 후 다시 시도해주세요.";
  const calls = await mockAuth(page, { actionResult: { error, retryAfterSeconds: 60 } });
  await page.goto("/forgot-password");
  await page.getByLabel("이메일", { exact: true }).fill(fixtureEmail);
  await page.getByRole("button", { name: "링크 보내기", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(error);
  await expect(page.getByRole("main").getByRole("status")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "60초 후 다시 보내기", exact: true })).toBeDisabled();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "링크 보내기", exact: true })).toBeEnabled();
  expect(calls.actions).toBe(1);
});

for (const suffix of ["", "?code=", "?token_hash=", "#error=access_denied&error_description=expired"]) {
  test(`missing or invalid recovery credential keeps password changes disabled (${suffix || "missing"})`, async ({ page }) => {
    const calls = await mockAuth(page);
    await page.goto(`/reset-password${suffix}`);
    await expect(page.getByRole("heading", { name: "링크 확인", exact: true })).toBeVisible();
    await expect(page.getByLabel("새 비밀번호", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "변경하기", exact: true })).toBeDisabled();
    await expect(page.getByRole("link", { name: "새 재설정 링크 요청하기", exact: true })).toHaveAttribute("href", "/forgot-password");
    expect(calls.verifications).toBe(0);
    expect(calls.passwordUpdates).toBe(0);
  });
}

test("expired recovery token is exchanged once and offers a new link", async ({ page }) => {
  const calls = await mockAuth(page, { expiredRecovery: true });
  await page.goto("/reset-password?token_hash=expired-fixture&type=recovery");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("링크가 만료되었거나 이미 사용되었습니다.");
  await expect(page.getByLabel("새 비밀번호", { exact: true })).toBeDisabled();
  expect(calls.verifications).toBe(1);
  expect(calls.passwordUpdates).toBe(0);
});

test("an explicit invalid link cannot reuse an already signed-in session", async ({ page }) => {
  const calls = await mockAuth(page);
  await page.goto("/reset-password?token_hash=valid-fixture&type=recovery");
  await expect(page.getByLabel("새 비밀번호", { exact: true })).toBeEnabled();
  expect(calls.verifications).toBe(1);
  await page.goto("/reset-password?code=");
  await expect(page.getByRole("heading", { name: "링크 확인", exact: true })).toBeVisible();
  await expect(page.getByLabel("새 비밀번호", { exact: true })).toBeDisabled();
  expect(calls.verifications).toBe(1);
  expect(calls.passwordUpdates).toBe(0);
});

test("valid recovery exchanges once, validates confirmation, and saves the new password", async ({ page }) => {
  const calls = await mockAuth(page);
  await page.goto("/reset-password?token_hash=valid-fixture&type=recovery");
  await expect(page.getByLabel("새 비밀번호", { exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/reset-password$/);
  expect(calls.verifications).toBe(1);
  await page.getByLabel("새 비밀번호", { exact: true }).fill(fixturePassword);
  await page.getByLabel("새 비밀번호 확인", { exact: true }).fill("Different-password-123!");
  await page.getByRole("button", { name: "변경하기", exact: true }).click();
  await expect(page.getByText("비밀번호가 일치하지 않습니다.", { exact: true })).toBeVisible();
  expect(calls.passwordUpdates).toBe(0);
  await page.getByLabel("새 비밀번호 확인", { exact: true }).fill(fixturePassword);
  await page.getByRole("button", { name: "변경하기", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("비밀번호가 변경되었습니다.");
  expect(calls.passwordUpdates).toBe(1);
  await expect(page).toHaveURL(/\/login$/);
});

test("a rejected password update keeps the verified form available for retry", async ({ page }) => {
  const calls = await mockAuth(page, { failedPasswordUpdate: true });
  await page.goto("/reset-password?token_hash=valid-fixture&type=recovery");
  await expect(page.getByLabel("새 비밀번호", { exact: true })).toBeEnabled();
  await page.getByLabel("새 비밀번호", { exact: true }).fill(fixturePassword);
  await page.getByLabel("새 비밀번호 확인", { exact: true }).fill(fixturePassword);
  await page.getByRole("button", { name: "변경하기", exact: true }).click();
  await expect(page.getByText("현재 비밀번호와 다른 새 비밀번호를 입력해주세요.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "변경하기", exact: true })).toBeEnabled();
  expect(calls.passwordUpdates).toBe(1);
  expect(calls.verifications).toBe(1);
});
