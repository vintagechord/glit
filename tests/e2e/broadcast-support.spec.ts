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
  const labels = english ? ["Choose a program", "Prepare request", "Posting guide"] : ["이 곡으로 프로그램 고르기", "이 프로그램으로 초안 만들기", "신청 방법 보기"];
  await page.getByRole("button", { name: labels[step - 1], exact: true }).click();
  await expect(page.getByTestId(`radio-step-${step + 1}`)).toBeVisible();
  await expect(page.locator('[data-testid^="radio-step-"]')).toHaveCount(1);
  await expect(page.getByTestId(`radio-step-${step + 1}`).getByRole("heading", { level: 3 })).toBeFocused();
  if (step === 2) await page.locator("summary").filter({ hasText: english ? "Add my story or listening link" : "내 이야기·음원 링크 더하기" }).click();
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
    await page.getByRole("button", { name: english ? "Choose a program" : "이 곡으로 프로그램 고르기" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("radio-step-2").getByRole("heading", { level: 3 })).toBeFocused();
    await expect(page.getByRole("button", { name: english ? "Prepare request" : "이 프로그램으로 초안 만들기" })).toBeDisabled();
    await expect(page.getByRole("link", { name: /KBS 라디오/ })).toHaveAttribute("href", "https://radio.kbs.co.kr/");
    await page.getByLabel(english ? "Program name you checked (required)" : "직접 확인한 프로그램명 (필수)").fill("나의 저녁 라디오");
    await next(page, 2, english);
    const writingHelp = page.locator("summary").filter({ hasText: english ? "Add my story or listening link" : "내 이야기·음원 링크 더하기" });
    await writingHelp.click();
    await page.screenshot({ path: testInfo.outputPath(`request-compose-${width}-${english ? "en" : "ko"}.png`), fullPage: true });
    await writingHelp.click();
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

const workspaceKey = "onside:radio-request:v1:fixture";
const stepButton = (page: Page, number: number) => page.getByRole("navigation", { name: "방송 신청 단계" }).getByRole("button", { name: new RegExp(`^${number}단계:`) });

test("step navigation supports the keyboard and guards missing input while program search retains the selection", async ({ page }) => {
  await mount(page);
  await page.getByLabel("적격 방송국", { exact: true }).selectOption("arirang");
  await expect(stepButton(page, 3)).toBeDisabled();
  await expect(stepButton(page, 4)).toBeDisabled();
  await stepButton(page, 2).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("radio-step-2").getByRole("heading", { level: 3 })).toBeFocused();
  await expect(stepButton(page, 2)).toHaveAttribute("aria-current", "step");
  const search = page.getByLabel("프로그램 검색", { exact: true });
  await search.fill("존재하지 않는 프로그램");
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByText(/검색 결과가 없습니다/)).toBeVisible();
  await search.fill("K-POPPIN");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "K-POPPIN’ 선택", exact: true }).click();
  await search.fill("Radio’n Us");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByLabel("선택한 프로그램 또는 다른 프로그램명")).toHaveValue("K-POPPIN’");
  await stepButton(page, 3).click();
  await expect(page.locator('[data-testid^="radio-step-"]')).toHaveCount(1);
  const body = page.getByLabel("사연과 신청곡 문구");
  await body.fill("");
  await expect(stepButton(page, 4)).toBeDisabled();
  await body.fill("내 최종 신청글");
  await stepButton(page, 4).click();
  await expect(page.getByRole("link", { name: /K-POPPIN’ 신청 게시판 열기/ })).toHaveAttribute("href", "https://www.arirang.com/radio/125/board/674");
  await stepButton(page, 2).click();
  await page.getByLabel("선택한 프로그램 또는 다른 프로그램명").fill("");
  await expect(stepButton(page, 3)).toBeDisabled();
  await expect(stepButton(page, 4)).toBeDisabled();
  await page.getByLabel("선택한 프로그램 또는 다른 프로그램명").fill("내가 확인한 다른 프로그램");
  await stepButton(page, 4).click();
  await expect(page.getByRole("link", { name: /공식 사이트에서 내가 확인한 다른 프로그램 찾기/ })).toHaveAttribute("href", "https://www.arirang.com/radio");
});

