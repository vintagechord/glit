import { expect, test } from "@playwright/test";

// Read-only UI checks: prevent support submissions, draft creation and other writes.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
      return route.fulfill({ status: 409, json: { error: "Mutation blocked by support guidance test" } });
    }
    return route.continue();
  });
});

for (const locale of ["ko", "en"]) {
  test(`${locale} legacy guidance avoids unconfirmed operating periods and leads to relevant support`, async ({ page }) => {
    const prefix = locale === "en" ? "/en" : "";
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${prefix}/forms`);
    await expect(page.getByText(/1년간|one year|1 year/i)).toHaveCount(0);
    const support = page.getByRole("link", { name: locale === "en" ? "Application Support" : "접수 관련 문의", exact: true });
    await expect(support).toHaveAttribute("href", `${prefix}/support`);
    await support.click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/support$`));
    const help = page.locator('section[aria-labelledby="support-help-title"]');
    await expect(help.getByRole("heading", { level: 3 })).toHaveCount(4);
    await expect(help.getByRole("link", { name: locale === "en" ? "View Orders and Transfer Status" : "주문·입금 상태 보기", exact: true })).toHaveAttribute("href", `${prefix}/mypage/orders`);
    await expect(help.getByRole("link", { name: locale === "en" ? "Look Up an Application to Submit Materials" : "접수 조회 후 보완하기", exact: true })).toHaveAttribute("href", `${prefix}/track`);
    await expect(help.getByRole("link", { name: locale === "en" ? "View Progress and Results" : "진행·결과 조회", exact: true })).toHaveAttribute("href", `${prefix}/track`);
    const uploadHelp = help.getByRole("button", { name: locale === "en" ? "Get Help with Uploads" : "업로드 문제 문의", exact: true });
    await uploadHelp.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input').first()).toHaveValue(locale === "en" ? "File upload problem" : "파일 업로드 문제");
    await expect(dialog.locator('textarea')).toHaveValue(locale === "en" ? /Application ID:\nFile name:/ : /접수번호:\n파일명:/);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(uploadHelp).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
}
