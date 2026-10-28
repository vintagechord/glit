import { expect, test, type Page } from "@playwright/test";
import { createArchiveData } from "../../src/lib/music-archive/model";
import { mergeArchiveImports } from "../../src/lib/music-archive/import";
import { memberArchiveResponse } from "../../src/lib/music-archive/member-view";
import { archiveClientDocument } from "./support/music-archive-mount";

const libraryId = "11111111-1111-4111-8111-111111111111";
let html: string;
test.beforeAll(async () => { html = await archiveClientDocument("./src/features/music-archive/music-archive-client", "MusicArchiveClient"); });

async function mount(page: Page, mixed: boolean, withCredits = false) {
  const data = mergeArchiveImports(createArchiveData("참여 아티스트"), [{
    provider: "melon", externalId: "100", title: "함께 만든 참여 앨범", date: "2026-10-01", type: "ep", secondaryTypes: [],
    participation: true, artistName: "발매 아티스트", artistIds: ["99"], barcode: null, version: "", country: "KR",
    url: "https://www.melon.com/album/detail.htm?albumId=100", imageUrl: null, checkedAt: "2026-10-28T00:00:00Z",
    tracks: [true, false].map((first, index) => ({
      externalId: String(1000 + index), recordingId: null, title: first ? "첫 번째 수록곡" : "함께 부른 수록곡", version: "",
      artistName: first && mixed ? "참여 아티스트" : "발매 아티스트", artistIds: first && mixed ? ["12"] : ["99"],
      position: index + 1, discNumber: 1, durationMs: null, isrcs: [], managedByArtist: first && mixed,
      url: `https://www.melon.com/song/detail.htm?songId=${1000 + index}`,
    })),
  }]);
  if (withCredits) {
    data.tracks.forEach((track, index) => {
      track.recordingId = `recording-${index}`;
      data.recordings.push({ id: track.recordingId, title: track.title, workIds: [`work-${index}`, ...(index ? ["work-duplicate"] : [])] });
      data.works.push({ id: `work-${index}`, title: track.title, institutionNumbers: [], contributors: index
        ? [{ name: "참여 아티스트", role: "lyrics" }, { name: "참여 아티스트", role: "composition" }, { name: "공동 작곡가", role: "composition" }, { name: "편곡 담당", role: "arrangement" }]
        : [{ name: "확인된 가창곡 작곡가", role: "composition" }] });
    });
    data.works.push({ id: "work-duplicate", title: "함께 부른 수록곡", institutionNumbers: [], contributors: [{ name: "참여 아티스트", role: "composition" }] });
    for (const kind of ["excluded", "merged"] as const) {
      data.tracks.push({ ...data.tracks[1], id: `${kind}-track`, title: `${kind} 숨긴 곡`, recordingId: `${kind}-recording`, ...(kind === "excluded" ? { excluded: true } : { mergedInto: data.tracks[1].id }) });
      data.recordings.push({ id: `${kind}-recording`, title: "숨긴 곡", workIds: [`${kind}-work`] });
      data.works.push({ id: `${kind}-work`, title: "숨긴 곡", institutionNumbers: [], contributors: [{ name: "숨긴 저작자", role: "composition" }] });
    }
  }
  const library = { id: libraryId, version: 1, data };
  const writes: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.context().route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.resourceType() === "document" && url.pathname === "/mypage/music") { await route.fulfill({ contentType: "text/html", body: html }); return; }
    if (url.pathname === "/api/music-archive" && request.method() === "GET") {
      await route.fulfill({ json: memberArchiveResponse(url.searchParams.has("libraryId")
        ? { library, jobs: [], reviews: [], onsideReviews: [], evidence: [], events: [] }
        : { libraries: [library], providers: [], guides: [], jobs: [], total: 1, nextPage: null }) });
      return;
    }
    if (request.method() !== "GET") writes.push(request.url());
    await route.fulfill({ status: 404, body: "Unexpected request blocked by participation UI test." });
  });
  await page.goto(`/mypage/music?artist=${libraryId}&release=melon-release%3A100`);
  await expect(page.getByRole("heading", { name: "함께 만든 참여 앨범", exact: true })).toBeVisible();
  return { writes, errors, data };
}

test("participation-only albums show every imported song without enabling unverified track actions at 390px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const harness = await mount(page, false);
  await expect(page.getByText("2026-10-01 · 2곡", { exact: true })).toBeVisible();
  const songs = page.getByRole("list", { name: "앨범 전체 수록곡" });
  await expect(songs).toBeVisible();
  await expect(songs.getByRole("listitem")).toHaveCount(2);
  await expect(songs).toContainText("첫 번째 수록곡");
  await expect(songs).toContainText("함께 부른 수록곡");
  await expect(page.getByLabel("관리할 음악", { exact: true }).locator("option")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "심의 내역 입력", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "온사이드에 심의 신청", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(harness.writes).toEqual([]); expect(harness.errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("participation-mobile.png"), fullPage: true });
});

