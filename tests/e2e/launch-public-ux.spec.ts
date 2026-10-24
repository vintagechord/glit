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

for (const width of [390, 1024, 1440]) for (const english of [false, true]) test(`home restores the original hero columns with a visible example at ${width}px (${english ? "en" : "ko"})`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(english ? "/en" : "/");
  await expect(page.getByRole("complementary", { name: english ? "Email Delivery Notice" : "이메일 발송 안내", exact: true })).toHaveCount(0);
  await expect(page.getByText(english ? /Automated email is being prepared\./ : /이메일 자동 발송을 준비 중입니다\./)).toHaveCount(0);
  const sample = page.getByText(english ? "Fictional Progress Example" : "가상의 진행 예시", { exact: true }).locator("xpath=../..");
  await expect(sample).toBeVisible();
  await expect(page.getByText("진행 화면 예시 보기", { exact: true })).toHaveCount(0);
  await expect(sample).toContainText(english ? "Sample Data" : "예시 데이터");
  if (!english) await expect(sample).toContainText("방송국 6곳 중 1곳 결과 완료");
  await expect(sample).toContainText(english ? "Supplement Requested" : "보완 요청");
  await expect(sample).not.toContainText("Updated");
  const benefits = page.getByRole("region", { name: english ? "Your next steps with Onside" : "온사이드와 함께하는 심의 그 다음", exact: true });
  await expect(benefits.getByRole("button")).toHaveCount(3);
  const heading = page.getByRole("heading", { level: 1 });
  const apply = page.getByRole("main").getByRole("link", { name: english ? "Apply" : "심의 신청", exact: true });
  const headingBounds = (await heading.boundingBox())!;
  const benefitBounds = (await benefits.boundingBox())!;
  const applyBounds = (await apply.boundingBox())!;
  const sampleBounds = (await sample.boundingBox())!;
  expect(benefitBounds.y).toBeGreaterThan(headingBounds.y + headingBounds.height);
  expect(applyBounds.y).toBeGreaterThan(benefitBounds.y + benefitBounds.height);
  if (width >= 1024) {
    expect(sampleBounds.x).toBeGreaterThan(headingBounds.x + headingBounds.width);
    expect(Math.abs(sampleBounds.y - headingBounds.y)).toBeLessThan(120);
  } else {
    expect(Math.abs(sampleBounds.x - headingBounds.x)).toBeLessThan(8);
    expect(sampleBounds.y).toBeGreaterThan(applyBounds.y + applyBounds.height);
  }
  for (const removedCopy of [
    "방송국 수별 패키지 · 앨범 1건 기준", "Package by number of stations · per album",
    "영상 1건 · 선택 항목별 비용", "Per video · fees depend on selected options",
    "영상 1건 · 선택 방송사별 비용", "Per video · fees depend on selected broadcasters",
  ]) await expect(page.getByText(removedCopy, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: english ? "Compare Materials, Deliverables, and Pricing" : "준비 자료·결과물·비용 기준 비교", exact: true })).toHaveCount(0);
  await expect(page.getByText(english ? /Review approval does not guarantee broadcast scheduling\./ : /심의 결과는 실제 방송 편성을 보장하지 않습니다\./)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  for (const name of english ? ["Album Review", "Online MV", "Broadcast MV"] : ["음반 심의", "MV 온라인", "MV 방송"]) {
    const service = page.getByRole("link").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await service.scrollIntoViewIfNeeded();
    await expect(service).toHaveAttribute("data-reveal-state", "visible");
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath(`home-original-layout-${width}-${english ? "en" : "ko"}.png`), fullPage: true, animations: "disabled" });
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
