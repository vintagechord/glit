import { expect, test, type Page } from "@playwright/test";

const fixtureEmail = "auth-ui@example.invalid";
const fixturePassword = "Fixture-pass-123!";
const connectionError = "인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요. 문제가 계속되면 고객센터에 문의해주세요.";
type ActionResult = { error?: string; message?: string; retryAfterSeconds?: number; verificationPending?: boolean; fieldErrors?: Record<string,string> };

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

test("signup preserves the original draft destination through email verification or manual signup", async ({ page }) => {
  const actionResult: ActionResult = {};
  const calls = await mockAuth(page, { actionResult });
  const next = "/dashboard/new?type=mv&draft=fixture-id";
  await page.goto(`/signup?next=${encodeURIComponent(next)}`);
  await page.locator("#signup-email").fill(fixtureEmail);
  const manualSignup = await page.locator("#signup-password").count() > 0;
  if (manualSignup) {
    await page.locator("#signup-password").fill(fixturePassword);
    await page.locator("#signup-confirm-password").fill(fixturePassword);
    actionResult.message = "회원가입이 완료되었습니다. 로그인해 주세요.";
  } else {
    actionResult.message = "인증 메일을 확인해주세요.";
    actionResult.verificationPending = true;
  }
  await page.getByLabel("필수 항목 전체 동의", { exact: true }).check();
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  if (manualSignup) {
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === next && url.searchParams.get("signup") === "success");
  } else {
    await expect(page.getByText("인증 메일을 확인해주세요.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "인증 메일 다시 받기", exact: true })).toHaveAttribute("href", `/confirm-email?next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL((url) => url.pathname === "/signup" && url.searchParams.get("next") === next);
  }
  expect(calls.actions).toBe(1);
});

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

test("global reset throttling is shown without success and limits repeated requests", async ({ page }) => {
  await page.clock.install();
  const error = "재설정 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
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

const signedRecovery = `#token_hash=fixture-recovery-token-123456&type=recovery&signature=${"b".repeat(64)}`;

for (const suffix of ["", "?code=", "?token_hash=old-token&type=recovery", "#access_token=old&refresh_token=old"]) {
  test(`unsigned recovery credential cannot trigger a session or password mutation (${suffix || "missing"})`, async ({ page }) => {
    const calls = await mockAuth(page);
    await page.goto(`/reset-password${suffix}`);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("새 메일");
    await expect(page.locator("#reset-new-password")).toHaveCount(0);
    expect(calls.actions).toBe(0);
    expect(calls.verifications).toBe(0);
    expect(calls.passwordUpdates).toBe(0);
  });
}

test("signed recovery waits for explicit submit, reports validation and completion through server action", async ({ page }) => {
  const actionResult: ActionResult = { fieldErrors: { confirmPassword: "비밀번호가 일치하지 않습니다." } };
  const calls = await mockAuth(page, { actionResult });
  await page.goto(`/reset-password${signedRecovery}`);
  await expect(page.locator("#reset-new-password")).toBeVisible();
  expect(calls.actions).toBe(0);
  expect(calls.verifications).toBe(0);
  await page.locator("#reset-new-password").fill(fixturePassword);
  await page.locator("#reset-confirm-password").fill("Different-password-123!");
  await page.getByRole("button", { name: "비밀번호 변경", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("비밀번호가 일치하지 않습니다.");
  delete actionResult.fieldErrors;
  actionResult.message = "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.";
  // React resets the uncontrolled password fields after a server action response.
  await page.locator("#reset-new-password").fill(fixturePassword);
  await page.locator("#reset-confirm-password").fill(fixturePassword);
  await page.getByRole("button", { name: "비밀번호 변경", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("비밀번호가 변경되었습니다.");
  await expect(page.getByRole("main").getByRole("link", { name: "로그인", exact: true })).toHaveAttribute("href", "/login");
  expect(calls.actions).toBe(2);
  expect(calls.verifications).toBe(0);
  expect(calls.passwordUpdates).toBe(0);
  expect(new URL(page.url()).hash).toBe("");
});

test("expired signed recovery offers another email without claiming success", async ({ page }) => {
  const calls = await mockAuth(page, { actionResult: { error: "유효하지 않거나 만료된 재설정 링크입니다. 비밀번호 찾기에서 새 메일을 요청해주세요." } });
  await page.goto(`/reset-password${signedRecovery}`);
  await page.locator("#reset-new-password").fill(fixturePassword);
  await page.locator("#reset-confirm-password").fill(fixturePassword);
  await page.getByRole("button", { name: "비밀번호 변경", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("만료");
  await expect(page.getByRole("main").getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "재설정 메일 다시 받기", exact: true })).toHaveAttribute("href", "/forgot-password");
  expect(calls.actions).toBe(1);
  expect(calls.verifications).toBe(0);
});
