import { expect, test, type Page } from "@playwright/test";
import { ZipFile } from "yazl";

const draftId = "11111111-1111-4111-8111-111111111111";
const guestToken = "22222222-2222-4222-8222-222222222222";
const albumPath = "/dashboard/new/album";
const browserErrors = new WeakMap<Page, string[]>();
type UploadRun = {
  initiated: Array<{ filename: string; mimeType: string; sizeBytes: number; guestToken?: string }>;
  completed: Array<{ key: string; filename: string; guestToken?: string }>;
  puts: number;
  saved: string[];
  holdPut: boolean;
  releasePut?: () => void;
};
const uploadRuns = new WeakMap<Page, UploadRun>();
const wavBytes = (() => {
  const buffer = Buffer.alloc(204);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
})();
let zipBytes: Buffer;
test.beforeAll(async () => {
  const archive = new ZipFile();
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    archive.outputStream.on("error", reject);
  });
  archive.addBuffer(wavBytes, "01-full-audio.wav"); archive.end();
  zipBytes = await complete;
});

// Exercise the rendered wizard without creating drafts, sending notifications,
// or changing payment state in the database behind the configured server.
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  uploadRuns.set(page, { initiated: [], completed: [], puts: 0, saved: [], holdPut: false });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const uploads = uploadRuns.get(page)!;
    if (url.pathname === "/api/uploads/init" && request.method() === "POST") {
      const payload = request.postDataJSON();
      uploads.initiated.push(payload);
      const number = uploads.initiated.length;
      await route.fulfill({ json: {
        key: `submissions/e2e/${draftId}/${number}-${payload.filename}`,
        uploadUrl: new URL(`/__e2e__/album-upload/${number}`, url).href,
        headers: { "Content-Type": payload.mimeType },
      } });
      return;
    }
    if (url.pathname.startsWith("/__e2e__/album-upload/") && request.method() === "PUT") {
      uploads.puts += 1;
      if (uploads.holdPut) await new Promise<void>((resolve) => { uploads.releasePut = resolve; });
      await route.fulfill({ status: 200, headers: { ETag: '"e2e-audio-etag"' }, body: "" });
      return;
    }
    if (url.pathname === "/api/uploads/complete" && request.method() === "POST") {
      const payload = request.postDataJSON();
      uploads.completed.push(payload);
      await route.fulfill({ json: { key: payload.key } });
      return;
    }
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
      uploads.saved.push(request.postData() ?? "");
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
  uploadRuns.get(page)?.releasePut?.();
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

const saveUrlAndOpenUpload = async (page: Page) => {
  await page.getByRole("button", { name: "저장하고 음원 첨부", exact: true }).click();
  await expect(page.getByRole("heading", { name: "음원 첨부", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "트랙 정보", exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "파일 없이 진행", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "신청 진행 단계" })).toContainText("음원 첨부");
};

const closeInputError = async (page: Page, message: string) => {
  const dialog = page.getByRole("alertdialog", { name: "입력 확인" });
  await expect(dialog).toContainText(message);
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(dialog).not.toBeVisible();
};

const uploadAudio = async (page: Page, kind: "wav" | "zip" = "wav") => {
  const filename = kind === "wav" ? "01-full-audio.wav" : "full-album-audio.zip";
  const field = page.locator('[data-preflight-field="files"]');
  const input = field.locator('input[type="file"]');
  await expect(input).toBeEnabled();
  await input.setInputFiles({ name: filename, mimeType: kind === "wav" ? "audio/wav" : "application/zip", buffer: kind === "wav" ? wavBytes : zipBytes });
  await expect(field.getByText("첨부 완료", { exact: true })).toBeVisible();
  await expect.poll(() => uploadRuns.get(page)!.completed.length).toBeGreaterThan(0);
  return filename;
};

const openFinalReview = async (page: Page, url: string) => {
  await page.getByRole("button", { name: "다음 단계", exact: true }).click();
  await expect(page.getByRole("heading", { name: "접수할 앨범 URL", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "접수할 앨범 URL 확인" })).toContainText(url);
  await expect(page.getByRole("button", { name: "장바구니에 담기", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "결제하기", exact: true })).toBeEnabled();
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
  await expect(page.getByText("URL 접수 추가금 0원", { exact: true })).toHaveCount(0);
});

