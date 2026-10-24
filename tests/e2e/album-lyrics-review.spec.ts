import { expect, test, type Page, type Route } from "@playwright/test";

const submissionId = "11111111-1111-4111-8111-111111111111";
const guestToken = "22222222-2222-4222-8222-222222222222";

// Render the actual wizard. Every draft/save/translation is a local fixture;
// uploads, submissions, messages and payment mutations fail closed.
async function openTracks(page: Page, english = false) {
  const unexpected: string[] = [];
  const errors: string[] = [];
  let translate: (route: Route, lines: string[]) => Promise<void> = async (route, lines) => {
    await route.fulfill({ json: { translations: lines.map(() => "안전하게 번역한 가사") } });
  };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (new URL(request.url()).hostname === "translate.googleapis.com") {
      await route.fulfill({ status: 503, json: { error: "Browser translation unavailable in this fixture" } }); return;
    }
    if (path === "/api/translate") {
      await translate(route, request.postDataJSON().lines); return;
    }
    if (path === "/api/submissions/draft") {
      await route.fulfill({ json: { submissionId, guestToken } }); return;
    }
    if (request.headers()["next-action"]) {
      await route.fulfill({ contentType: "text/x-component", body: `0:${JSON.stringify({ a: { submissionId, guestToken }, f: "" })}\n` }); return;
    }
    if (["GET", "HEAD", "OPTIONS"].includes(request.method()) || path === "/__nextjs_original-stack-frames") {
      await route.continue(); return;
    }
    unexpected.push(`${request.method()} ${path}`);
    await route.fulfill({ status: 409, json: { error: "Unexpected write blocked" } });
  });
  await page.goto(`${english ? "/en" : ""}/dashboard/new/album`);
  await page.getByRole("button", { name: english ? /Not Released Yet/ : /발매 전이에요/ }).click();
  await page.getByRole("button", { name: english ? "Continue to Application" : "신청서 작성으로 계속", exact: true }).click();
  await page.getByRole("radio", { name: english ? /Complete Online/ : /온라인 작성/ }).click();
  await page.getByRole("button", { name: english ? "Continue with Selection" : "선택하고 계속", exact: true }).click();
  for (const [field, value] of Object.entries({ title: "검사 테스트", artistName: "테스트", artistNameKr: "테스트", artistNameEn: "Test", releaseDate: "2026-10-24", distributor: "테스트", productionCompany: "테스트", previousRelease: "신인", applicantName: "테스트", applicantEmail: "lyrics@example.invalid", applicantPhone: "01012345678" })) {
    await page.locator(`[data-preflight-field="${field}"]`).fill(value);
  }
  await page.locator('[data-preflight-field="genre"]').selectOption({ index: 1 });
  await page.locator('[data-preflight-field="artistType"]').selectOption("SOLO");
  await page.locator('[data-preflight-field="artistGender"]').selectOption({ index: 1 });
  await page.locator('[data-preflight-field="aiUsed"]').getByRole("button").first().click();
  await page.getByRole("button", { name: english ? "Save and Continue" : "저장하고 다음 단계", exact: true }).click();
  await expect(page.locator('[data-preflight-field="lyrics"]')).toBeVisible();
  return { unexpected, errors, setTranslation(handler: typeof translate) { translate = handler; } };
}

const original = (page: Page) => page.locator('[data-preflight-field="lyrics"]');
const translated = (page: Page) => page.locator('[data-preflight-field="translatedLyrics"]');
const result = (page: Page) => page.getByRole("region", { name: "가사 욕설 검사 결과", exact: true });

