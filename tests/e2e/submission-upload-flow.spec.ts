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
    await submit.click();
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
  await expect(files.getByText("첨부 완료", { exact: true })).toHaveCount(2);
  expect(results.completed.sort()).toEqual([mediaName, "application.docx"].sort());
  expect(results.partAttempts["/__e2e__/part/1?generation=1"]).toBe(1);
  expect(results.partAttempts["/__e2e__/part/1?generation=2"]).toBe(1);
  await page.getByRole("button", { name: "다음 단계", exact: true }).click();
  await expect(page.getByRole("button", { name: "장바구니에 담기", exact: true })).toBeEnabled();
  expect(results.errors).toEqual([]);
  expect(results.unexpected).toEqual([]);
});