test("prerelease albums open the online application directly and preserve entered information", async ({ page }) => {
  await page.goto(albumPath);
  await releaseChoice(page, false).click();
  await page.getByRole("button", { name: "신청서 작성으로 계속" }).click();
  await expect(page.getByRole("radio", { name: /온라인 작성/ })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "신청 진행 단계" })).toContainText("온라인 신청서 작성");
  await expect(page.getByRole("heading", { name: "기본 정보", exact: true })).toBeVisible();
  await page.locator('[data-preflight-field="title"]').fill("발매 전 앨범");
  await expect(page.locator("#released-album-url")).not.toBeVisible();

  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await releaseChoice(page, true).click();
  await page.getByRole("button", { name: "URL 입력으로 계속" }).click();
  await expect(page.getByRole("heading", { name: "URL과 접수자 정보" })).toBeVisible();
  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await releaseChoice(page, false).click();
  await page.getByRole("button", { name: "신청서 작성으로 계속" }).click();
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
  await expect(page.getByText("URL 접수 추가금 0원", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "URL 입력으로 계속" }).click();
  await expect(page.getByRole("heading", { name: "URL과 접수자 정보" })).toBeVisible();
});

for (const [provider, url, uploadKind] of [
  ["Melon", "https://www.melon.com/album/detail.htm?albumId=1234567", "wav"],
  ["Genie", "https://www.genie.co.kr/detail/albumInfo?axnm=1234567", "zip"],
] as const) {
  test(`${provider} URL replaces the application form while ${uploadKind.toUpperCase()} audio can be attached before payment`, async ({ page }) => {
    await page.goto(albumPath);
    await releaseChoice(page, true).click();
    await page.getByRole("button", { name: "URL 입력으로 계속" }).click();
    await page.getByLabel("멜론·지니 앨범 URL *", { exact: true }).fill(url);
    await fillApplicant(page);
    await saveUrlAndOpenUpload(page);
    const input = page.locator('[data-preflight-field="files"] input[type="file"]');
    await expect(input).toHaveAttribute("accept", /\.wav/);
    await expect(input).toHaveAttribute("accept", /\.zip/);
    await expect(input).not.toHaveAttribute("accept", /\.mp3|\.hwp|\.doc/);

    // Continuing without audio offers the supported email handoff.
    await page.getByRole("button", { name: "다음 단계", exact: true }).click();
    const emailDialog = page.getByRole("alertdialog", { name: "확인해주세요." });
    await expect(emailDialog).toContainText("이메일로 음원 파일을 보내주세요.");
    await emailDialog.getByRole("button", { name: "취소", exact: true }).click();
    await expect(page.getByRole("heading", { name: "음원 첨부", exact: true })).toBeVisible();
    expect(uploadRuns.get(page)!.completed).toHaveLength(0);

    const filename = await uploadAudio(page, uploadKind);
    await openFinalReview(page, url);
    expect(uploadRuns.get(page)!.puts).toBe(1);
    expect(uploadRuns.get(page)!.completed[0]).toMatchObject({ filename, guestToken });
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("onside:guest-token:album:guest"))).toBe(guestToken);

    // Final review returns to the audio step; its previous step returns to URL/contact.
    await page.getByRole("button", { name: "이전 단계", exact: true }).click();
    await expect(page.getByRole("heading", { name: "음원 첨부", exact: true })).toBeVisible();
    await expect(page.getByText(filename, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "이전 단계", exact: true }).click();
    await expect(page.getByRole("heading", { name: "URL과 접수자 정보" })).toBeVisible();
    await expect(page.getByLabel("멜론·지니 앨범 URL *", { exact: true })).toHaveValue(url);
    await expect(page.locator('[data-preflight-field="applicantName"]')).toHaveValue("UI 검증");
    await saveUrlAndOpenUpload(page);
    await expect(page.getByText(filename, { exact: true })).toBeVisible();
    await expect(page.getByText("첨부 완료", { exact: true })).toBeVisible();
    await openFinalReview(page, url);
    expect(uploadRuns.get(page)!.puts).toBe(1);
  });
}

