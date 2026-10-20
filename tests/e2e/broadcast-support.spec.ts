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
    await expect(page.getByRole("link", { name: /KBS 라디오 · 전체 프로그램/ })).toHaveAttribute("href", "https://radio.kbs.co.kr/");
    await expect(page.getByText("내 곡과 맞는 프로그램 찾기", { exact: true })).toBeVisible();
    await page.getByLabel("사연과 신청곡 문구").fill("퇴근길에 함께 듣고 싶은 노래입니다.");
    await page.getByRole("button", { name: "본문 복사", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("복사했습니다.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("퇴근길에 함께 듣고 싶은 노래입니다.");
    await page.getByLabel("적격 방송국", { exact: true }).selectOption("mbc");
    await expect(page.getByLabel("신청할 적격 곡")).toHaveValue("two");
    await expect(page.getByLabel("게시글 제목")).toHaveValue("[신청곡] 테스트 뮤지션 - 다른 노래");
    await expect(page.getByRole("link", { name: /MBC 라디오 · 전체 프로그램/ })).toHaveAttribute("target", "_blank");
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

test("legacy approval without track metadata still provides official participation guidance", async ({ page }) => {
  await mount(page, "missing-tracks");
  await expect(page.getByText(/개별 곡 정보가 없어 자동 초안을 만들 수 없습니다/)).toBeVisible();
  await expect(page.getByRole("link", { name: /K-POPPIN/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Radio’n Us/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /메시지 게시판 열기/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "본문 복사" })).toHaveCount(0);
  await expect(page.getByLabel("신청할 적격 곡")).toHaveCount(0);
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

test("personalized story preparation retains edits and resets copied status when the request changes", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mount(page);
  await expect(page.getByText("나의 음악만을 위한 방송 제안", { exact: true })).toBeVisible();
  await expect(page.getByText("테스트 뮤지션 · 퇴근길", { exact: true })).toBeVisible();
  await expect(page.getByText(/4개 방송국, 2곡의 적격 결과/)).toBeVisible();
  await page.getByLabel("사연과 신청곡 문구").fill("직접 작성해 둔 소개입니다.");
  await page.getByRole("button", { name: "듣기 좋은 순간", exact: true }).click();
  await page.getByLabel("내 곡만의 이야기를 더해보세요").fill("긴 하루를 마친 분들과 함께 듣고 싶어요.");
  await page.getByRole("button", { name: "신청 문구에 이야기 추가" }).click();
  await expect(page.getByLabel("사연과 신청곡 문구")).toHaveValue("직접 작성해 둔 소개입니다.\n\n긴 하루를 마친 분들과 함께 듣고 싶어요.");
  await page.getByRole("button", { name: "제목 복사", exact: true }).click();
  await page.getByRole("button", { name: "본문 복사", exact: true }).click();
  await expect(page.getByRole("list", { name: "신청 준비 진행 상태" })).toContainText("신청 문구 복사 완료");
  await page.getByLabel("사연과 신청곡 문구").fill("수정한 새로운 사연");
  await expect(page.getByRole("list", { name: "신청 준비 진행 상태" })).toContainText("신청 문구 복사 대기");
});

test("official handoff and follow-up stay with the selected broadcaster, track and program", async ({ page }) => {
  await mount(page);
  const posted = page.getByLabel("방송국에서 직접 신청글을 등록했어요");
  await posted.check();
  await page.getByLabel("적격 방송국", { exact: true }).selectOption("mbc");
  await expect(posted).not.toBeChecked();
  await expect(page.getByRole("link", { name: /MBC mini 실시간 참여 안내/ })).toHaveAttribute("href", "https://miniwebapp.imbc.com/");
  await page.getByLabel("적격 방송국", { exact: true }).selectOption("kbs");
  await expect(posted).toBeChecked();
  await page.getByLabel("적격 방송국", { exact: true }).selectOption("arirang");
  const selectProgram = (name: RegExp) => page.getByRole("article").filter({ has: page.getByRole("link", { name }) }).getByRole("button");
  await selectProgram(/K-POPPIN/).click();
  await expect(page.getByRole("link", { name: /K-POPPIN’ 신청 게시판 열기/ })).toHaveAttribute("href", "https://www.arirang.com/radio/125/board/674");
  await expect(page.getByRole("link", { name: /K-POPPIN’ 선곡표 확인/ })).toHaveAttribute("href", "https://www.arirang.com/radio/125/tracklist/671");
  await posted.check();
  await selectProgram(/Radio’n Us/).click();
  await expect(posted).not.toBeChecked();
  await expect(page.getByRole("link", { name: /Radio’n Us 신청 게시판 열기/ })).toHaveAttribute("href", "https://www.arirang.com/radio/127/board/771");
  await selectProgram(/K-POPPIN/).click();
  await expect(posted).toBeChecked();
  await page.getByLabel("신청할 적격 곡").selectOption("two");
  await expect(posted).not.toBeChecked();
});
