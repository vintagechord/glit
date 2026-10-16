import { expect, test, type Locator, type Page } from "@playwright/test";

const submissionId = "11111111-1111-4111-8111-111111111111";
const guestToken = "22222222-2222-4222-8222-222222222222";

// Run the actual Next wizard with fixture-only persistence. No upload, draft,
// payment, notification or external request can reach a live service.
async function mockMvServices(page: Page, draft?: Record<string, unknown>) {
  const allowedOrigin = new URL(test.info().project.use.baseURL ?? "http://localhost:3000").origin;
  const errors: string[] = [];
  const unexpectedMutations: string[] = [];
  const saves: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/submissions/drafts") {
      await route.fulfill({ json: { drafts: draft ? [draft] : [] } });
      return;
    }
    if (url.pathname === "/api/submissions/draft") {
      await route.fulfill({ json: { submissionId, guestToken } });
      return;
    }
    if (request.headers()["next-action"]) {
      saves.push(request.postData() ?? "");
      await route.fulfill({
        contentType: "text/x-component",
        body: `0:${JSON.stringify({ a: { submissionId, guestToken }, f: "" })}\n`,
      });
      return;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      unexpectedMutations.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 409, json: { error: "Unexpected mutation blocked" } });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await route.fulfill({ json: {} });
      return;
    }
    if (url.origin !== allowedOrigin) {
      await route.fulfill({ status: 404, body: "External service blocked" });
      return;
    }
    await route.continue();
  });
  return { errors, unexpectedMutations, saves };
}

