import { expect, test, type Locator, type Page } from "@playwright/test";

// UI-only regression coverage: never reach a real signup, mail, inquiry or
// submission mutation even if a control accidentally becomes a submit button.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort(),
  );
});

async function assertModalFocus(page: Page, trigger: Locator) {
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press(index % 2 ? "Shift+Tab" : "Tab");
    await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await expect.poll(() => page.getByRole("main").evaluate((node) => {
    const siblings = Array.from(node.querySelectorAll("[inert]"));
    return Boolean(node.closest("[inert]")) || siblings.length > 0;
  })).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator("[inert]")).toHaveCount(0);
}

test("login and signup keep a safe draft return path and show the password policy", async ({ page }) => {
  const next = "/dashboard/new?type=mv&draft=fixture-id";
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByRole("main").getByRole("link", { name: "회원가입", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/signup\\?next=${encodeURIComponent(next).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  if (await page.locator("#signup-password").count()) {
    await expect(page.getByText("비밀번호는 8~128자로 입력해주세요.", { exact: true })).toBeVisible();
    await page.locator("#signup-password").fill("fixture-password");
    await page.getByRole("button", { name: "비밀번호 보기", exact: true }).click();
    await expect(page.locator("#signup-password")).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "비밀번호 숨기기", exact: true }).click();
    await expect(page.locator("#signup-password")).toHaveAttribute("type", "password");
  } else {
    await expect(page.getByText("인증 링크를 이메일로 보내드립니다. 이메일 확인 후 비밀번호를 설정하면 가입이 완료됩니다.", { exact: true })).toBeVisible();
  }
  await page.getByLabel("필수 항목 전체 동의", { exact: true }).check();
  await expect(page.locator("#agreeMarketing")).not.toBeChecked();
  for (const policy of ["이용약관 보기", "개인정보 처리 보기", "결제·환불 정책 보기"]) {
    await assertModalFocus(page, page.getByRole("button", { name: policy, exact: true }));
  }
  await expect(page.getByRole("main").getByRole("link", { name: "로그인", exact: true })).toHaveAttribute("href", `/login?next=${encodeURIComponent(next)}`);
});

test("English signup return paths follow a language switch and discard external destinations", async ({ page }) => {
  const next = "/dashboard/new?type=mv&draft=fixture-id";
  await page.goto(`/en/signup?next=${encodeURIComponent(next)}`);
  await expect(page.locator('input[name="next"]')).toHaveValue(`/en${next}`);
  await expect(page.locator(`main a[href^="/en/login?next="]`)).toHaveCount(1);
  await page.goto("/signup?next=%2F%5Cevil.invalid");
  await expect(page.locator('input[name="next"]')).toHaveValue("");
  await expect(page.locator('main a[href="/login"]')).toHaveCount(1);
});

test("guest lookup and footer policies keep focus inside and return it to the opener", async ({ page }) => {
  await page.goto("/login");
  await assertModalFocus(page, page.getByRole("main").getByRole("button", { name: "비회원 조회", exact: true }));
  await page.locator("footer").getByText("약관/정책", { exact: false }).click();
  await assertModalFocus(page, page.locator("footer").getByRole("button", { name: "이용약관", exact: true }));
  await page.goto("/support");
  await assertModalFocus(page, page.getByRole("button", { name: "1:1 문의", exact: true }));
});

test("a centered alert above a policy modal restores the underlying modal focus", async ({ page }) => {
  await page.goto("/signup");
  const opener = page.getByRole("button", { name: "이용약관 보기", exact: true });
  await opener.click();
  const policy = page.getByRole("dialog", { name: "이용약관", exact: true });
  const policyClose = policy.getByRole("button", { name: "닫기", exact: true });
  await expect(policyClose).toBeFocused();
  await page.evaluate(() => window.alert("접근성 검증용 알림"));
  const alert = page.getByRole("dialog", { name: "안내", exact: true });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("button", { name: "닫기" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(alert).toHaveCount(0);
  await expect(policyClose).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await expect(page.locator("[inert]")).toHaveCount(0);
});
