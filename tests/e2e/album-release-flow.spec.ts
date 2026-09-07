import { expect, test, type Page } from "@playwright/test";

const draftId = "11111111-1111-4111-8111-111111111111";
const guestToken = "22222222-2222-4222-8222-222222222222";
const albumPath = "/dashboard/new/album";
const browserErrors = new WeakMap<Page, string[]>();

// Exercise the rendered wizard without creating drafts, sending notifications,
// or changing payment state in the database behind the configured server.
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (
      ["GET", "HEAD", "OPTIONS"].includes(request.method()) ||
      new URL(request.url()).pathname === "/__nextjs_original-stack-frames"
    ) {
      await route.continue();
      return;
    }

    if (new URL(request.url()).pathname === "/api/submissions/draft") {
      await route.fulfill({ json: { submissionId: draftId, guestToken } });
      return;
    }

    if (request.headers()["next-action"]) {
      // The action returns data only; no router tree patch is needed. Server
      // validation and authoritative prices have separate unit coverage.
      await route.fulfill({
        contentType: "text/x-component",
        body: `0:${JSON.stringify({
          a: { submissionId: draftId, guestToken },
          f: "",
        })}\n`,
      });
      return;
    }

    await route.fulfill({
      status: 409,
      json: { error: "Unexpected mutation blocked by the UI test." },
    });
  });
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), "The wizard should not report browser runtime errors").toEqual([]);
});

const releaseChoice = (page: Page, released: boolean) =>
  page.getByRole("button", {
    name: released ? /^이미 발매됐어요/ : /^발매 전이에요/,
  });

const fillApplicant = async (page: Page) => {
  await page.locator('[data-preflight-field="applicantName"]').fill("UI 검증");
  await page.locator('[data-preflight-field="applicantEmail"]').fill("ui-test@example.invalid");
  await page.locator('[data-preflight-field="applicantPhone"]').fill("01012345678");
  await page.getByRole("button", { name: "사용 안 함", exact: true }).click();
};

test("asks release status before showing packages and uses the same prices for both choices", async ({ page }) => {
  await page.goto(albumPath);
  await expect(page.getByRole("heading", { name: "음반이 이미 발매되었나요?" })).toBeVisible();
  await expect(releaseChoice(page, false)).toHaveAttribute("aria-pressed", "false");
  await expect(releaseChoice(page, true)).toHaveAttribute("aria-pressed", "false");
  const packages = page.locator('[data-preflight-field="package"]');
  await expect(packages).not.toBeVisible();

  await releaseChoice(page, false).click();
  await expect(packages).toBeVisible();
  const cards = packages.locator("article");
  await expect(cards.first()).toBeVisible();
  const prereleaseCards = await cards.allTextContents();
  expect(prereleaseCards.length).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "신청서 작성으로 계속" })).toBeVisible();

  await releaseChoice(page, true).click();
  await expect(releaseChoice(page, true)).toHaveAttribute("aria-pressed", "true");
  await expect(releaseChoice(page, false)).toHaveAttribute("aria-pressed", "false");
  expect(await cards.allTextContents()).toEqual(prereleaseCards);
  await expect(page.getByRole("button", { name: "URL 입력으로 계속" })).toBeVisible();
  await expect(page.getByText("URL 접수 추가금 0원", { exact: true })).toBeVisible();
});

test("prerelease albums retain application mode selection and entered basic information", async ({ page }) => {
  await page.goto(albumPath);
  await releaseChoice(page, false).click();
  await page.getByRole("button", { name: "신청서 작성으로 계속" }).click();
  await expect(page.getByRole("radio", { name: /온라인 작성/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /파일로 제출/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "선택하고 계속" })).toBeDisabled();
  await page.getByRole("radio", { name: /온라인 작성/ }).click();
  await page.getByRole("button", { name: "선택하고 계속" }).click();
  await expect(page.getByRole("heading", { name: "기본 정보", exact: true })).toBeVisible();
  await page.locator('[data-preflight-field="title"]').fill("발매 전 앨범");
  await expect(page.locator("#released-album-url")).not.toBeVisible();

  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await releaseChoice(page, true).click();
  await page.getByRole("button", { name: "URL 입력으로 계속" }).click();
  await expect(page.getByRole("heading", { name: "URL과 접수자 정보" })).toBeVisible();
  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await releaseChoice(page, false).click();
  await page.getByRole("button", { name: "신청서 작성으로 계속" }).click();
  await page.getByRole("radio", { name: /온라인 작성/ }).click();
  await page.getByRole("button", { name: "선택하고 계속" }).click();
  await expect(page.locator('[data-preflight-field="title"]')).toHaveValue("발매 전 앨범");
});

test("a package confirmation opens URL entry for released albums", async ({ page }) => {
  await page.goto(albumPath);
  await releaseChoice(page, true).click();
  await page.locator('[data-preflight-field="package"] article').first().getByRole("button").click();
  const dialog = page.getByRole("dialog", { name: "패키지 선택 확인" });
  await expect(dialog).toContainText("URL과 접수자 정보 입력으로 이동합니다.");
  await dialog.getByRole("button", { name: "예", exact: true }).click();
  await expect(page.getByRole("heading", { name: "URL과 접수자 정보" })).toBeVisible();
  await expect(page.getByLabel("멜론·지니 앨범 URL *", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: /온라인 작성/ })).not.toBeVisible();
});

