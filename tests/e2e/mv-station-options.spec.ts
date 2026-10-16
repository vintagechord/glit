import { expect, test, type Page } from "@playwright/test";

const submissionId = "11111111-1111-4111-8111-111111111111";
const guestToken = "22222222-2222-4222-8222-222222222222";
const draftStorageKey = "onside:draft:mv:guest";

// Render the real Next wizard. All API calls and server actions use fixtures;
// no draft, upload, payment or notification can reach a live service.
async function mockMvServices(page: Page, draft?: Record<string, unknown>) {
  const errors: string[] = [];
  const unexpectedMutations: string[] = [];
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
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
      await route.fulfill({ status: 404, body: "External service blocked" });
      return;
    }
    await route.continue();
  });
  return { errors, unexpectedMutations };
}

async function expectOnlineOptions(page: Page) {
  const options = page.locator('[data-preflight-field="reviewOptions"]');
  await expect(options.getByRole("button", { name: /일반 뮤직비디오 심의/ })).toBeVisible();
  await expect(options.getByRole("button", { name: /Mnet 뮤직비디오 심의/ })).toBeVisible();
  await expect(options.getByRole("button", { name: /ETN 입고 옵션/ })).toBeVisible();
  await expect(options).not.toContainText("MBC");
  return options;
}

function totalAmount(page: Page) {
  return page.getByText("총 결제 금액", { exact: true }).locator("..");
}

test("online MV excludes MBC while TV broadcast still offers MBC", async ({ page }) => {
  const result = await mockMvServices(page);
  await page.goto("/dashboard/new/mv");
  await expectOnlineOptions(page);
  await expect(totalAmount(page)).toContainText("30,000원");

  await page.getByRole("button", { name: /TV 송출 목적의 심의/ }).click();
  const mbc = page.locator('[data-preflight-field="reviewOptions"]').getByRole("button", { name: /MBC 뮤직비디오 심의/ });
  await expect(mbc).toBeVisible();
  await mbc.click();
  await expect(mbc).toContainText("선택됨");
  await expect(totalAmount(page)).toContainText("30,000원");

  await page.getByRole("button", { name: /유통사 제출 & 온라인 업로드/ }).click();
  await expectOnlineOptions(page);
  await expect(totalAmount(page)).toContainText("30,000원");
  expect(result.errors).toEqual([]);
  expect(result.unexpectedMutations).toEqual([]);
});

for (const source of ["server draft", "local selection"] as const) {
  test(`restoring an old online MV ${source} removes MBC and its fee without losing valid choices or fields`, async ({ page }) => {
    const draft = {
      id: submissionId,
      guest_token: guestToken,
      type: "MV_DISTRIBUTION",
      status: "DRAFT",
      application_form_mode: "online",
      title: "복원 대상 뮤직비디오",
      artist_name: "복원 아티스트",
      artist_name_kr: "Restored Artist",
      mv_memo: "기존 작성 내용을 유지합니다.",
      mv_selected_station_codes: source === "server draft" ? ["MBC", "MNET", "ETN"] : ["MBC"],
      mv_base_selected: true,
      amount_krw: 120000,
      updated_at: new Date().toISOString(),
      files: [],
    };
    const result = await mockMvServices(page, draft);
    if (source === "local selection") {
      await page.addInitScript(({ key, id, token }) => {
        localStorage.setItem(key, JSON.stringify({
          id,
          guestToken: token,
          mvType: "MV_DISTRIBUTION",
          onlineOptions: ["MBC", "MNET", "ETN"],
          onlineBaseSelected: true,
          tvStations: [],
          applicationFormMode: "online",
          updatedAt: Date.now(),
        }));
      }, { key: draftStorageKey, id: submissionId, token: guestToken });
    }
    await page.goto("/dashboard/new/mv?from=drafts");
    await expect(page.locator('input[data-mv-field="title"]')).toHaveValue(draft.title);
    await expect(page.locator('input[data-mv-field="artistName"]')).toHaveValue(draft.artist_name);
    await expect(page.locator('input[data-mv-field="artistNameOfficial"]')).toHaveValue(draft.artist_name_kr);

    await page.getByRole("button", { name: "이전 단계", exact: true }).click();
    await page.getByRole("button", { name: "이전 단계", exact: true }).click();
    const options = await expectOnlineOptions(page);
    await expect(options.getByRole("button", { name: /Mnet 뮤직비디오 심의/ })).toContainText("선택됨");
    await expect(options.getByRole("button", { name: /ETN 입고 옵션/ })).toContainText("선택됨");
    await expect(totalAmount(page)).toContainText("90,000원");
    await expect(totalAmount(page)).not.toContainText("120,000원");

    await page.getByRole("button", { name: "다음 단계", exact: true }).click();
    await page.getByRole("button", { name: "선택하고 계속", exact: true }).click();
    await expect(page.locator('input[data-mv-field="title"]')).toHaveValue(draft.title);
    await expect(page.locator('input[data-mv-field="artistName"]')).toHaveValue(draft.artist_name);
    expect(result.errors).toEqual([]);
    expect(result.unexpectedMutations).toEqual([]);
  });
}
