import { expect, test, type Page } from "@playwright/test";
import { createArchiveData } from "../../src/lib/music-archive/model";
import { mergeArchiveImports } from "../../src/lib/music-archive/import";
import { memberArchiveResponse } from "../../src/lib/music-archive/member-view";
import { archiveClientDocument } from "./support/music-archive-mount";

const libraryId = "11111111-1111-4111-8111-111111111111";
let html: string;
test.beforeAll(async () => { html = await archiveClientDocument("./src/features/music-archive/music-archive-client", "MusicArchiveClient"); });

async function mount(page: Page, mixed: boolean) {
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
  return { writes, errors };
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
  await expect(songs).toContainText("참여 정보 확인 필요");
  const selector = page.getByLabel("관리할 음악", { exact: true });
  await expect(selector.locator("option")).toHaveCount(2);
  await expect(selector.locator("option")).toHaveText(["앨범 전체", "1. 첫 번째 수록곡"]);
  await selector.selectOption("melon-track:100:1000");
  await expect(page.getByRole("button", { name: "심의 내역 입력", exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "온사이드에 심의 신청", exact: true })).toHaveAttribute("href", /archiveTrack=melon-track%3A100%3A1000/);
  expect(harness.writes).toEqual([]); expect(harness.errors).toEqual([]);
});
