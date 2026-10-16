import { expect, test, type Page } from "@playwright/test";

async function mockDraftWrites(page: Page) {
  const unexpected: string[] = [];
  const draft = {
    submissionId: "11111111-1111-4111-8111-111111111111",
    guestToken: "22222222-2222-4222-8222-222222222222",
  };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/submissions/draft") {
      await route.fulfill({ json: draft });
      return;
    }
    if (request.headers()["next-action"]) {
      await route.fulfill({
        contentType: "text/x-component",
        body: `0:${JSON.stringify({ a: draft, f: "" })}\n`,
      });
      return;
    }
    if (["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      await route.continue();
      return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 409, json: { error: "Mutation blocked" } });
  });
  return unexpected;
}

async function expectStepAtTop(page: Page, step: number) {
  const section = page.locator(`[data-submission-step="${step}"]`);
  await expect(section).toBeVisible();
  await expect(section).toBeFocused();
  // The actual sticky header reports its responsive height to the form. The
  // next section must be below it and near the top, even after a bottom CTA.
  await expect.poll(async () => {
    return section.evaluate((element) => {
      const header = document.querySelector("header");
      const bounds = element.getBoundingClientRect();
      const gap = bounds.top - (header?.getBoundingClientRect().bottom ?? 0);
      const atDocumentEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      // A short choice step can end before there is enough document height to
      // align its top. In that case its complete content must already be shown.
      return gap >= 0 && (gap <= 40 || (atDocumentEnd && bounds.bottom <= window.innerHeight));
    });
  }).toBe(true);
}

for (const width of [390, 1440]) {
  test(`album next and previous steps start below the header at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: width === 390 ? "reduce" : "no-preference" });
    const unexpected = await mockDraftWrites(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/dashboard/new/album");
    await page.getByRole("button", { name: /발매 전이에요/ }).click();
    await page.getByRole("button", { name: "신청서 작성으로 계속", exact: true }).click();
    await expectStepAtTop(page, 2);

    await page.getByRole("radio", { name: /파일로 제출/ }).click();
    await page.getByRole("button", { name: "선택하고 계속", exact: true }).click();
    await expectStepAtTop(page, 3);

    await page.getByRole("button", { name: "사용 안 함", exact: true }).click();
    await page.getByRole("button", { name: "다음 단계", exact: true }).click();
    await expectStepAtTop(page, 5);
    await page.screenshot({ path: testInfo.outputPath(`album-file-section-${width}.png`) });

    await page.getByRole("button", { name: "이전 단계", exact: true }).click();
    await expectStepAtTop(page, 3);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });
}
