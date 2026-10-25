import { expect, test, type Page } from "@playwright/test";
import { mkdir, open, writeFile } from "node:fs/promises";

// Run the actual wizard with local fixtures. Block every service mutation so
// these tests cannot upload a real file, submit an order or send a notification.
const submissionId = "11111111-1111-4111-8111-111111111111";
const guestToken = "22222222-2222-4222-8222-222222222222";

async function mockSubmissionServices(page: Page, options: { failFirstPut?: boolean; expireFirstPart?: boolean } = {}) {
  const saves: Array<Record<string, unknown>> = [];
  const completed: string[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  const partAttempts: Record<string, number> = {};
  let puts = 0; let partSigning = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/cart/items") {
      await route.fulfill({ json: { items: [] } }); return;
    }
    const keyFor = (name: string) => `submissions/fixture/${submissionId}/${name}`;
    if (url.pathname === "/api/submissions/draft") {
      await route.fulfill({ json: { submissionId, guestToken } }); return;
    }
    if (url.pathname === "/api/uploads/init") {
      const data = request.postDataJSON();
      await route.fulfill({ json: { key: keyFor(data.filename), uploadUrl: `${url.origin}/__e2e__/file/${encodeURIComponent(data.filename)}`, headers: { "Content-Type": data.mimeType } } }); return;
    }
    if (url.pathname.startsWith("/__e2e__/file/")) {
      puts++;
      await route.fulfill({ status: options.failFirstPut && puts === 1 ? 400 : 200, body: "", headers: { ETag: '"fixture"' } }); return;
    }
    if (url.pathname === "/api/uploads/direct") {
      // The real browser creates multipart/form-data for downloaded application forms.
      expect(request.headers()["content-type"]).toContain("multipart/form-data");
      await route.fulfill({ json: { objectKey: keyFor("application.docx") } }); return;
    }
    if (url.pathname === "/api/uploads/complete") {
      const data = request.postDataJSON(); completed.push(data.filename);
      await route.fulfill({ json: { key: data.key, verified: true } }); return;
    }
    if (url.pathname === "/api/uploads/multipart/init") {
      const data = request.postDataJSON();
      await route.fulfill({ json: { grantId: guestToken, uploadId: "upload-fixture", key: keyFor(data.filename), partSize: 20 * 1024 * 1024 } }); return;
    }
    if (url.pathname === "/api/uploads/multipart/presign") {
      const data = request.postDataJSON(); partSigning++;
      await route.fulfill({ json: { urls: data.partNumbers.map((part: number) => ({ partNumber: part, url: `${url.origin}/__e2e__/part/${part}?generation=${partSigning}` })) } }); return;
    }
    if (url.pathname.startsWith("/__e2e__/part/")) {
      const identity = `${url.pathname}${url.search}`;
      partAttempts[identity] = (partAttempts[identity] ?? 0) + 1;
      const expired = options.expireFirstPart && url.pathname.endsWith("/1") && url.searchParams.get("generation") === "1";
      await route.fulfill({ status: expired ? 403 : 200, body: "", headers: { ETag: '"multipart-fixture"' } }); return;
    }
    if (url.pathname === "/api/uploads/multipart/complete") {
      const data = request.postDataJSON(); completed.push(data.filename);
      expect(data.parts).toHaveLength(Math.ceil(data.sizeBytes / (20 * 1024 * 1024)));
      await route.fulfill({ json: { key: data.key, verified: true } }); return;
    }
    if (request.headers()["next-action"]) {
      const body = request.postData() ?? "";
      try { saves.push(JSON.parse(body)[0]); } catch { /* React may serialize a draft using FormData. */ }
      await route.fulfill({ contentType: "text/x-component", body: `0:${JSON.stringify({ a: { submissionId, guestToken }, f: "" })}\n` }); return;
    }
    if (["GET", "HEAD", "OPTIONS"].includes(request.method()) || url.pathname === "/__nextjs_original-stack-frames") {
      await route.continue(); return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 409, json: { error: "Unexpected mutation blocked" } });
  });
  return { saves, completed, unexpected, errors, partAttempts };
}

