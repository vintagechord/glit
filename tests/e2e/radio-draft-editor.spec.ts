import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { archiveClientDocument } from "./support/music-archive-mount";

let html: string;
test.beforeAll(async () => { html = await archiveClientDocument("./tests/e2e/support/radio-draft-editor-mount", "RadioDraftEditorFixture"); });
async function mount(page: Page, english = false) {
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html })
    : route.fulfill({ status: 404, body: "External calls blocked" }));
  await page.goto(`/__radio-editor?language=${english ? "en" : "ko"}`);
}

for (const english of [false, true]) for (const width of [320, 1280]) {
  test(`final draft copying, editing, TXT and read-only preview work in ${english ? "English" : "Korean"} at ${width}px`, async ({ page, context }, testInfo) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width, height: 800 });
    await mount(page, english);
    if (width === 320) await page.locator("html").evaluate(element => element.classList.add("dark"));
    const editor = page.getByTestId("radio-draft-editor");
    const title = editor.getByLabel(english ? "Post title" : "게시글 제목");
    const body = editor.getByLabel(english ? "Your story and song request" : "사연과 신청곡 문구");
    await expect(title).toHaveAttribute("maxlength", "300");
    await expect(body).toHaveAttribute("maxlength", "5000");
    await editor.getByRole("button", { name: english ? "Copy all" : "전체 복사", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${await title.inputValue()}\n\n${await body.inputValue()}`);
    await expect(editor.getByRole("status")).toHaveCount(1);
    await expect(editor.getByRole("status")).toContainText(english ? "copied together" : "함께 복사");
    await body.fill("수정한 최종 신청글입니다.");
    await expect(editor.getByRole("status")).not.toContainText(english ? "copied together" : "함께 복사");
    await expect(editor.getByRole("button", { name: english ? "Copy request" : "본문 복사", exact: true })).toBeVisible();
    await editor.getByRole("button", { name: english ? "Copy request" : "본문 복사", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("수정한 최종 신청글입니다.");
    const download = page.waitForEvent("download");
    await editor.getByRole("button", { name: english ? "Save as TXT" : "TXT로 저장", exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("onside-radio-request.txt");
    const bytes = await readFile((await file.path())!);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).toBe(`\uFEFF${await title.inputValue()}\n\n수정한 최종 신청글입니다.`);
    await page.getByRole("button", { name: "Toggle preview" }).click();
    await expect(title).toHaveAttribute("readonly", "");
    await expect(body).toHaveAttribute("readonly", "");
    await expect(editor.getByText(english ? "Prepared request" : "준비한 신청글", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`radio-editor-${width}-${english ? "en" : "ko"}.png`), fullPage: true });
  });
}

test("clipboard denial offers selected single fields and a selected combined fallback", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("blocked")) } }));
  const editor = page.getByTestId("radio-draft-editor");
  const title = editor.getByLabel("게시글 제목");
  await editor.getByRole("button", { name: "제목 복사", exact: true }).click();
  await expect(title).toBeFocused();
  expect(await title.evaluate(element => (element as HTMLInputElement).selectionEnd)).toBe((await title.inputValue()).length);
  await editor.getByRole("button", { name: "전체 복사", exact: true }).click();
  const combined = editor.getByLabel("직접 복사할 제목과 본문");
  await expect(combined).toBeFocused();
  await expect(combined).toHaveValue(`${await title.inputValue()}\n\n${await editor.getByLabel("사연과 신청곡 문구").inputValue()}`);
  expect(await combined.evaluate(element => (element as HTMLTextAreaElement).selectionEnd)).toBe((await combined.inputValue()).length);
  await expect(editor.getByRole("status")).toContainText("직접 복사");
  await editor.getByLabel("사연과 신청곡 문구").fill("다시 편집한 내용");
  await expect(combined).toHaveCount(0);
});

test("a late clipboard success cannot mark an edited draft as copied", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => new Promise<void>(resolve => { (window as unknown as { finishCopy: () => void }).finishCopy = resolve; }) } }));
  const editor = page.getByTestId("radio-draft-editor");
  await editor.getByRole("button", { name: "전체 복사", exact: true }).click();
  await editor.getByLabel("사연과 신청곡 문구").fill("복사가 끝나기 전에 수정한 글");
  await page.evaluate(() => (window as unknown as { finishCopy: () => void }).finishCopy());
  await expect(editor.getByRole("button", { name: "본문 복사", exact: true })).toBeVisible();
  await expect(editor.getByRole("status")).not.toContainText("복사했습니다");
});