test("legacy oneclick links select the released flow without a separate fee", async ({ page }) => {
  await page.goto(`${albumPath}?mode=oneclick`);
  await expect(releaseChoice(page, true)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("URL 접수 추가금 0원", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "URL 입력으로 계속" }).click();
  await expect(page.getByRole("heading", { name: "URL과 접수자 정보" })).toBeVisible();
});

for (const [provider, url] of [
  ["Melon", "https://www.melon.com/album/detail.htm?albumId=1234567"],
  ["Genie", "https://www.genie.co.kr/detail/albumInfo?axnm=1234567"],
] as const) {
  test(`${provider} URL proceeds directly to final review and can be edited without upload`, async ({ page }) => {
    await page.goto(albumPath);
    await releaseChoice(page, true).click();
    await page.getByRole("button", { name: "URL 입력으로 계속" }).click();
    await page.getByLabel("멜론·지니 앨범 URL *", { exact: true }).fill(url);
    await fillApplicant(page);
    await page.getByRole("button", { name: "저장하고 최종 확인" }).click();
    await expect(page.getByRole("heading", { name: "접수할 앨범 URL", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "접수할 앨범 URL 확인" })).toContainText(url);
    await expect(page.getByRole("heading", { name: "파일 첨부", exact: true })).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "트랙 정보", exact: true })).not.toBeVisible();
    await expect(page.getByText("발매된 음반 · URL 접수", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "장바구니에 담기", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "담고 결제하기", exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(() =>
      window.localStorage.getItem("onside:guest-token:album:guest"),
    )).toBe(guestToken);

    await page.getByRole("button", { name: "이전 단계", exact: true }).click();
    await expect(page.getByRole("heading", { name: "URL과 접수자 정보" })).toBeVisible();
    await expect(page.getByLabel("멜론·지니 앨범 URL *", { exact: true })).toHaveValue(url);
    await expect(page.locator('[data-preflight-field="applicantName"]')).toHaveValue("UI 검증");
  });
}

test("switching from a downloaded application to a released album clears form and file requirements", async ({ page }) => {
  await page.goto(albumPath);
  await releaseChoice(page, false).click();
  await page.getByRole("button", { name: "신청서 작성으로 계속" }).click();
  await page.getByRole("radio", { name: /파일로 제출/ }).click();
  await page.getByRole("button", { name: "선택하고 계속" }).click();
  await expect(page.getByRole("heading", { name: "신청서 양식", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await releaseChoice(page, true).click();
  await page.getByRole("button", { name: "URL 입력으로 계속" }).click();
  await page.getByLabel("멜론·지니 앨범 URL *", { exact: true }).fill("https://www.genie.co.kr/detail/albumInfo?axnm=1234567");
  await fillApplicant(page);
  await page.getByRole("button", { name: "저장하고 최종 확인" }).click();
  await expect(page.getByRole("heading", { name: "접수할 앨범 URL", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "장바구니에 담기", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "담고 결제하기", exact: true })).toBeEnabled();
});

test("rejects song URLs before advancing to final review", async ({ page }) => {
  await page.goto(`${albumPath}?mode=oneclick`);
  await page.getByRole("button", { name: "URL 입력으로 계속" }).click();
  await page.getByLabel("멜론·지니 앨범 URL *", { exact: true }).fill("https://www.melon.com/song/detail.htm?songId=1234567");
  await fillApplicant(page);
  await page.getByRole("button", { name: "저장하고 최종 확인" }).click();
  await expect(page.getByRole("alertdialog", { name: "입력 확인" })).toContainText("곡·아티스트 링크는 사용할 수 없습니다.");
  await expect(page.getByRole("heading", { name: "URL과 접수자 정보" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "접수할 앨범 URL", exact: true })).not.toBeVisible();
});

for (const width of [390, 1440]) {
  test(`released flow fits a ${width}px viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const capture = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
    };
    await page.goto(albumPath);
    await expect(releaseChoice(page, true)).toBeVisible();
    await capture("release-question");
    await releaseChoice(page, true).click();
    await capture("packages");
    await page.getByRole("button", { name: "URL 입력으로 계속" }).click();
    await expect(page.getByRole("heading", { name: "URL과 접수자 정보" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "신청 진행 단계" })).toBeInViewport();
    await capture("url-entry");
    await page.getByLabel("멜론·지니 앨범 URL *", { exact: true }).fill("https://www.genie.co.kr/detail/albumInfo?axnm=1234567");
    await fillApplicant(page);
    await page.getByRole("button", { name: "저장하고 최종 확인" }).click();
    await expect(page.getByRole("button", { name: "담고 결제하기", exact: true })).toBeEnabled();
    await expect(page.getByRole("navigation", { name: "신청 진행 단계" })).toBeInViewport();
    await capture("final-review");
  });
}