async function openFileSubmission(page: Page, kind: "album" | "mv") {
  await page.goto(`/dashboard/new/${kind}`);
  if (kind === "album") {
    await page.getByRole("button", { name: /발매 전이에요/ }).click();
    await page.getByRole("button", { name: "신청서 작성으로 계속", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "다음 단계", exact: true }).click();
  }
  await page.getByRole("radio", { name: /파일로 제출/ }).click();
  await page.getByRole("button", { name: "선택하고 계속", exact: true }).click();
  await page.getByRole("button", { name: "사용 안 함", exact: true }).click();
  await page.getByRole("button", { name: kind === "album" ? "다음 단계" : "파일 업로드로 이동", exact: true }).click();
  const files = page.locator('[data-preflight-field="files"]');
  await expect(files.locator('input[type="file"]')).toBeEnabled();
  return files;
}

for (const kind of ["album", "mv"] as const) {
  test(`${kind} email delivery shows pending materials and keyboard file selection remains available`, async ({ page }) => {
    const results = await mockSubmissionServices(page);
    const files = await openFileSubmission(page, kind);
    // The step transition intentionally focuses its section on the next frame.
    // Wait for that navigation to finish before testing the file control.
    await expect(page.locator(`[data-submission-step="${kind === "album" ? 5 : 4}"]`)).toBeFocused();
    const input = files.locator('input[type="file"]');
    await input.focus();
    await expect(input).toBeFocused();
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await chooser;
    const emailChoice = files.getByRole("button", { name: "파일은 이메일로 나중에 제출", exact: true });
    await expect(emailChoice).toHaveCount(1);
    await emailChoice.click();
    await expect(emailChoice).toHaveAttribute("aria-pressed", "true");
    await expect(files.getByText(/접수번호 11111111-1111-4111-8111-111111111111/)).toBeVisible();
    await page.getByRole("button", { name: "다음 단계", exact: true }).click();
    const preflight = page.locator('section[aria-labelledby="submission-preflight-title"]');
    await expect(preflight.getByRole("status")).toHaveText("입력·첨부 확인");
    await expect(preflight.getByText("접수 완료 후 이메일로 파일을 제출해주세요.", { exact: true })).toBeVisible();
    await expect(preflight.getByRole("button", { name: /제출 안내/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "장바구니에 담기", exact: true })).toBeEnabled();
    expect(results.completed).toEqual([]);
    expect(results.unexpected).toEqual([]);
    expect(results.errors).toEqual([]);
  });
}

