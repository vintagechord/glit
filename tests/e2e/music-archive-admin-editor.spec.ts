import { expect, test } from "@playwright/test";
import { createArchiveData, applyArchiveCommand, type ArchiveCommand, type ArchiveLibrary } from "../../src/lib/music-archive/model";
import { archiveClientDocument } from "./support/music-archive-mount";

test("administrator searches members and atomically adds a missing album and tracks", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const html = await archiveClientDocument("./src/features/music-archive/admin-client", "MusicArchiveAdminClient");
  let library: ArchiveLibrary = { id: "aaaaaaaa-1111-4111-8111-111111111111", owner_id: "bbbbbbbb-1111-4111-8111-111111111111", version: 1, data: createArchiveData("관리할 아티스트"), archived_at: null, created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z" };
  const searches: string[] = []; const writes: Record<string, unknown>[] = []; const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.context().route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === "/admin/music") { await route.fulfill({ contentType: "text/html", body: html }); return; }
    if (url.pathname === "/api/music-archive") {
      if (request.method() === "POST") {
        const body = request.postDataJSON(); writes.push(body);
        expect(body.action).toBe("admin-commands"); expect(body.version).toBe(library.version);
        let data = library.data;
        for (const command of body.commands as ArchiveCommand[]) data = applyArchiveCommand(data, command);
        library = { ...library, data, version: library.version + 1 };
        await route.fulfill({ json: { library } }); return;
      }
      if (url.searchParams.get("action") === "admin-library") { await route.fulfill({ json: { library, jobs: [], evidence: [], events: [], reviews: [], onsideReviews: [] } }); return; }
      searches.push(url.search);
      await route.fulfill({ json: { libraries: [{ id: library.id, owner_id: library.owner_id, artist_name: library.data.artist.name, member_name: "김음악", member_company: "레코드 회사", release_count: library.data.releases.length, track_count: library.data.tracks.length, updated_at: library.updated_at }], total: 1, nextPage: null, jobs: [], providers: [], guides: [] } }); return;
    }
    await route.fulfill({ status: 404, body: "Unexpected network request" });
  });
  await page.goto("/admin/music");
  await expect(page.getByRole("table")).toContainText("김음악");
  await page.getByLabel("회원·아티스트 검색", { exact: true }).fill("김음악");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect.poll(() => searches.some(query => new URLSearchParams(query).get("q") === "김음악")).toBe(true);
  await page.getByLabel("앨범·트랙", { exact: true }).selectOption("no_albums");
  await expect.poll(() => searches.some(query => new URLSearchParams(query).get("content") === "no_albums")).toBe(true);
  await page.getByRole("button", { name: "관리할 아티스트 운영 정보 보기" }).click();
  await page.getByRole("button", { name: "앨범 직접 추가", exact: true }).click();
  await page.getByLabel("앨범명", { exact: true }).fill("누락된 싱글");
  await page.getByLabel("앨범 유형", { exact: true }).selectOption("single");
  await page.getByLabel("트랙 제목 (선택)", { exact: true }).fill("첫 번째 트랙\n두 번째 트랙");
  await page.getByRole("button", { name: "앨범 등록", exact: true }).click();
  await expect(page.getByRole("region", { name: "회원 앨범 관리" })).toContainText("누락된 싱글");
  expect(writes[0].commands).toHaveLength(3);
  expect(library.data.releases[0].type).toBe("single"); expect(library.data.tracks).toHaveLength(2);
  await page.getByRole("button", { name: "트랙 추가", exact: true }).click();
  await page.getByLabel("추가할 트랙 제목", { exact: true }).fill("보너스 트랙");
  await page.getByRole("button", { name: "트랙 추가", exact: true }).first().click();
  await expect.poll(() => library.data.tracks.length).toBe(3);
  expect(library.data.tracks[2].trackNumber).toBe(3);
  await page.screenshot({ path: testInfo.outputPath("admin-album-directory.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