async function expectSectionAtTop(section: Locator) {
  await expect(section).toBeVisible();
  await expect.poll(async () => {
    const rect = await section.boundingBox();
    return rect ? rect.y : -1;
  }).toBeGreaterThanOrEqual(0);
  await expect.poll(async () => {
    const rect = await section.boundingBox();
    return rect ? rect.y : 10000;
  }).toBeLessThan(220);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function openApplication(page: Page, mode: "online" | "upload" = "online") {
  await page.getByRole("button", { name: "다음 단계", exact: true }).click();
  await page.getByRole("radio", { name: mode === "online" ? /온라인 작성/ : /파일로 제출/ }).click();
  await page.getByRole("button", { name: "선택하고 계속", exact: true }).click();
  await expect(page.getByRole("heading", { name: mode === "online" ? "신청서 작성" : "신청서 양식", exact: true })).toBeVisible();
}

async function fillRequiredApplication(page: Page) {
  const values = {
    title: "Our Way (Official MV)",
    artistName: "온사이드 아티스트",
    artistNameOfficial: "ONSIDE Artist",
    releaseDate: "2026-10-20",
    director: "Director Kim",
    leadActor: "Artist Kim",
    agency: "ONSIDE Music",
    albumTitle: "Our Way",
    distributionCompany: "Fixture Distribution",
    usage: "온라인 음악사이트 공개",
    songTitleKr: "우리의 길",
    songTitleEn: "Our Way",
    songTitleOfficial: "Our Way (우리의 길)",
    composer: "Composer Kim",
    storyline: "주인공이 새로운 길을 찾아 떠나고 마지막에 목적지에 도착합니다.",
    lyrics: "우리의 길을 함께 걸어요.",
    guestName: "테스트 신청자",
    guestEmail: "fixture@example.com",
    guestPhone: "01012345678",
  };
  for (const [field, value] of Object.entries(values)) {
    await page.locator(`[data-mv-field="${field}"]`).fill(value);
  }
  await page.getByRole("button", { name: "사용 안 함", exact: true }).click();
}

for (const width of [390, 1440]) {
  test(`MV application has only agency and optional rating; advancing returns to the section top at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const result = await mockMvServices(page);
    await page.goto("/dashboard/new/mv");
    await openApplication(page);
    await expectSectionAtTop(page.getByRole("heading", { name: "신청서 작성", exact: true }));
    await expect(page.locator('[data-mv-field="productionCompany"]')).toHaveCount(0);
    await expect(page.getByPlaceholder("예: MP4 (H.264)")).toHaveCount(0);
    await expect(page.getByText("뮤직비디오 제작사 *", { exact: true })).toHaveCount(0);
    await expect(page.getByText("파일 포맷", { exact: true })).toHaveCount(0);

    const rating = page.getByRole("combobox", { name: "희망등급 (선택)", exact: true });
    await expect(rating).toHaveValue("");
    await expect(rating).not.toHaveAttribute("required", "");
    const labels = await rating.locator("option").allTextContents();
    expect(labels.slice(1)).toEqual([
      "전체관람가",
      "12세이상관람가",
      "15세이상관람가",
      "청소년관람불가 (19세)",
    ]);

    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`mv-application-${width}.png`), fullPage: true });
    await fillRequiredApplication(page);
    await page.getByRole("button", { name: "다음 단계", exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await page.getByRole("button", { name: "다음 단계", exact: true }).click();
    await expectSectionAtTop(page.getByRole("heading", { name: "파일 첨부", exact: true }));
    await expect.poll(() => result.saves.some(body => body.includes('"agency":"ONSIDE Music"'))).toBe(true);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "이전 단계", exact: true }).click();
    await expectSectionAtTop(page.getByRole("heading", { name: "신청서 작성", exact: true }));
    await expect(rating).toHaveValue("");
    await rating.selectOption({ label: "15세이상관람가" });
    await page.getByRole("button", { name: "다음 단계", exact: true }).click();
    await expectSectionAtTop(page.getByRole("heading", { name: "파일 첨부", exact: true }));
    await expect.poll(() => result.saves.some(body => body.includes('"desiredRating":"15세이상관람가"'))).toBe(true);
    await page.getByRole("button", { name: "이전 단계", exact: true }).click();
    await expect(rating.locator("option:checked")).toHaveText("15세이상관람가");
    expect(result.errors).toEqual([]);
    expect(result.unexpectedMutations).toEqual([]);
  });
}

for (const mode of ["online", "upload"] as const) {
  test(`general online review displays the complete credit consistency notice in ${mode} application mode`, async ({ page }) => {
    const result = await mockMvServices(page);
    await page.goto("/dashboard/new/mv");
    await openApplication(page, mode);
    const notice = page.getByTestId("mv-credit-consistency-notice");
    await expect(notice).toBeVisible();
    for (const phrase of ["뮤직비디오 제목", "소속사명", "주연", "감독명", "철자", "특수문자", "띄어쓰기", "대소문자", "접수"]) {
      await expect(notice).toContainText(phrase);
    }
    if (mode === "upload") {
      await page.getByRole("button", { name: "사용 안 함", exact: true }).click();
      await page.getByRole("button", { name: "파일 업로드로 이동", exact: true }).click();
      await expect(page.getByRole("heading", { name: "파일 첨부", exact: true })).toBeVisible();
      await expect(notice).toBeVisible();
    }
    expect(result.errors).toEqual([]);
    expect(result.unexpectedMutations).toEqual([]);
  });
}

test("TV review does not display the online rating or KMRB-only credit notice", async ({ page }) => {
  const result = await mockMvServices(page);
  await page.goto("/dashboard/new/mv");
  await page.getByRole("button", { name: /TV 송출 목적의 심의/ }).click();
  await page.locator('[data-preflight-field="reviewOptions"]').getByRole("button", { name: /MBC 뮤직비디오 심의/ }).click();
  await openApplication(page);
  await expect(page.getByTestId("mv-credit-consistency-notice")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "희망등급 (선택)", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-mv-field="agency"]')).toBeVisible();
  await expect(page.locator('[data-mv-field="productionCompany"]')).toHaveCount(0);
  await expect(page.getByText("파일 포맷", { exact: true })).toHaveCount(0);
  expect(result.errors).toEqual([]);
  expect(result.unexpectedMutations).toEqual([]);
});

for (const [saved, label] of [
  ["15세", "15세이상관람가"],
  ["19세", "청소년관람불가 (19세)"],
] as const) {
  test(`restoring a saved ${saved} rating selects its standard dropdown option without restoring removed fields`, async ({ page }) => {
    const result = await mockMvServices(page, {
      id: submissionId,
      guest_token: guestToken,
      type: "MV_DISTRIBUTION",
      status: "DRAFT",
      application_form_mode: "online",
      title: "복원 뮤직비디오",
      artist_name: "복원 아티스트",
      mv_agency: "복원 소속사",
      mv_production_company: "기존 제작사 정보",
      mv_format: "MP4",
      mv_desired_rating: saved,
      mv_base_selected: true,
      mv_selected_station_codes: [],
      updated_at: new Date().toISOString(),
      files: [],
    });
    await page.goto("/dashboard/new/mv?from=drafts");
    await expect(page.locator('[data-mv-field="title"]')).toHaveValue("복원 뮤직비디오");
    await expect(page.locator('[data-mv-field="agency"]')).toHaveValue("복원 소속사");
    await expect(page.getByRole("combobox", { name: "희망등급 (선택)", exact: true }).locator("option:checked")).toHaveText(label);
    await expect(page.locator('[data-mv-field="productionCompany"]')).toHaveCount(0);
    await expect(page.getByText("파일 포맷", { exact: true })).toHaveCount(0);
    await fillRequiredApplication(page);
    await page.getByRole("button", { name: "다음 단계", exact: true }).click();
    await expect(page.getByRole("heading", { name: "파일 첨부", exact: true })).toBeVisible();
    await expect.poll(() => result.saves.some(body => body.includes('"agency":"ONSIDE Music"'))).toBe(true);
    // Editing a legacy draft must omit retired fields, preserving server history
    // instead of replacing saved production/format metadata with empty strings.
    expect(result.saves.join("\n")).not.toMatch(/"(?:productionCompany|format|mv_production_company|mv_format)"\s*:/);
    expect(result.errors).toEqual([]);
    expect(result.unexpectedMutations).toEqual([]);
  });
}
