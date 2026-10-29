import { expect, test, type Page } from "@playwright/test";
import { applyArchiveCommand, type ArchiveCommand } from "../../src/lib/music-archive/model";
import { memberArchiveResponse } from "../../src/lib/music-archive/member-view";
import { libraryDisplayCounts } from "../../src/features/music-archive/album-display";
import { groupedAlbumFixture, groupedLibraryId } from "../fixtures/music-archive-grouped-albums";
import { archiveClientDocument } from "./support/music-archive-mount";

let html: string;
test.beforeAll(async () => { html = await archiveClientDocument("./src/features/music-archive/music-archive-client", "MusicArchiveClient"); });

async function mount(page: Page, query = "") {
  const detail = groupedAlbumFixture();
  const writes: Record<string, unknown>[] = []; const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.context().route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (request.resourceType() === "document" && url.pathname === "/mypage/music") { await route.fulfill({ contentType: "text/html", body: html }); return; }
    if (url.pathname === "/api/music-archive") {
      if (request.method() === "GET") {
        const overview = { ...detail.library, summary: { ...libraryDisplayCounts(detail.library), needsCheck: 0, inProgress: 0, needsChanges: 0, awaitingResult: 0 }, data: { ...detail.library.data, tracks: [], recordings: [], works: [], tasks: [], reviewLinks: [] } };
        await route.fulfill({ json: memberArchiveResponse(url.searchParams.has("libraryId") ? detail : { libraries: [overview], jobs: [], providers: [], guides: [], total: 1, nextPage: null }) }); return;
      }
      const body = request.postDataJSON() as Record<string, unknown>; writes.push(body);
      if (body.version !== detail.library.version) { await route.fulfill({ status: 409, json: { error: "자료가 변경되었습니다." } }); return; }
      if (body.action === "commands") detail.library.data = (body.commands as ArchiveCommand[]).reduce(applyArchiveCommand, detail.library.data);
      else if (body.action === "refresh-metadata") {
        detail.library.data = structuredClone(detail.library.data);
        const work = detail.library.data.works.find(work => work.id === "genie-work:work-0")!;
        if (!work.contributors?.some(person => person.name === "갱신된 작곡가")) work.contributors?.push({ name: "갱신된 작곡가", role: "composition" });
      } else { await route.fulfill({ status: 400, json: { error: "허용되지 않은 테스트 요청" } }); return; }
      detail.library.version += 1;
      await route.fulfill({ json: memberArchiveResponse({ library: detail.library, ...(body.action === "refresh-metadata" ? { nextOffset: null } : {}) }) }); return;
    }
    await route.fulfill({ status: 404, body: "Unexpected request blocked by grouped album UI test." });
  });
  await page.goto(`/mypage/music${query}`);
  await expect(page.getByTestId("music-archive")).toBeVisible();
  return { detail, writes, errors };
}
const albumPath = `?artist=${groupedLibraryId}&release=genie-release%3A101`;
async function switchTab(page: Page, name: string) { await page.getByRole("navigation", { name: "음악 관리 탭" }).getByRole("button", { name, exact: true }).click(); }

test("verified duplicates appear as one album and one song per recording with combined authors at 390px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const harness = await mount(page);
  await expect(page.getByRole("article", { name: "테스트 뮤지션", exact: true })).toContainText("앨범 1개 · 트랙 1개");
  await page.getByRole("button", { name: /테스트 뮤지션/ }).click();
  await expect(page.getByText("앨범 1개", { exact: true })).toBeVisible();
  await page.getByLabel("앨범 검색", { exact: true }).fill("함께 만든");
  const card = page.getByRole("button", { name: /함께 만든 앨범/ });
  await expect(card).toHaveCount(1); await expect(card).toContainText("2곡");
  await card.click();
  await page.getByText("전체 수록곡 2곡", { exact: true }).click();
  await expect(page.getByRole("list", { name: "앨범 전체 수록곡" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByLabel("관리할 음악", { exact: true }).locator("option")).toHaveText(["앨범 전체", "1. 한 곡"]);
  await switchTab(page, "저작권 등록");
  const credits = page.getByRole("region", { name: "저작권 등록 정보" });
  await expect(credits.getByRole("article")).toHaveCount(2);
  const song = credits.getByRole("article", { name: "한 곡 저작자 정보", exact: true });
  await expect(song.locator("p").filter({ hasText: /^작사/ })).toHaveText(/작사\s*함께한 저작자$/);
  await expect(song.locator("p").filter({ hasText: /^작곡/ })).toHaveText(/작곡\s*함께한 저작자$/);
  await expect(song).toContainText("편곡 참여자");
  expect(harness.detail.library.data.releases).toHaveLength(2); expect(harness.detail.library.data.tracks).toHaveLength(4);
  expect(harness.writes).toEqual([]); expect(harness.errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("grouped-album-mobile.png"), fullPage: true });
});