test("writing help adds personal story and a safe listening link only when requested, and copy all uses the final text", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mount(page);
  await chooseArirang(page);
  const story = page.getByLabel("내 곡만의 이야기를 더해보세요 (선택)");
  const body = page.getByLabel("사연과 신청곡 문구");
  const originalBody = await body.inputValue();
  await story.fill("내 음악은 반려견과 걷던 저녁에서 시작됐어요.");
  await expect(page.getByText("아직 최종 신청글에 반영되지 않았어요.")).toBeVisible();
  await expect(body).toHaveValue(originalBody);
  await page.getByRole("button", { name: "신청 문구에 이야기 추가", exact: true }).click();
  await expect(body).toHaveValue(/반려견과 걷던 저녁/);
  await expect(story).toHaveValue("");
  const listening = page.getByLabel("공개 음원 링크 (선택)");
  for (const invalid of ["javascript:alert(1)", "https://user:pass@example.com/track"]) {
    await listening.fill(invalid);
    await expect(listening).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("button", { name: "신청글에 링크 추가", exact: true })).toBeDisabled();
  }
  await listening.fill("https://music.example.com/my-song");
  await page.getByRole("button", { name: "신청글에 링크 추가", exact: true }).click();
  await expect(body).toHaveValue(/Listen: https:\/\/music\.example\.com\/my-song/);
  await expect(page.getByRole("button", { name: "신청글에 링크 추가", exact: true })).toBeDisabled();
  const editor = page.getByTestId("radio-draft-editor");
  await editor.getByRole("button", { name: "전체 복사", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${await page.getByLabel("게시글 제목").inputValue()}\n\n${await body.inputValue()}`);
});

test("this tab restores draft, story, selected program, post link and notes after refresh, while another tab starts fresh", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mount(page);
  await chooseArirang(page);
  await page.getByLabel("게시글 제목").fill("나만의 신청글 제목");
  await page.getByLabel("사연과 신청곡 문구").fill("이 신청글을 새로고침 뒤에도 계속 작성합니다.");
  await page.getByLabel("내 곡만의 이야기를 더해보세요 (선택)").fill("아직 작성 중인 이야기");
  await page.getByLabel("공개 음원 링크 (선택)").fill("https://music.example.com/listen");
  await page.getByRole("button", { name: "전체 복사", exact: true }).click();
  await next(page, 3);
  const postLink = page.getByLabel("내 신청 게시글 주소 (선택)");
  await postLink.fill("javascript:alert(1)");
  await expect(postLink).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("link", { name: "내 게시글 열기", exact: true })).toHaveCount(0);
  await postLink.fill("https://www.arirang.com/radio/125/board/674?post=fixture");
  await expect(page.getByRole("link", { name: "내 게시글 열기", exact: true })).toHaveAttribute("href", "https://www.arirang.com/radio/125/board/674?post=fixture");
  await page.getByLabel("다음 확인을 위한 메모 (선택)").fill("다음 주에 선곡표를 확인하기");
  await page.getByLabel("방송국에서 직접 신청글을 등록했어요").check();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "신청글과 기록 TXT 저장", exact: true }).click();
  const file = await download;
  const text = await readFile((await file.path())!, "utf8");
  expect(text).toContain("나만의 신청글 제목");
  expect(text).toContain("https://www.arirang.com/radio/125/board/674?post=fixture");
  expect(text).toContain("다음 주에 선곡표를 확인하기");
  await page.reload();
  await expect(page.getByTestId("radio-step-4")).toBeVisible();
  await expect(page.getByTestId("radio-storage-status")).toContainText("불러왔어요");
  await expect(page.getByLabel("방송국에서 직접 신청글을 등록했어요")).toBeChecked();
  await expect(postLink).toHaveValue("https://www.arirang.com/radio/125/board/674?post=fixture");
  await expect(page.getByLabel("다음 확인을 위한 메모 (선택)")).toHaveValue("다음 주에 선곡표를 확인하기");
  await stepButton(page, 3).click();
  await page.locator("summary").filter({ hasText: "내 이야기·음원 링크 더하기" }).click();
  await expect(page.getByLabel("게시글 제목")).toHaveValue("나만의 신청글 제목");
  await expect(page.getByLabel("사연과 신청곡 문구")).toHaveValue("이 신청글을 새로고침 뒤에도 계속 작성합니다.");
  await expect(page.getByLabel("내 곡만의 이야기를 더해보세요 (선택)")).toHaveValue("아직 작성 중인 이야기");
  await expect(page.getByLabel("공개 음원 링크 (선택)")).toHaveValue("https://music.example.com/listen");
  await expect(page.getByRole("button", { name: "본문 복사", exact: true })).toBeVisible();
  const other = await context.newPage();
  await mount(other);
  await expect(other.getByTestId("radio-step-1")).toBeVisible();
  expect(await other.evaluate(key => sessionStorage.getItem(key), workspaceKey)).toBeNull();
  await other.close();
});

for (const failure of ["blocked", "malformed", "quota"] as const) {
  test(`draft editing and TXT remain available when tab storage is ${failure}`, async ({ page }) => {
    await page.addInitScript(({ failure, key }) => {
      if (failure === "blocked") Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new DOMException("Blocked", "SecurityError"); } });
      if (failure === "malformed") sessionStorage.setItem(key, "{broken-json");
      if (failure === "quota") Storage.prototype.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
    }, { failure, key: workspaceKey });
    await mount(page);
    if (failure !== "quota") await expect(page.getByTestId("radio-storage-status")).toContainText("탭 저장을 사용할 수 없습니다");
    await chooseArirang(page);
    await page.getByLabel("사연과 신청곡 문구").fill("저장 불가 상황에서도 유지할 내용");
    await expect(page.getByLabel("사연과 신청곡 문구")).toHaveValue("저장 불가 상황에서도 유지할 내용");
    if (failure !== "malformed") await expect(page.getByTestId("radio-storage-status")).toContainText("탭 저장을 사용할 수 없습니다");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "TXT로 저장", exact: true }).click();
    const file = await download;
    expect(await readFile((await file.path())!, "utf8")).toContain("저장 불가 상황에서도 유지할 내용");
  });
}

test("reset needs a second click, clears only this album and does not let saved work override live eligibility", async ({ page }) => {
  await mount(page);
  await chooseArirang(page);
  await page.getByLabel("사연과 신청곡 문구").fill("확인 전에는 지우지 않을 글");
  await page.evaluate(() => sessionStorage.setItem("onside:radio-request:v1:another-album", "another album’s work"));
  await page.getByRole("button", { name: "저장 내용 초기화", exact: true }).click();
  await page.getByRole("button", { name: "계속 작성", exact: true }).click();
  await expect(page.getByLabel("사연과 신청곡 문구")).toHaveValue("확인 전에는 지우지 않을 글");
  await page.getByRole("button", { name: "저장 내용 초기화", exact: true }).click();
  await page.getByRole("button", { name: "이 음반의 저장 내용 지우기", exact: true }).click();
  await expect(page.getByTestId("radio-step-1")).toBeVisible();
  const resetState = await page.evaluate(key => {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw).state : { selections: {}, manualNames: {}, drafts: {}, progress: {} };
  }, workspaceKey);
  expect(Object.values(resetState.selections).every(value => !(value as { program?: string }).program)).toBe(true);
  expect(resetState.manualNames).toEqual({});
  expect(resetState.drafts).toEqual({});
  expect(resetState.progress).toEqual({});
  expect(await page.evaluate(() => sessionStorage.getItem("onside:radio-request:v1:another-album"))).toBe("another album’s work");
  await chooseArirang(page);
  await page.getByLabel("사연과 신청곡 문구").fill("새로 저장한 글");
  await page.goto("/__broadcast-test?mode=rejected");
  await expect(page.getByTestId("radio-request-wizard")).toHaveCount(0);
});

test("a saved song removed from the approved list requires confirming a currently approved song", async ({ page }) => {
  await mount(page);
  await chooseArirang(page);
  await page.getByLabel("사연과 신청곡 문구").fill("이전 곡만을 위해 작성한 사연");
  await page.goto("/__broadcast-test?mode=revoked-track");
  await expect(page.getByTestId("radio-step-1")).toBeVisible();
  await expect(page.getByText("이전에 선택한 곡이 현재 적격 목록에서 빠졌어요. 신청할 곡을 다시 확인한 뒤 진행해주세요.")).toBeVisible();
  await expect(page.getByLabel("신청할 적격 곡").locator("option")).toHaveText(["다른 노래"]);
  await expect(stepButton(page, 3)).toBeDisabled();
  await expect(stepButton(page, 4)).toBeDisabled();
  await next(page, 1);
  await next(page, 2);
  await expect(page.getByLabel("사연과 신청곡 문구")).not.toHaveValue(/이전 곡만을/);
  await expect(page.getByLabel("게시글 제목")).toHaveValue(/다른 노래/);
});
