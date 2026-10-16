import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import PizZip from "pizzip";
import { archiveClientDocument } from "./support/music-archive-mount";

let html: string;
test.beforeAll(async () => { html = await archiveClientDocument("./tests/e2e/support/broadcast-support-mount", "BroadcastSupportFixture"); });
async function mount(page: Page, mode = "") {
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html })
    : route.fulfill({ status: 404, body: "External calls blocked" }));
  await page.goto(`/__broadcast-test?mode=${mode}`);
  await expect(page.getByTestId("broadcast-support")).toBeVisible();
}

for (const width of [390, 1440]) {
  test(`radio guide, approved track selection, copying and ZIP work at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await mount(page);
    await expect(page.getByLabel("신청할 적격 곡").locator("option")).toHaveCount(1);
    await expect(page.getByLabel("신청할 적격 곡")).toHaveValue("one");
    await expect(page.getByRole("link", { name: /KBS 라디오/ })).toHaveAttribute("href", "https://radio.kbs.co.kr/");
    await expect(page.getByText("내 곡과 맞는 프로그램 찾기", { exact: true })).toBeVisible();
    await page.getByLabel("사연과 신청곡 문구").fill("퇴근길에 함께 듣고 싶은 노래입니다.");
    await page.getByRole("button", { name: "본문 복사", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("복사했습니다.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("퇴근길에 함께 듣고 싶은 노래입니다.");
    await page.getByLabel("적격 방송국", { exact: true }).selectOption("mbc");
    await expect(page.getByLabel("신청할 적격 곡")).toHaveValue("two");
    await expect(page.getByLabel("게시글 제목")).toHaveValue("[신청곡] 테스트 뮤지션 - 다른 노래");
    await expect(page.getByRole("link", { name: /MBC 라디오/ })).toHaveAttribute("target", "_blank");
    await page.getByLabel("적격 방송국", { exact: true }).selectOption("kbs");
    await expect(page.getByLabel("사연과 신청곡 문구")).toHaveValue("퇴근길에 함께 듣고 싶은 노래입니다.");
    await page.getByLabel("적격 방송국", { exact: true }).selectOption("mbc");
    await page.getByText("준비 체크리스트 · 방송 참고자료", { exact: true }).click();
    await page.getByLabel("프로그램 게시판 공지 확인").check();
    await expect(page.getByLabel("프로그램 게시판 공지 확인")).toBeChecked();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "참고자료 ZIP 다운로드" }).click();
    const file = await download;
    const zip = new PizZip(await readFile((await file.path())!));
    expect(zip.file("01-credits.txt")!.asText()).toContain("작곡가");
    expect(zip.file("02-station-results.csv")!.asText()).toContain("부적격");
    expect(zip.file("03-radio-guide.txt")!.asText()).toContain("사연과 신청곡");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`radio-guide-${width}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("clipboard denial allows manual copying and unknown broadcaster has no unrelated links", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("blocked")) } }));
  await page.getByRole("button", { name: "제목 복사", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("직접 복사");
  await expect(page.getByLabel("게시글 제목")).toBeFocused();
  await page.getByLabel("적격 방송국", { exact: true }).selectOption("kiss");
  await expect(page.getByTestId("broadcast-support").getByRole("link")).toHaveCount(0);
  await expect(page.getByText(/공개 신청곡 게시판은 확인되지/)).toBeVisible();
});

test("rejected results show guidance without an eligible request", async ({ page }) => {
  await mount(page, "rejected");
  await expect(page.getByText(/현재 신청곡으로 안내할 적격 곡이 없습니다/)).toBeVisible();
  await expect(page.getByRole("button", { name: "본문 복사" })).toHaveCount(0);
});

test("English result pages have an English radio guide and draft", async ({ page }) => {
  await mount(page, "english");
  await expect(page.getByRole("heading", { name: "Find a program for your song" })).toBeVisible();
  await expect(page.getByLabel("Post title")).toHaveValue(/Song request:/);
});

test("Arirang program selection prepares an English draft and preserves edited language drafts", async ({ page }) => {
  await mount(page);
  await page.getByLabel("적격 방송국", { exact: true }).selectOption("arirang");
  await expect(page.getByLabel("신청 문구 언어")).toHaveValue("en");
  await expect(page.getByLabel("게시글 제목")).toHaveValue("Song request: Test Musician – Song Together");
  const program = page.getByRole("article").filter({ has: page.getByRole("link", { name: /K-POPPIN/ }) });
  await expect(program.getByRole("link", { name: /메시지 게시판 열기/ })).toHaveAttribute("href", "https://www.arirang.com/radio/125/board/674");
  await expect(program.getByRole("link", { name: /최근 선곡표/ })).toHaveAttribute("href", "https://www.arirang.com/radio/125/tracklist/671");
  await program.getByRole("button", { name: "이 프로그램으로 문구 준비" }).click();
  await expect(page.getByLabel("신청할 프로그램 (선택)")).toHaveValue("K-POPPIN’");
  await expect(page.getByLabel("사연과 신청곡 문구")).toHaveValue(/Hello, K-POPPIN’!/);
  await page.getByLabel("사연과 신청곡 문구").fill("My personal story, preserved.");
  await page.getByLabel("신청 문구 언어").selectOption("ko");
  await expect(page.getByLabel("게시글 제목")).toHaveValue(/\[신청곡\]/);
  await page.getByLabel("신청 문구 언어").selectOption("en");
  await expect(page.getByLabel("사연과 신청곡 문구")).toHaveValue("My personal story, preserved.");
  await page.getByRole("article").filter({ has: page.getByRole("link", { name: /Radio’n Us/ }) }).getByRole("button", { name: "이 프로그램으로 문구 준비" }).click();
  await expect(page.getByLabel("신청할 프로그램 (선택)")).toHaveValue("Radio’n Us");
  await expect(page.getByLabel("사연과 신청곡 문구")).toHaveValue("My personal story, preserved.");
});