test("old source album and track deep links resolve the same song through tabs and browser history", async ({ page }) => {
  const harness = await mount(page, `${albumPath}&track=genie-track%3A101%3A1010&tab=copyright`);
  await expect(page.getByRole("heading", { name: "함께 만든 앨범", exact: true })).toBeVisible();
  await expect(page.getByLabel("관리할 음악", { exact: true })).toHaveValue("melon-track:100:1000");
  await expect(page.getByRole("article", { name: "한 곡 저작자 정보", exact: true })).toContainText("편곡 참여자");
  await switchTab(page, "심의");
  await expect(page).toHaveURL(/release=melon-release%3A100&track=melon-track%3A100%3A1000&tab=review/);
  await page.goBack();
  await expect(page.getByRole("region", { name: "저작권 등록 정보" })).toBeVisible();
  await expect(page.getByLabel("관리할 음악", { exact: true })).toHaveValue("melon-track:100:1000");
  await page.reload();
  await expect(page.getByRole("article", { name: "한 곡 저작자 정보", exact: true })).toContainText("편곡 참여자");
  expect(harness.errors).toEqual([]);
});

test("same-agency histories stay visible and editing retains the original task ID", async ({ page }) => {
  const harness = await mount(page, albumPath);
  const review = page.getByRole("region", { name: "심의 정보", exact: true });
  await expect(review.getByRole("article")).toHaveCount(2);
  await expect(review.getByRole("link", { name: "온사이드에 심의 신청", exact: true })).toHaveCount(0);
  const pending = review.getByRole("article").filter({ hasText: "심의 미진행" });
  await pending.getByRole("button", { name: "수정", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "심의 내역 수정", exact: true });
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(harness.writes[0]).toMatchObject({ action: "commands", commands: [{ type: "update_task", taskId: "history-1:genie-track:101:1010" }] });
  expect(harness.detail.library.data.tasks.map(task => task.trackId)).toEqual(["melon-track:100:1000", "genie-track:101:1010"]);
  await expect(review.getByRole("article")).toHaveCount(2);
  expect(harness.errors).toEqual([]);
});

test("manual review saves only offered stations and survives reloading", async ({ page }) => {
  const harness = await mount(page, albumPath);
  await page.getByRole("button", { name: "심의 내역 입력", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "심의 내역 입력", exact: true });
  for (const station of ["EBS", "tvN", "JTBC", "G1"]) await expect(dialog.getByRole("checkbox", { name: station, exact: true })).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "MBC", exact: true }).check();
  await dialog.getByLabel("심의일 (선택)", { exact: true }).fill("2026-10-29");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const tasks = harness.detail.library.data.tasks.filter(task => task.completedDate === "2026-10-29");
  expect(tasks.map(task => [task.agency, task.result])).toEqual([["KBS", "eligible"], ["MBC", "eligible"]]);
  await page.reload();
  await expect(page.getByRole("region", { name: "심의 정보", exact: true })).toContainText("MBC");
  expect(harness.errors).toEqual([]);
});

test("editing and repeated refresh keep one album while preserving each source link and recording", async ({ page }) => {
  const harness = await mount(page, albumPath);
  const originalLinks = structuredClone(harness.detail.library.data.releases.map(release => release.links));
  const originalRecordings = harness.detail.library.data.tracks.map(track => track.recordingId);
  await page.getByRole("button", { name: "수정", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "앨범 수정", exact: true });
  await dialog.getByLabel("앨범 제목", { exact: true }).fill("정리한 앨범");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "정리한 앨범", exact: true })).toBeVisible();
  expect(harness.detail.library.data.releases.map(release => release.title)).toEqual(["정리한 앨범", "정리한 앨범"]);
  expect(harness.detail.library.data.releases.map(release => release.links)).toEqual(originalLinks);
  const commands = harness.writes[0].commands as ArchiveCommand[];
  expect(commands).toHaveLength(2); expect(commands[1]).not.toHaveProperty("patch.links");
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "앨범 정보 다시 가져오기", exact: true }).click();
    await expect.poll(() => harness.writes.filter(write => write.action === "refresh-metadata").length).toBe(i + 1);
    await expect(page.getByRole("button", { name: "앨범 정보 다시 가져오기", exact: true })).toBeEnabled();
  }
  await switchTab(page, "저작권 등록");
  await expect(page.getByRole("article", { name: "한 곡 저작자 정보", exact: true })).toContainText("갱신된 작곡가");
  await page.getByRole("button", { name: "앨범 목록", exact: true }).click();
  await expect(page.getByRole("button", { name: /정리한 앨범/ })).toHaveCount(1);
  await expect(page.getByText("앨범 1개", { exact: true })).toBeVisible();
  expect(harness.detail.library.data.tracks.map(track => track.recordingId)).toEqual(originalRecordings);
  expect(harness.detail.library.data.releases).toHaveLength(2); expect(harness.errors).toEqual([]);
});