test("mixed albums keep all songs visible in a read-only list and only confirmed songs in management", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const harness = await mount(page, true);
  await expect(page.getByText("2026-10-01 · 2곡", { exact: true })).toBeVisible();
  await page.getByText("전체 수록곡 2곡", { exact: true }).click();
  const songs = page.getByRole("list", { name: "앨범 전체 수록곡" });
  await expect(songs.getByRole("listitem")).toHaveCount(2);
  await expect(songs).toContainText("관리 중");
  await expect(songs).toContainText("저작자 정보 확인 필요");
  const selector = page.getByLabel("관리할 음악", { exact: true });
  await expect(selector.locator("option")).toHaveCount(2);
  await expect(selector.locator("option")).toHaveText(["앨범 전체", "1. 첫 번째 수록곡"]);
  await selector.selectOption("melon-track:100:1000");
  await expect(page.getByRole("button", { name: "심의 내역 입력", exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "온사이드에 심의 신청", exact: true })).toHaveAttribute("href", /archiveTrack=melon-track%3A100%3A1000/);
  expect(harness.writes).toEqual([]); expect(harness.errors).toEqual([]);
});

test("unmanaged participation credits show every role without inferring artist ownership or registration at 390px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const harness = await mount(page, false, true);
  const songs = page.getByRole("list", { name: "앨범 전체 수록곡" });
  const authored = songs.getByRole("listitem").filter({ hasText: "함께 부른 수록곡" });
  await expect(authored.locator("p").filter({ hasText: /^작사/ })).toHaveText(/작사\s*참여 아티스트$/);
  await expect(authored.locator("p").filter({ hasText: /^작곡/ })).toHaveText(/작곡\s*참여 아티스트, 공동 작곡가$/);
  await expect(authored.locator("p").filter({ hasText: /^편곡/ })).toHaveText(/편곡\s*편곡 담당$/);
  await expect(authored).toContainText("저작자 정보 있음");
  await expect(songs.getByRole("listitem")).toHaveCount(2);
  await expect(songs).not.toContainText("숨긴 저작자");
  await expect(page.getByLabel("관리할 음악", { exact: true }).locator("option")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "심의 내역 입력", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "온사이드에 심의 신청", exact: true })).toHaveCount(0);

  await page.getByRole("navigation", { name: "음악 관리 탭" }).getByRole("button", { name: "저작권 등록", exact: true }).click();
  const copyright = page.getByRole("region", { name: "저작권 등록 정보" });
  await expect(copyright.getByRole("article")).toHaveCount(2);
  await expect(copyright.getByRole("article", { name: "함께 부른 수록곡 저작자 정보", exact: true })).toContainText("참여 아티스트");
  await expect(copyright.getByText("저작자 정보 있음", { exact: true })).toBeVisible();
  await expect(copyright.getByText("등록 정보 있음", { exact: true })).toHaveCount(0);
  await expect(copyright.getByText("등록됨", { exact: true })).toHaveCount(0);
  await expect(copyright).not.toContainText("숨긴 저작자");
  await expect(copyright.getByRole("button", { name: "등록 정보 입력", exact: true })).toBeDisabled();
  expect(harness.data.tracks.every(track => !track.managed)).toBe(true);
  expect(harness.data.tasks).toEqual([]); expect(harness.writes).toEqual([]); expect(harness.errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("participation-credits-mobile.png"), fullPage: true });
});

test("mixed participation credits remain read-only while review and registration editors use only confirmed tracks", async ({ page }) => {
  const harness = await mount(page, true, true);
  await page.getByText("전체 수록곡 2곡", { exact: true }).click();
  const songs = page.getByRole("list", { name: "앨범 전체 수록곡" });
  await expect(songs.getByRole("listitem").filter({ hasText: "첫 번째 수록곡" })).toContainText("관리 중");
  await expect(songs.getByRole("listitem").filter({ hasText: "함께 부른 수록곡" })).not.toContainText("관리 중");
  const selector = page.getByLabel("관리할 음악", { exact: true });
  await expect(selector.locator("option")).toHaveText(["앨범 전체", "1. 첫 번째 수록곡"]);
  await expect(page.getByText("심의 신청 가능한 음원 1곡", { exact: true })).toBeVisible();

  await page.getByRole("navigation", { name: "음악 관리 탭" }).getByRole("button", { name: "저작권 등록", exact: true }).click();
  const copyright = page.getByRole("region", { name: "저작권 등록 정보" });
  await expect(copyright.getByRole("article")).toHaveCount(2);
  await copyright.getByRole("button", { name: "등록 정보 입력", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "등록 정보 입력", exact: true });
  await expect(dialog.getByLabel("저작자 1", { exact: true })).toHaveValue("확인된 가창곡 작곡가");
  await expect(dialog.getByRole("textbox", { name: /^저작자 \d+$/ })).toHaveCount(1);
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("navigation", { name: "음악 관리 탭" }).getByRole("button", { name: "심의", exact: true }).click();
  await selector.selectOption("melon-track:100:1000");
  await expect(page.getByRole("link", { name: "온사이드에 심의 신청", exact: true })).toHaveAttribute("href", /archiveTrack=melon-track%3A100%3A1000/);
  expect(harness.data.tracks.filter(track => track.managed).map(track => track.id)).toEqual(["melon-track:100:1000"]);
  expect(harness.data.tasks).toEqual([]); expect(harness.writes).toEqual([]); expect(harness.errors).toEqual([]);
});