test("raw profanity blocks progress without requiring the check button; clean edits clear stale results", async ({ page }, testInfo) => {
  const harness = await openTracks(page);
  await page.getByLabel("1번 트랙 곡명", { exact: true }).fill("테스트 곡");
  await page.getByLabel("1번 트랙 가수명", { exact: true }).fill("테스트");
  await page.getByLabel("1번 트랙 작곡", { exact: true }).fill("작곡가");
  await expect(page.getByRole("button", { name: "욕설 포함 곡 심의 안내", exact: true })).toHaveCount(0);
  await original(page).fill("오늘은 좋은 날");
  await expect(result(page)).toHaveCount(0);
  await page.getByRole("button", { name: "욕설 체크", exact: true }).click();
  await expect(result(page)).toContainText("감지되지 않았습니다");
  await expect(result(page)).not.toContainText("마스킹");
  await original(page).fill("오늘 시발 어제");
  await expect(result(page)).toContainText("명확한 욕설 표현 감지");
  await expect(result(page).locator("mark")).toHaveText(["시발"]);
  await expect(result(page)).toContainText("무음·삐처리 등으로 실제 음원");
  await expect(result(page)).toContainText("실제 제출 음원과 가사를 동일하게 맞춰주세요");
  await page.getByRole("button", { name: "다음 단계", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("욕설이 들리는 음원은 심의 접수가 불가");
  await page.getByRole("alertdialog").getByRole("button", { name: "닫기", exact: true }).click();
  await expect(original(page)).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await result(page).evaluate((element) => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 120, behavior: "instant" }));
    await result(page).screenshot({ path: testInfo.outputPath(`lyrics-explicit-result-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await original(page).fill("오늘 [삐처리] 어제");
  await expect(result(page)).toHaveCount(0);
  await page.getByRole("button", { name: "욕설 체크", exact: true }).click();
  await expect(result(page)).toContainText("감지되지 않았습니다");
  await expect(result(page)).not.toContainText("마스킹");
  expect(harness.unexpected).toEqual([]); expect(harness.errors).toEqual([]);
});

test("original and separate translation are both checked; ambiguous pronunciation is not declared profanity", async ({ page }) => {
  const harness = await openTracks(page);
  await original(page).fill("오늘은 맑은 날");
  await page.getByRole("button", { name: "번역본 가사 탭", exact: true }).click();
  await translated(page).fill("fuck you");
  await expect(result(page)).toContainText("번역본 가사");
  await expect(result(page)).toContainText("명확한 욕설");
  await translated(page).fill("");
  await original(page).fill("비취");
  await expect(result(page)).toContainText("확인 필요 표현 감지");
  await expect(result(page)).not.toContainText("명확한 욕설");
  await expect(result(page)).not.toContainText("마스킹");
  expect(harness.unexpected).toEqual([]); expect(harness.errors).toEqual([]);
});

test("track selection, reorder, removal and addition cannot reuse a different track's check result", async ({ page }) => {
  const harness = await openTracks(page);
  await page.getByLabel("1번 트랙 곡명", { exact: true }).fill("첫 곡");
  await original(page).fill("시발");
  await page.getByRole("button", { name: "욕설 체크", exact: true }).click();
  await page.getByRole("button", { name: "같은 참여진으로 추가", exact: true }).click();
  await expect(original(page)).toHaveValue("");
  await expect(result(page)).toHaveCount(0);
  await page.getByLabel("2번 트랙 곡명", { exact: true }).fill("둘째 곡");
  await original(page).fill("맑은 하늘");
  await page.getByRole("button", { name: "2번 트랙 위로 이동", exact: true }).click();
  await expect(original(page)).toHaveValue("맑은 하늘");
  await expect(result(page)).toHaveCount(0);
  await page.getByRole("button", { name: "상세", exact: true }).nth(1).click();
  await expect(original(page)).toHaveValue("시발");
  await expect(result(page)).toContainText("명확한 욕설 표현 감지");
  await page.getByRole("button", { name: "2번 트랙 삭제", exact: true }).click();
  await expect(original(page)).toHaveValue("맑은 하늘");
  await expect(result(page)).toHaveCount(0);
  await page.getByRole("button", { name: "같은 참여진으로 추가", exact: true }).click();
  await expect(original(page)).toHaveValue("");
  await expect(result(page)).toHaveCount(0);
  expect(harness.unexpected).toEqual([]); expect(harness.errors).toEqual([]);
});

test("late automatic translations never overwrite edits or another track", async ({ page }) => {
  const harness = await openTracks(page);
  await page.getByRole("button", { name: "같은 참여진으로 추가", exact: true }).click();
  for (const change of ["source", "translation", "selection", "reorder", "removal"] as const) {
    let release!: () => void; let seen!: () => void; let finished!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const requested = new Promise<void>((resolve) => { seen = resolve; });
    const settled = new Promise<void>((resolve) => { finished = resolve; });
    harness.setTranslation(async (route, lines) => {
      seen(); await waiting;
      try { await route.fulfill({ json: { translations: lines.map(() => "늦게 도착한 번역") } }); } catch { /* The browser may already have aborted. */ }
      finally { finished(); }
    });
    await original(page).fill(`Hello ${change}`);
    await translated(page).fill("");
    await page.getByRole("button", { name: "자동번역", exact: true }).click();
    await requested;
    if (change === "source") await original(page).fill("새로 편집한 가사");
    if (change === "translation") await translated(page).fill("직접 입력한 번역");
    if (change === "selection") await page.getByRole("button", { name: "상세", exact: true }).first().click();
    if (change === "reorder") await page.getByRole("button", { name: "1번 트랙 아래로 이동", exact: true }).click();
    if (change === "removal") await page.getByRole("button", { name: "트랙 삭제", exact: true }).click();
    release(); await settled;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByRole("textbox", { name: "자동번역 미리보기", exact: true })).toHaveCount(0);
    expect(await page.locator('textarea').evaluateAll((elements) => elements.map((element) => (element as HTMLTextAreaElement).value).join("\n"))).not.toContain("늦게 도착한 번역");
    if (change === "source") await expect(original(page)).toHaveValue("새로 편집한 가사");
    if (change === "translation") await expect(translated(page)).toHaveValue("직접 입력한 번역");
  }
  expect(harness.unexpected).toEqual([]); expect(harness.errors).toEqual([]);
});

test("partial translations are preserved as a preview and existing translations survive successful retries", async ({ page }) => {
  const harness = await openTracks(page);
  await original(page).fill("Hello sunshine.\nGoodbye moon.");
  harness.setTranslation(async (route, lines) => {
    await route.fulfill({ status: 502, json: { translations: lines.map((line) => line.includes("Hello") ? "안녕 햇살" : ""), error: "Partial fixture" } });
  });
  await page.getByRole("button", { name: "자동번역", exact: true }).click();
  const preview = page.getByRole("textbox", { name: "자동번역 미리보기", exact: true });
  await expect(preview).toHaveValue(/안녕 햇살/);
  await expect(preview).toHaveValue(/Goodbye moon/);
  await expect(page.getByText("자동번역 일부 완료 · 확인 필요", { exact: true })).toBeVisible();
  await expect(translated(page)).toHaveValue("");
  await translated(page).fill("사용자가 작성한 번역");
  harness.setTranslation(async (route, lines) => {
    await route.fulfill({ json: { translations: lines.map(() => "새 자동번역") } });
  });
  await page.getByRole("button", { name: "자동번역", exact: true }).click();
  await expect(preview).toHaveValue(/새 자동번역/);
  await expect(translated(page)).toHaveValue("사용자가 작성한 번역");
  await expect(original(page)).toHaveValue("Hello sunshine.\nGoodbye moon.");
  expect(harness.unexpected).toEqual([]); expect(harness.errors).toEqual([]);
});

test("successful automatic translations are checked again before they can progress", async ({ page }) => {
  const harness = await openTracks(page);
  await original(page).fill("Hello world");
  harness.setTranslation(async (route, lines) => {
    await route.fulfill({ json: { translations: lines.map(() => "시발") } });
  });
  await page.getByRole("button", { name: "자동번역", exact: true }).click();
  await expect(translated(page)).toHaveValue(/시발/);
  await expect(result(page)).toContainText("명확한 욕설 표현 감지");
  await expect(result(page)).toContainText("번역본 가사");
  expect(harness.unexpected).toEqual([]); expect(harness.errors).toEqual([]);
});

test("English review results retain original matched text and distinguish suspected expressions", async ({ page }) => {
  const harness = await openTracks(page, true);
  await original(page).fill("오늘 시발 어제");
  const panel = page.getByRole("region", { name: "Lyrics Profanity Check Results", exact: true });
  await expect(panel).toContainText("Explicit Profanity Detected");
  await expect(panel.locator("mark")).toHaveText(["시발"]);
  await expect(panel).toContainText("This check uses the lyrics you entered");
  await original(page).fill("비취");
  await expect(panel).toContainText("Expressions Need Review");
  await expect(panel).not.toContainText("silenced or bleeped");
  expect(harness.unexpected).toEqual([]); expect(harness.errors).toEqual([]);
});