test("album basic fields expose names, linked errors and mixed-group input without clearing entered values", async ({ page }) => {
  const results = await mockSubmissionServices(page);
  await page.goto("/dashboard/new/album");
  await page.getByRole("button", { name: /발매 전이에요/ }).click();
  await page.getByRole("button", { name: "신청서 작성으로 계속", exact: true }).click();
  await page.getByRole("radio", { name: /온라인 작성/ }).click();
  await page.getByRole("button", { name: "선택하고 계속", exact: true }).click();
  for (const label of ["앨범 제목", "아티스트명 공식 표기", "아티스트 한글명", "아티스트 영문명", "발매일", "장르", "유통사", "제작사", "이전 발매곡", "그룹/솔로", "성별"]) {
    await expect(page.getByLabel(`${label} *`, { exact: true })).toBeVisible();
  }
  await page.getByLabel("앨범 제목 *", { exact: true }).fill("유지할 앨범명");
  await page.getByRole("button", { name: "저장하고 다음 단계", exact: true }).click();
  await expect(page.locator("#album-applicantName")).toBeFocused();
  await expect(page.locator("#album-artistName")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#album-artistName")).toHaveAttribute("aria-describedby", "album-artistName-error");
  await expect(page.locator("#album-artistName-error")).toBeVisible();
  await expect(page.getByLabel("앨범 제목 *", { exact: true })).toHaveValue("유지할 앨범명");
  await page.getByLabel("그룹/솔로 *", { exact: true }).selectOption("GROUP");
  await page.getByLabel("성별 *", { exact: true }).selectOption("MIXED");
  await page.getByLabel("팀원 전체 이름 *", { exact: true }).fill("멤버 A, 멤버 B");
  await expect(page.getByLabel("성별 *", { exact: true })).toHaveValue("MIXED");
  expect(results.unexpected).toEqual([]);
  expect(results.errors).toEqual([]);
});

test("KBS-only broadcast submission shows only KBS guidance and distinguishes reference specifications", async ({ page }) => {
  const results = await mockSubmissionServices(page);
  await page.goto("/dashboard/new/mv");
  await page.getByRole("button", { name: /TV 송출 목적의 심의/ }).click();
  await page.getByRole("button", { name: /KBS 뮤직비디오 심의/ }).click();
  await page.getByRole("button", { name: "다음 단계", exact: true }).click();
  await page.getByRole("radio", { name: /파일로 제출/ }).click();
  await page.getByRole("button", { name: "선택하고 계속", exact: true }).click();
  await page.getByRole("button", { name: "사용 안 함", exact: true }).click();
  await page.getByRole("button", { name: "파일 업로드로 이동", exact: true }).click();
  const guidance = page.locator(".broadcast-specs");
  await expect(guidance.locator(".broadcast-card")).toHaveCount(1);
  await expect(guidance.getByRole("button", { name: /^KBS/ })).toBeVisible();
  await expect(guidance.getByText("1분~1분30초", { exact: true })).toBeVisible();
  await expect(guidance.getByText(/접수 경로의 적용 규격은 담당자 확인이 필요/)).toBeVisible();
  expect(results.unexpected).toEqual([]);
  expect(results.errors).toEqual([]);
});

test("English album email delivery retains the application ID and does not claim material review is complete", async ({ page }) => {
  const results = await mockSubmissionServices(page);
  await page.goto("/en/dashboard/new/album");
  await page.getByRole("button", { name: /Not Released Yet/ }).click();
  await page.getByRole("button", { name: "Continue to Application", exact: true }).click();
  await page.getByRole("radio", { name: /Submit a File/ }).click();
  await page.getByRole("button", { name: "Continue with Selection", exact: true }).click();
  await page.locator('[data-preflight-field="aiUsed"]').getByRole("button").first().click();
  await page.getByRole("button", { name: "Next Step", exact: true }).click();
  await page.getByRole("button", { name: "Send Files Later by Email", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy Email Subject", exact: true })).toBeVisible();
  await expect(page.getByText(/Application ID 11111111-1111-4111-8111-111111111111/)).toBeVisible();
  await page.getByRole("button", { name: "Next Step", exact: true }).click();
  const preflight = page.locator('section[aria-labelledby="submission-preflight-title"]');
  await expect(preflight.getByRole("status")).toHaveText("Required Fields and Attachments Checked");
  await expect(preflight.getByText("After completing your application, please send your files by email.", { exact: true })).toBeVisible();
  await expect(preflight.getByRole("button", { name: /Submission Instructions/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add to Cart", exact: true })).toBeEnabled();
  expect(results.unexpected).toEqual([]);
  expect(results.errors).toEqual([]);
});

for (const kind of ["album", "mv"] as const) {
  test(`${kind} application and media uploads reach the cart with both attachments`, async ({ page }) => {
    const results = await mockSubmissionServices(page, { failFirstPut: kind === "mv" });
    const files = await openFileSubmission(page, kind);
    const mediaName = kind === "album" ? "master.wav" : "video.mp4";
    await files.locator('input[type="file"]').setInputFiles([
      { name: mediaName, mimeType: kind === "album" ? "audio/wav" : "video/mp4", buffer: Buffer.from("fixture media") },
      { name: "application.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("fixture application") },
    ]);
    if (kind === "mv") {
      await expect(files.getByText("실패", { exact: true })).toBeVisible();
      await files.getByRole("button", { name: "실패한 파일 다시 업로드", exact: true }).click();
    }
    await expect(files.getByText("첨부 완료", { exact: true })).toHaveCount(2);
    expect(results.completed.sort()).toEqual(["application.docx", mediaName].sort());
    await page.getByRole("button", { name: "다음 단계", exact: true }).click();
    const submit = page.getByRole("button", { name: "장바구니에 담기", exact: true });
    await expect(submit).toBeEnabled();
    await expect(page.getByTestId("cart-handoff-guidance")).toContainText("장바구니에서 결제 수단");
    await expect(page.getByRole("button", { name: /^(결제하기|담고 결제하기)$/ })).toHaveCount(0);
    await submit.click();
    await expect(page).toHaveURL(new RegExp(`/mypage/cart\\?added=${submissionId}$`));
    await expect.poll(() => results.saves.some((save) => save.status === "SUBMITTED" && Array.isArray(save.files) && save.files.length === 2)).toBe(true);
    expect(results.errors).toEqual([]);
    expect(results.unexpected).toEqual([]);
  });
}

test("a completed attachment cannot be removed by a stale in-flight batch", async ({ page }) => {
  const results = await mockSubmissionServices(page);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/__e2e__/file/application.docx", async (route) => {
    await waiting;
    await route.fulfill({ status: 200, body: "", headers: { ETag: '"fixture"' } });
  });
  try {
    const files = await openFileSubmission(page, "mv");
    await files.locator('input[type="file"]').setInputFiles({ name: "empty.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(0) });
    await expect(page.getByText("빈 파일은 업로드할 수 없습니다. 파일을 확인해주세요.").first()).toBeVisible();
    expect(results.completed).toEqual([]);
    await files.locator('input[type="file"]').setInputFiles([
      { name: "video.mp4", mimeType: "video/mp4", buffer: Buffer.from("fixture media") },
      { name: "application.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("fixture application") },
    ]);
    await expect(files.getByText("첨부 완료", { exact: true })).toHaveCount(1);
    const deletes = files.getByRole("button", { name: "삭제", exact: true });
    await expect(deletes).toHaveCount(2);
    await expect(deletes.nth(0)).toBeDisabled();
    await expect(deletes.nth(1)).toBeDisabled();
    release();
    await expect(files.getByText("첨부 완료", { exact: true })).toHaveCount(2);
    await expect(deletes.nth(0)).toBeEnabled();
    await deletes.nth(0).click();
    await expect(files.getByText("첨부 완료", { exact: true })).toHaveCount(1);
    await expect(files.getByText("video.mp4", { exact: true })).toHaveCount(0);
    expect(results.errors).toEqual([]);
    expect(results.unexpected).toEqual([]);
  } finally { release(); }
});

for (const kind of ["album", "mv"] as const) test(`${kind} multipart refreshes an expired URL and completes with browser cleanup blocked`, async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key: string) {
      if (key.startsWith("album-multipart:") || key.startsWith("mv-multipart:")) throw new DOMException("Storage blocked", "SecurityError");
      return remove.call(this, key);
    };
  });
  const results = await mockSubmissionServices(page, { expireFirstPart: true });
  const files = await openFileSubmission(page, kind);
  const mediaName = kind === "album" ? "album.zip" : "large.mp4";
  await mkdir(testInfo.outputDir, { recursive: true });
  const mediaPath = testInfo.outputPath(mediaName);
  const formPath = testInfo.outputPath("application.docx");
  const media = await open(mediaPath, "w");
  try { await media.truncate((kind === "album" ? 33 : 129) * 1024 * 1024); }
  finally { await media.close(); }
  await writeFile(formPath, "fixture application");
  await files.locator('input[type="file"]').setInputFiles([mediaPath, formPath]);
  await expect(files.getByText("첨부 완료", { exact: true })).toHaveCount(2, { timeout: 30_000 });
  expect(results.completed.sort()).toEqual([mediaName, "application.docx"].sort());
  expect(results.partAttempts["/__e2e__/part/1?generation=1"]).toBe(1);
  expect(results.partAttempts["/__e2e__/part/1?generation=2"]).toBe(1);
  await page.getByRole("button", { name: "다음 단계", exact: true }).click();
  await expect(page.getByRole("button", { name: "장바구니에 담기", exact: true })).toBeEnabled();
  expect(results.errors).toEqual([]);
  expect(results.unexpected).toEqual([]);
});

for (const width of [320, 360, 390, 768]) {
  for (const kind of ["album", "mv"] as const) {
    test(`${kind} mobile intake keeps long file names and upload actions within ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const results = await mockSubmissionServices(page);
      const files = await openFileSubmission(page, kind);
      const mediaName = `${"very-long-master-file-name_".repeat(5)}.${kind === "album" ? "wav" : "mp4"}`;
      await files.locator('input[type="file"]').setInputFiles([
        { name: mediaName, mimeType: kind === "album" ? "audio/wav" : "video/mp4", buffer: Buffer.from("responsive media fixture") },
        { name: "application.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("responsive application fixture") },
      ]);
      await expect(files.getByText("첨부 완료", { exact: true })).toHaveCount(2);
      await expect(files.getByText(mediaName, { exact: true })).toBeVisible();
      const controls = await files.getByRole("button").evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, height: rect.height };
      }));
      for (const rect of controls) {
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(width);
        expect(rect.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (width === 320) await files.screenshot({ path: testInfo.outputPath(`${kind}-upload-320.png`) });
      await page.getByRole("button", { name: "다음 단계", exact: true }).click();
      await expect(page.getByRole("button", { name: "장바구니에 담기", exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(results.errors).toEqual([]);
      expect(results.unexpected).toEqual([]);
    });
  }
}

for (const width of [320, 390]) {
  test(`album track editing and reordering stay usable without horizontal scrolling at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const results = await mockSubmissionServices(page);
    await page.goto("/dashboard/new/album");
    await page.getByRole("button", { name: /발매 전이에요/ }).click();
    await page.getByRole("button", { name: "신청서 작성으로 계속", exact: true }).click();
    await page.getByRole("radio", { name: /온라인 작성/ }).click();
    await page.getByRole("button", { name: "선택하고 계속", exact: true }).click();
    for (const [field, value] of Object.entries({ title: "모바일 입력 확인", artistName: "테스트 아티스트", artistNameKr: "테스트", artistNameEn: "Test", releaseDate: "2026-10-16", distributor: "테스트", productionCompany: "테스트", previousRelease: "신인", applicantName: "테스트", applicantEmail: "ui@example.invalid", applicantPhone: "01012345678" })) {
      await page.locator(`[data-preflight-field="${field}"]`).fill(value);
    }
    await page.locator('[data-preflight-field="genre"]').selectOption({ index: 1 });
    await page.locator('[data-preflight-field="artistType"]').selectOption("SOLO");
    await page.locator('[data-preflight-field="artistGender"]').selectOption({ index: 1 });
    await page.getByRole("button", { name: "사용 안 함", exact: true }).click();
    await page.getByRole("button", { name: "저장하고 다음 단계", exact: true }).click();
    const table = page.getByRole("region", { name: "트랙 표 입력" });
    await expect(table).toBeVisible();
    await page.getByLabel("1번 트랙 곡명", { exact: true }).fill("첫 번째 곡");
    await page.getByLabel("1번 트랙 작곡", { exact: true }).fill("공통 작곡가");
    await page.getByRole("button", { name: "같은 참여진으로 추가", exact: true }).click();
    await expect(page.getByLabel("2번 트랙 작곡", { exact: true })).toHaveValue("공통 작곡가");
    await page.getByLabel("2번 트랙 곡명", { exact: true }).fill("두 번째 곡");
    await page.getByRole("button", { name: "2번 트랙 위로 이동", exact: true }).click();
    await expect(page.getByLabel("1번 트랙 곡명", { exact: true })).toHaveValue("두 번째 곡");
    expect(await table.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const bounds = await table.locator("input,button").evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, height: rect.height };
    }));
    for (const rect of bounds) {
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(width);
      expect(rect.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width === 320) await table.screenshot({ path: testInfo.outputPath("track-editor-320.png") });
    await page.getByRole("button", { name: "2번 트랙 삭제", exact: true }).click();
    await expect(page.getByLabel("2번 트랙 곡명", { exact: true })).toHaveCount(0);
    expect(results.errors).toEqual([]);
    expect(results.unexpected).toEqual([]);
  });
}

for (const kind of ["album", "mv"] as const) {
  test(`${kind} blocked guest cart storage preserves the saved application code and allows retry`, async ({ page }) => {
    const results = await mockSubmissionServices(page);
    const files = await openFileSubmission(page, kind);
    await files.getByRole("button", { name: "파일은 이메일로 나중에 제출", exact: true }).click();
    await page.getByRole("button", { name: "다음 단계", exact: true }).click();
    await page.evaluate(() => {
      const saved = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('onside:guest-submission-')) throw new DOMException('Storage disabled', 'QuotaExceededError');
        return saved.call(this, key, value);
      };
    });
    await page.getByRole("button", { name: "장바구니에 담기", exact: true }).click();
    const recovery = page.getByRole("complementary", { name: "비회원 신청서 저장 안내" });
    await expect(recovery).toBeVisible();
    await expect(recovery.locator('[data-no-translate]')).toHaveText(guestToken);
    await expect(recovery.getByRole('link', {name:'저장된 신청서 조회'})).toHaveAttribute('href', `/track/${guestToken}`);
    await expect(page.getByRole("button", { name: "장바구니에 담기", exact: true })).toBeEnabled();
    await expect(page).toHaveURL(new RegExp(`/dashboard/new/${kind}$`));
    expect(results.saves.some(save => save.status === 'SUBMITTED')).toBe(true);
    expect(results.unexpected).toEqual([]);
    expect(results.errors).toEqual([]);
  });
}
