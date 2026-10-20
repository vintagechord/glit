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
async function next(page: Page, step: number, english = false) {
  const labels = english ? ["Choose a program for this song", "Prepare my request", "View posting instructions"] : ["이 곡으로 프로그램 고르기", "이 프로그램으로 초안 만들기", "신청 방법 보기"];
  await page.getByRole("button", { name: labels[step - 1], exact: true }).click();
  await expect(page.getByTestId(`radio-step-${step + 1}`)).toBeVisible();
  await expect(page.locator('[data-testid^="radio-step-"]')).toHaveCount(1);
  await expect(page.getByTestId(`radio-step-${step + 1}`).getByRole("heading", { level: 3 })).toBeFocused();
}
async function previous(page: Page, count = 1) { for (let i = 0; i < count; i++) await page.getByRole("button", { name: "이전", exact: true }).click(); }
async function chooseArirang(page: Page, program = "K-POPPIN’") {
  await page.getByLabel("적격 방송국", { exact: true }).selectOption("arirang");
  await next(page, 1);
  await page.getByRole("button", { name: `${program} 선택`, exact: true }).click();
  await next(page, 2);
}

for (const english of [false, true]) for (const width of [320, 390, 1280]) {
  test(`personalized four-step request is usable at ${width}px in ${english ? "English" : "Korean"}`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await mount(page, english ? "english" : "");
    if (width === 320) await page.locator("html").evaluate(element => element.classList.add("dark"));
    await expect(page.getByTestId("radio-song-context")).toContainText("테스트 뮤지션 · 퇴근길");
    await expect(page.getByLabel(english ? "Approved track" : "신청할 적격 곡").locator("option")).toHaveText(["함께 듣는 노래"]);
    await expect(page.getByLabel(english ? "Post title" : "게시글 제목")).toHaveCount(0);
    await expect(page.getByRole("link")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`request-song-${width}-${english ? "en" : "ko"}.png`), fullPage: true });
    await page.getByRole("button", { name: english ? "Choose a program for this song" : "이 곡으로 프로그램 고르기" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("radio-step-2").getByRole("heading", { level: 3 })).toBeFocused();
    await expect(page.getByRole("button", { name: english ? "Prepare my request" : "이 프로그램으로 초안 만들기" })).toBeDisabled();
    await expect(page.getByRole("link", { name: /KBS 라디오/ })).toHaveAttribute("href", "https://radio.kbs.co.kr/");
    await page.getByLabel(english ? "Program name you checked (required)" : "직접 확인한 프로그램명 (필수)").fill("나의 저녁 라디오");
    await next(page, 2, english);
    await expect(page.getByLabel(english ? "Post title" : "게시글 제목")).toHaveValue(english ? "Song request: Test Musician – Song Together" : "[신청곡] 테스트 뮤지션 - 함께 듣는 노래");
    await page.getByRole("button", { name: english ? "Song mood" : "곡의 분위기", exact: true }).click();
    await page.getByLabel(english ? "Add your song’s story (optional)" : "내 곡만의 이야기를 더해보세요 (선택)").fill("차분한 기타 선율로 퇴근길의 피로를 함께 나누고 싶어요.");
    await page.getByRole("button", { name: english ? "Add my story to the request" : "신청 문구에 이야기 추가" }).click();
    const body = page.getByLabel(english ? "Your story and song request" : "사연과 신청곡 문구");
    await expect(body).toHaveValue(/차분한 기타 선율/);
    await page.getByRole("button", { name: english ? "Copy request" : "본문 복사", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("차분한 기타 선율");
    await expect(page.getByRole("button", { name: english ? "Copy request — copied" : "본문 복사 · 복사 완료", exact: true })).toBeVisible();
    await body.fill("이 곡과 함께 하루를 마무리하고 싶어요.");
    await expect(page.getByRole("button", { name: english ? "Copy request" : "본문 복사", exact: true })).toBeVisible();
    await expect(page.getByRole("status")).not.toContainText(english ? "Copied." : "복사했습니다.");
    await page.screenshot({ path: testInfo.outputPath(`request-story-${width}-${english ? "en" : "ko"}.png`), fullPage: true });
    await next(page, 3, english);
    await expect(page.getByRole("link", { name: english ? /Find 나의 저녁 라디오 on the official site/ : /공식 사이트에서 나의 저녁 라디오 찾기/ })).toHaveAttribute("href", "https://radio.kbs.co.kr/");
    await page.getByLabel(english ? "I posted the request on the broadcaster’s site" : "방송국에서 직접 신청글을 등록했어요").check();
    await page.getByText(english ? "Copy my prepared title and request" : "준비한 제목·본문 다시 복사하기", { exact: true }).click();
    await expect(page.getByLabel(english ? "Your story and song request" : "사연과 신청곡 문구")).toHaveValue("이 곡과 함께 하루를 마무리하고 싶어요.");
    await expect(page.getByLabel(english ? "Your story and song request" : "사연과 신청곡 문구")).toHaveAttribute("readonly", "");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`request-handoff-${width}-${english ? "en" : "ko"}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("drafts, unadded stories, copy flags and follow-up remain separate by program, song, station and language", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mount(page);
  await chooseArirang(page);
  await expect(page.getByLabel("사연과 신청곡 문구")).toHaveValue(/Hello, K-POPPIN’!/);
  await page.getByLabel("사연과 신청곡 문구").fill("My personal K-POPPIN story.");
  await page.getByLabel("내 곡만의 이야기를 더해보세요 (선택)").fill("Still writing my story.");
  await page.getByRole("button", { name: "본문 복사", exact: true }).click();
  await page.getByLabel("신청 문구 언어").selectOption("ko");
  await expect(page.getByLabel("사연과 신청곡 문구")).not.toHaveValue(/My personal/);
  await page.getByLabel("신청 문구 언어").selectOption("en");
  await expect(page.getByLabel("사연과 신청곡 문구")).toHaveValue("My personal K-POPPIN story.");
  await expect(page.getByLabel("내 곡만의 이야기를 더해보세요 (선택)")).toHaveValue("Still writing my story.");
  await expect(page.getByRole("button", { name: "본문 복사 · 복사 완료", exact: true })).toBeVisible();
  await next(page, 3);
  const posted = page.getByLabel("방송국에서 직접 신청글을 등록했어요");
  await posted.check();
  await expect(page.getByRole("link", { name: /K-POPPIN’ 신청 게시판 열기/ })).toHaveAttribute("href", "https://www.arirang.com/radio/125/board/674");
  await previous(page, 2);
  await page.getByRole("button", { name: "Radio’n Us 선택", exact: true }).click();
  await next(page, 2);
  await expect(page.getByLabel("사연과 신청곡 문구")).toHaveValue(/Hello, Radio’n Us!/);
  await expect(page.getByLabel("사연과 신청곡 문구")).not.toHaveValue(/K-POPPIN/);
  await expect(page.getByLabel("내 곡만의 이야기를 더해보세요 (선택)")).toHaveValue("");
  await next(page, 3);
  await expect(posted).not.toBeChecked();
  await expect(page.getByRole("link", { name: /Radio’n Us 신청 게시판 열기/ })).toHaveAttribute("href", "https://www.arirang.com/radio/127/board/771");
  await previous(page, 2);
  await page.getByRole("button", { name: "K-POPPIN’ 선택", exact: true }).click();
  await next(page, 2);
  await expect(page.getByLabel("사연과 신청곡 문구")).toHaveValue("My personal K-POPPIN story.");
  await next(page, 3);
  await expect(posted).toBeChecked();
  await page.getByRole("button", { name: "다른 신청 준비하기" }).click();
  await page.getByLabel("신청할 적격 곡").selectOption("two");
  await next(page, 1); await next(page, 2);
  await expect(page.getByLabel("사연과 신청곡 문구")).not.toHaveValue(/My personal/);
  await expect(page.getByLabel("게시글 제목")).toHaveValue(/다른 노래/);
  await previous(page, 2);
  await page.getByLabel("적격 방송국", { exact: true }).selectOption("mbc");
  await expect(page.getByLabel("신청할 적격 곡").locator("option")).toHaveText(["다른 노래"]);
  await next(page, 1);
  await page.getByRole("button", { name: "김이나의 별이 빛나는 밤에 선택", exact: true }).click();
  await next(page, 2); await next(page, 3);
  await expect(posted).not.toBeChecked();
  await expect(page.getByRole("link", { name: /김이나의 별이 빛나는 밤에 신청 게시판 열기/ })).toHaveAttribute("href", /imbc\.com/);
});

test("legacy approval requires personal song input, labels it unverified, and restores drafts only for the same names", async ({ page }) => {
  await mount(page, "missing-tracks");
  await expect(page.getByLabel("신청할 적격 곡")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "이 곡으로 프로그램 고르기" })).toBeDisabled();
  await page.getByLabel("신청할 곡명 (필수)").fill("직접 입력한 노래");
  await page.getByLabel("아티스트명 (필수)").fill("나의 활동명");
  await expect(page.getByTestId("radio-song-context")).toContainText("곡별 적격 여부 미확인");
  await next(page, 1);
  await page.getByRole("button", { name: "K-POPPIN’ 선택", exact: true }).click();
  await next(page, 2);
  await expect(page.getByLabel("게시글 제목")).toHaveValue("Song request: 나의 활동명 – 직접 입력한 노래");
  await page.getByLabel("사연과 신청곡 문구").fill("나의 첫 번째 노래 이야기");
  await previous(page, 2);
  await page.getByLabel("신청할 곡명 (필수)").fill("두 번째 곡");
  await next(page, 1); await next(page, 2);
  await expect(page.getByLabel("사연과 신청곡 문구")).not.toHaveValue(/첫 번째/);
  await previous(page, 2);
  await page.getByLabel("신청할 곡명 (필수)").fill("직접 입력한 노래");
  await next(page, 1); await next(page, 2);
  await expect(page.getByLabel("사연과 신청곡 문구")).toHaveValue("나의 첫 번째 노래 이야기");
});

test("clipboard denial selects text and unknown broadcaster never offers another broadcaster’s links", async ({ page }) => {
  await mount(page);
  await page.getByLabel("적격 방송국", { exact: true }).selectOption("kiss");
  await next(page, 1);
  await expect(page.getByText(/공개 신청곡 게시판은 확인되지/)).toBeVisible();
  await expect(page.getByRole("link")).toHaveCount(0);
  await page.getByLabel("직접 확인한 프로그램명 (필수)").fill("직접 확인한 프로그램");
  await next(page, 2);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("blocked")) } }));
  await page.getByRole("button", { name: "제목 복사", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("직접 복사");
  await expect(page.getByLabel("게시글 제목")).toBeFocused();
  await next(page, 3);
  await expect(page.getByRole("link")).toHaveCount(0);
});

test("rejected decisions cannot start the wizard; reference ZIP keeps real recorded results", async ({ page }) => {
  await mount(page, "rejected");
  await expect(page.getByTestId("radio-request-wizard")).toHaveCount(0);
  await expect(page.getByText(/현재 신청곡으로 안내할 적격 곡이 없습니다/)).toBeVisible();
  await page.getByText("심의 기록 · 방송 참고자료", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "참고자료 ZIP 다운로드" }).click();
  const file = await download;
  const zip = new PizZip(await readFile((await file.path())!));
  expect(zip.file("01-credits.txt")!.asText()).toContain("작곡가");
  expect(zip.file("02-station-results.csv")!.asText()).toContain("부적격");
  expect(zip.file("03-radio-guide.txt")!.asText()).toContain("사연과 신청곡");
});

for (const mode of ["legacy-completed", "legacy-result-ready", "legacy-pending", "legacy-rejected"]) {
  test(`${mode} cannot bypass missing or negative per-track decisions with manual song input`, async ({ page }) => {
    await mount(page, mode);
    await expect(page.getByTestId("radio-request-wizard")).toHaveCount(0);
    await expect(page.getByLabel("신청할 곡명 (필수)")).toHaveCount(0);
  });
}

test("legacy approved result snapshot restores the actual song before offering manual entry", async ({ page }) => {
  await mount(page, "legacy-recovered");
  await expect(page.getByLabel("신청할 적격 곡").locator("option")).toHaveText(["결과표에 남은 곡명"]);
  await expect(page.getByLabel("신청할 곡명 (필수)")).toHaveCount(0);
});

test("a stored title track is initially selected only among this broadcaster’s approved songs", async ({ page }) => {
  await mount(page, "title-track");
  await expect(page.getByLabel("신청할 적격 곡")).toHaveValue("one");
  await page.getByLabel("적격 방송국", { exact: true }).selectOption("arirang");
  await expect(page.getByLabel("신청할 적격 곡")).toHaveValue("two");
});

test("an approved song with missing artist metadata can prepare a draft after entering its artist", async ({ page }) => {
  await mount(page, "missing-artist");
  await expect(page.getByRole("button", { name: "이 곡으로 프로그램 고르기" })).toBeDisabled();
  await page.getByLabel("아티스트명 (필수)").fill("직접 입력 활동명");
  await next(page, 1);
  await page.getByLabel("직접 확인한 프로그램명 (필수)").fill("저녁 라디오");
  await next(page, 2);
  await expect(page.getByLabel("게시글 제목")).toHaveValue("[신청곡] 직접 입력 활동명 - 함께 듣는 노래");
});
