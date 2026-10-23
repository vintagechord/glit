import { expect, test } from "@playwright/test";

// Public UI only. Block writes, including draft creation and support messages.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
      return route.fulfill({ status: 409, json: { error: "Mutation blocked by launch UI test" } });
    }
    return route.continue();
  });
});

for (const width of [360, 390, 430, 768, 1024, 1440]) {
  test(`service selection remains readable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard/new");
    for (const [title, path] of [
      ["음원 방송 심의", "/dashboard/new/album"],
      ["MV 온라인 유통용 심의", "/dashboard/new/mv?type=distribution"],
      ["MV 방송사 심의", "/dashboard/new/mv?type=broadcast"],
    ]) {
      const card = page.getByRole("link").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
      await expect(card).toHaveAttribute("href", path);
      for (const label of ["준비 자료", "결과물", "비용 단위", "진행 기간"]) await expect(card).toContainText(label);
    }
    await expect(page.getByRole("link", { name: "신청·결제 도움말 및 문의 (새 창)" })).toBeVisible();
    await expect(page.getByRole("button", { name: /실시간 채팅/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`services-${width}.png`), fullPage: true });
  });
}

test("home prioritizes service choices and labels its fictional sample", async ({ page }) => {
  await page.goto("/");
  const sample = page.locator("details").filter({ has: page.getByText("진행 화면 예시 보기", { exact: true }) });
  await expect(sample).toBeVisible();
  await expect(sample).not.toHaveAttribute("open", "");
  await sample.locator("summary").click();
  await expect(sample).toContainText("실제 접수 내역이 아닙니다.");
  await expect(sample).toContainText("방송국 6곳 중 1곳 결과 완료");
  await expect(sample).toContainText("보완 요청");
  await expect(sample).not.toContainText("Updated");
  const sampleTop = (await sample.boundingBox())!.y;
  const albumTop = (await page.getByRole("heading", { name: "음반 심의", exact: true }).boundingBox())!.y;
  expect(sampleTop).toBeGreaterThan(albumTop);
});

test("English service cards preserve explicit purpose and locale", async ({ page }) => {
  await page.goto("/en/dashboard/new");
  for (const [name, href] of [
    ["Music Broadcast Review", "/en/dashboard/new/album"],
    ["MV Review for Online Distribution", "/en/dashboard/new/mv?type=distribution"],
    ["MV Broadcaster Review", "/en/dashboard/new/mv?type=broadcast"],
  ]) {
    const card = page.getByRole("link").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(card).toHaveAttribute("href", href);
    await expect(card).toContainText("Pricing Basis");
  }
});

test("service choices reflow at 200 percent CSS zoom", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard/new");
  // CSS zoom exercises document reflow; this is not a physical-device or Safari check.
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  for (const name of ["음원 방송 심의", "MV 온라인 유통용 심의", "MV 방송사 심의"]) {
    const link = page.getByRole("link").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await link.focus();
    await expect(link).toBeFocused();
    const bounds = await link.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(1440);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1442);
  await page.screenshot({ path: testInfo.outputPath("services-css-zoom-200.png"), fullPage: true });
});
