import { expect, test } from "@playwright/test";
import { createArchiveData, applyArchiveCommand, type ArchiveCommand, type ArchiveLibrary } from "../../src/lib/music-archive/model";
import { archiveClientDocument } from "./support/music-archive-mount";

for (const failRefresh of [false, true]) test(`administrator adds a missing album and tracks${failRefresh ? " and recovers a failed refresh without another save" : ""}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const html = await archiveClientDocument("./src/features/music-archive/admin-client", "MusicArchiveAdminClient");
  let library: ArchiveLibrary = { id: "aaaaaaaa-1111-4111-8111-111111111111", owner_id: "bbbbbbbb-1111-4111-8111-111111111111", version: 1, data: createArchiveData("관리할 아티스트"), archived_at: null, created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z" };
  const searches: string[] = []; const writes: Record<string, unknown>[] = []; const errors: string[] = [];
  let failNextDetailRefresh = false;
  const coverUrl = "https://is1-ssl.mzstatic.com/image/thumb/test/300x300bb.jpg";
  page.on("pageerror", error => errors.push(error.message));
  await page.context().route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (request.url() === coverUrl) { await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#047857"/></svg>' }); return; }
    if (url.pathname === "/admin/music") { await route.fulfill({ contentType: "text/html", body: html }); return; }
    if (url.pathname === "/api/music-archive") {
      if (request.method() === "POST") {
        const body = request.postDataJSON(); writes.push(body);
        expect(body.action).toBe("admin-commands"); expect(body.version).toBe(library.version);
        let data = library.data;
        for (const command of body.commands as ArchiveCommand[]) data = applyArchiveCommand(data, command);
        library = { ...library, data, version: library.version + 1 };
        if (failRefresh && writes.length === 1) failNextDetailRefresh = true;
        await route.fulfill({ json: { library } }); return;
      }
      if (url.searchParams.get("action") === "admin-library") {
        if (failNextDetailRefresh) { failNextDetailRefresh = false; await route.fulfill({ status: 503, json: { error: "일시적인 새로고침 오류" } }); return; }
        await route.fulfill({ json: { library, jobs: [], evidence: [], events: [], reviews: [], onsideReviews: [] } }); return;
      }
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
  await page.getByLabel("자켓 이미지 URL (선택)", { exact: true }).fill(coverUrl);
  await page.getByLabel("트랙 제목 (선택)", { exact: true }).fill("첫 번째 트랙\n두 번째 트랙");
  await page.getByRole("button", { name: "앨범 등록", exact: true }).click();
  await expect(page.getByRole("region", { name: "회원 앨범 관리" })).toContainText("누락된 싱글");
  await expect(page.getByRole("button", { name: "앨범 등록", exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "누락된 싱글 앨범 커버", exact: true })).toHaveAttribute("src", coverUrl);
  if (failRefresh) {
    await expect(page.getByText("저장은 완료했지만 최신 정보를 다시 불러오지 못했습니다.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "저장 정보 다시 불러오기", exact: true }).click();
    await expect(page.getByText("저장은 완료했지만 최신 정보를 다시 불러오지 못했습니다.", { exact: true })).toHaveCount(0);
    expect(writes).toHaveLength(1);
    expect(library.data.releases).toHaveLength(1);
  }
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

test("administrator refresh preserves the directory search, filters, page and unsent search draft", async ({ page }) => {
  const html = await archiveClientDocument("./src/features/music-archive/admin-client", "MusicArchiveAdminClient");
  const queries: URLSearchParams[] = [];
  await page.context().route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/admin/music") return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname !== "/api/music-archive") return route.fulfill({ status: 404 });
    queries.push(url.searchParams);
    const pageNumber = Number(url.searchParams.get("page") ?? 0);
    return route.fulfill({ json: { libraries: [], total: 125, nextPage: pageNumber < 2 ? pageNumber + 1 : null, jobs: [], providers: [], guides: [] } });
  });
  await page.goto("/admin/music");
  const search = page.getByLabel("회원·아티스트 검색", { exact: true });
  await search.fill("김음악");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await page.getByLabel("아카이브", { exact: true }).selectOption("all");
  await page.getByLabel("앨범·트랙", { exact: true }).selectOption("no_albums");
  await page.getByLabel("정렬", { exact: true }).selectOption("artist");
  await page.getByLabel("페이지당 표시", { exact: true }).selectOption("50");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByText("검색 결과 125건 · 2 / 3페이지", { exact: true })).toBeVisible();
  await search.fill("아직 제출하지 않은 검색어");
  const requestCount = queries.length;
  await page.getByRole("button", { name: "상태 새로고침", exact: true }).click();
  await expect.poll(() => queries.length).toBeGreaterThanOrEqual(requestCount + 2);
  await expect(page.getByText("검색 결과 125건 · 2 / 3페이지", { exact: true })).toBeVisible();
  await expect(search).toHaveValue("아직 제출하지 않은 검색어");
  await expect(page.getByLabel("아카이브", { exact: true })).toHaveValue("all");
  await expect(page.getByLabel("앨범·트랙", { exact: true })).toHaveValue("no_albums");
  await expect(page.getByLabel("정렬", { exact: true })).toHaveValue("artist");
  await expect(page.getByLabel("페이지당 표시", { exact: true })).toHaveValue("50");
  expect(Object.fromEntries(queries.at(-1)!)).toEqual({ action: "admin", q: "김음악", page: "1", state: "all", content: "no_albums", sort: "artist", pageSize: "50" });
});