test("released albums can reach payment with no upload by selecting email delivery", async ({ page }) => {
  await page.goto(`${albumPath}?mode=oneclick`);
  await page.getByRole("button", { name: "URL 입력으로 계속" }).click();
  const url = "https://www.genie.co.kr/detail/albumInfo?axnm=1234567";
  await page.getByLabel("멜론·지니 앨범 URL *", { exact: true }).fill(url);
  await fillApplicant(page);
  await saveUrlAndOpenUpload(page);
  await page.getByRole("button", { name: "파일 없이 진행", exact: true }).first().click();
  await expect(page.getByText("파일 첨부 대신 아래 이메일 주소로 음원 파일을 보내주세요.")).toBeVisible();
  await openFinalReview(page, url);
  expect(uploadRuns.get(page)!.completed).toHaveLength(0);
  expect(uploadRuns.get(page)!.saved.some(body => body.includes('"filesSubmittedByEmail":true'))).toBe(true);
});

test("rejects song URLs before advancing to audio attachment", async ({ page }) => {
  await page.goto(`${albumPath}?mode=oneclick`);
  await page.getByRole("button", { name: "URL 입력으로 계속" }).click();
  await page.getByLabel("멜론·지니 앨범 URL *", { exact: true }).fill("https://www.melon.com/song/detail.htm?songId=1234567");
  await fillApplicant(page);
  await page.getByRole("button", { name: "저장하고 음원 첨부" }).click();
  await expect(page.getByRole("alertdialog", { name: "입력 확인" })).toContainText("곡·아티스트 링크는 사용할 수 없습니다.");
  await expect(page.getByRole("heading", { name: "URL과 접수자 정보" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "접수할 앨범 URL", exact: true })).not.toBeVisible();
});

test("released albums can continue while an upload is stalled and ignore its late UI updates", async ({ page }) => {
  await page.goto(`${albumPath}?mode=oneclick`);
  await page.getByRole("button", { name: "URL 입력으로 계속" }).click();
  const url = "https://www.melon.com/album/detail.htm?albumId=1234567";
  await page.getByLabel("멜론·지니 앨범 URL *", { exact: true }).fill(url);
  await fillApplicant(page); await saveUrlAndOpenUpload(page);
  const uploads = uploadRuns.get(page)!;
  const field = page.locator('[data-preflight-field="files"]');
  const input = field.locator('input[type="file"]');
  await input.setInputFiles({ name: "unsupported.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("ID3-test") });
  await expect(field.getByText("선택된 파일이 없습니다.", { exact: true })).toBeVisible();
  expect(uploads.initiated).toHaveLength(0);
  await closeInputError(page, "음원 파일(WAV 또는 ZIP)을 사이트에 업로드해주세요.");
  uploads.holdPut = true;
  await input.setInputFiles({ name: "pending-audio.wav", mimeType: "audio/wav", buffer: wavBytes });
  await expect.poll(() => uploads.puts).toBe(1);
  await expect(field.getByText(/업로드 중 ·/)).toBeVisible();
  await page.getByRole("button", { name: "다음 단계", exact: true }).click();
  const emailDialog = page.getByRole("alertdialog", { name: "확인해주세요." });
  await expect(emailDialog).toContainText("이메일로 음원 파일을 보내주세요.");
  await emailDialog.getByRole("button", { name: "확인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "접수할 앨범 URL", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "결제하기", exact: true })).toBeEnabled();
  expect(uploads.completed).toHaveLength(0);
  expect(uploads.saved.some(body => body.includes('"filesSubmittedByEmail":true'))).toBe(true);
  uploads.holdPut = false; uploads.releasePut?.();
  await expect.poll(() => uploads.completed.length).toBe(1);
  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await expect(page.getByText("파일 첨부 대신 아래 이메일 주소로 음원 파일을 보내주세요.")).toBeVisible();
  await openFinalReview(page, url);
});

for (const width of [390, 1440]) {
  test(`released flow fits a ${width}px viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const capture = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: "disabled" });
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
    await saveUrlAndOpenUpload(page);
    await expect(page.getByRole("navigation", { name: "신청 진행 단계" })).toBeInViewport();
    await capture("audio-upload-required");
    await uploadAudio(page, "zip");
    await capture("audio-upload-complete");
    await openFinalReview(page, "https://www.genie.co.kr/detail/albumInfo?axnm=1234567");
    await expect(page.getByRole("navigation", { name: "신청 진행 단계" })).toBeInViewport();
    await capture("final-review");
  });
}
