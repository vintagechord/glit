import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { agencyGuides, type AgencyGuide } from "../../src/lib/music-archive/guides";
import { getMusicProviderStatuses } from "../../src/lib/music-archive/providers";
import { createArchiveData } from "../../src/lib/music-archive/model";
import type { AdminLibraryDetail, AdminLibrarySummary } from "../../src/features/music-archive/admin-library-inspector";

// Real production client and stylesheet, with explicit local API fixtures.
// These browser checks do not assert live authentication, provider access or DB writes.
let html = "";
test.beforeAll(async () => {
  const root = process.cwd();
  const [bundle, styles] = await Promise.all([
    build({ absWorkingDir: root, stdin: { contents: 'import React from "react";import { createRoot } from "react-dom/client";import { MusicArchiveAdminClient } from "./src/features/music-archive/admin-client";createRoot(document.getElementById("app")).render(<MusicArchiveAdminClient />);', loader: "tsx", resolveDir: root }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' } }),
    readFile(path.join(root, "src/app/globals.css"), "utf8").then(source => postcss([tailwind()]).process(source, { from: path.join(root, "src/app/globals.css") })),
  ]);
  html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles.css}</style></head><body><main style="max-width:1152px;margin:auto;padding:16px"><h1>음악 관리 운영</h1><div id="app"></div></main><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

function libraryFixture(): { summary: AdminLibrarySummary; detail: AdminLibraryDetail } {
  const timestamp = "2026-09-09T00:00:00Z";
  const data = createArchiveData("빈티지코드", "artist-1");
  const source = { provider: "apple" as const, externalId: "release-123", checkedAt: timestamp };
  data.connections.push({ provider: "apple", externalArtistId: "1259084205", url: "https://music.apple.com/kr/artist/vintage-chord/1259084205", confirmed: true, status: "automatic", checkedAt: timestamp });
  data.releases.push({ id: "release-1", title: "테스트 앨범", type: "album", participation: "primary", links: [], source, excluded: false, userEdited: true });
  data.tracks.push({ id: "track-1", releaseId: "release-1", title: "테스트 트랙", discNumber: 1, trackNumber: 1, managed: true, links: [], source: { ...source, externalId: "track-123" }, excluded: false, userEdited: false });
  data.tasks.push({ id: "task-1", trackId: "track-1", kind: "copyright_work", agency: "KOMCA", status: "completed", result: "information_found", source: "user_evidence", queryStatus: "unsupported", participant: "빈티지코드", role: "작곡", referenceNumber: "REG-123", memo: "운영자가 확인할 기존 메모", attachmentIds: ["file-1"] });
  data.conflicts.push({ id: "conflict-1", entityType: "release", entityId: "release-1", field: "title", current: "테스트 앨범", incoming: "새 앨범 이름", source, createdAt: timestamp });
  const summary: AdminLibrarySummary = { id: "11111111-1111-4111-8111-111111111111", owner_id: "22222222-2222-4222-8222-222222222222", version: 7, artist_name: "빈티지코드", release_count: 1, track_count: 1, archived_at: null, updated_at: timestamp };
  return {
    summary,
    detail: {
      library: { id: summary.id, owner_id: summary.owner_id, version: summary.version, data, archived_at: null, created_at: timestamp, updated_at: timestamp },
      jobs: [{ id: "job-library", library_id: summary.id, provider: "apple", external_artist_id: "1259084205", status: "partial", counts: { releases: 1, tracks: 1 }, checked_at: timestamp, cursor: { scopeNote: "조회 가능 범위 중 일부 수집" }, error_code: "temporary_error", error_message: "재시도할 제공처 오류" }],
      evidence: [{ id: "file-1", task_id: "task-1", file_name: "등록 증빙.pdf", size_bytes: 2048, created_at: timestamp }],
      events: [{ id: "event-1", action: "sync_page", before_version: 6, after_version: 7, created_at: timestamp, actor_id: summary.owner_id, details: { provider: "apple", imported: 1 } }],
      reviews: [],
    },
  };
}

for (const width of [1280, 390]) test(`admin inspects member source, task and audit records at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const fixture = libraryFixture();
  const queries: URL[] = [];
  const mutations: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://music-archive.test/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/music-archive") return route.fulfill({ contentType: "text/html", body: html });
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      mutations.push(body);
      if (body.action === "admin-resolve-conflict") {
        fixture.detail.library.data.conflicts[0].resolved = body.resolution as "keep" | "accept";
        if (body.resolution === "accept") fixture.detail.library.data.releases[0].title = "새 앨범 이름";
        fixture.detail.library.version++;
        fixture.detail.events.unshift({ id: "event-2", action: "admin_resolve_conflict", before_version: 7, after_version: 8, created_at: "2026-09-09T00:01:00Z", details: { conflictId: body.conflictId, resolution: body.resolution } });
        return route.fulfill({ json: { library: fixture.detail.library } });
      }
      fixture.detail.jobs[0].status = "queued";
      return route.fulfill({ status: 202, json: { job: fixture.detail.jobs[0] } });
    }
    queries.push(url);
    if (url.searchParams.get("action") === "admin-library") return route.fulfill({ json: fixture.detail });
    return route.fulfill({ json: { guides: agencyGuides, providers: getMusicProviderStatuses({}), jobs: [], libraries: [fixture.summary], total: 1, nextPage: null } });
  });
  await page.goto("http://music-archive.test/admin/music");
  await page.getByLabel("아티스트 이름 검색").fill("빈티지코드");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect.poll(() => queries.some(url => url.searchParams.get("q") === "빈티지코드")).toBe(true);
  await page.getByRole("button", { name: "빈티지코드 운영 정보 보기" }).click();
  const dialog = page.getByRole("dialog", { name: "빈티지코드 운영 정보" });
  await expect(dialog).toBeVisible();
  expect(queries.some(url => url.searchParams.get("action") === "admin-library" && url.searchParams.get("libraryId") === fixture.summary.id)).toBe(true);
  await expect(dialog.getByRole("heading", { name: "아티스트 연결" })).toBeVisible();
  await expect(dialog.getByText("아티스트 ID: 1259084205", { exact: true })).toBeVisible();
  await expect(dialog.getByText("출처: Apple Music 한국 카탈로그", { exact: true })).toHaveCount(2);
  await expect(dialog.getByText("사용자 수정 포함", { exact: true })).toBeVisible();
  await dialog.getByLabel("정보 종류").selectOption("트랙");
  await expect(dialog.getByText("출처: Apple Music 한국 카탈로그", { exact: true })).toHaveCount(1);
  await dialog.getByRole("button", { name: "저장 지점부터 재시도" }).click();
  await expect(dialog.getByText("저장된 수집 범위부터 재시도를 요청했습니다.", { exact: true })).toBeVisible();
  expect(mutations).toEqual([{ action: "admin-retry", jobId: "job-library" }]);
  const resolution = width === 1280 ? "keep" : "accept";
  await dialog.getByRole("button", { name: resolution === "keep" ? "기존값 유지" : "수집값 반영", exact: true }).click();
  await expect(dialog.getByText(resolution === "keep" ? "기존 정보를 유지했습니다." : "수집된 변경 정보를 반영했습니다.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "기존값 유지", exact: true })).toHaveCount(0);
  expect(mutations[1]).toEqual({ action: "admin-resolve-conflict", libraryId: fixture.summary.id, version: 7, conflictId: "conflict-1", resolution });
  await dialog.getByRole("button", { name: "업무 기록", exact: true }).click();
  await expect(dialog.getByText("사용자 증빙 첨부", { exact: true })).toBeVisible();
  await expect(dialog.getByText("자동 연동 미지원", { exact: true })).toBeVisible();
  await expect(dialog.getByText("등록 증빙.pdf", { exact: false })).toBeVisible();
  await dialog.getByLabel("업무 기록 필터").selectOption("processing");
  await expect(dialog.getByText("선택한 조건의 업무 기록이 없습니다.", { exact: true })).toBeVisible();
  await dialog.getByLabel("업무 기록 필터").selectOption("completed");
  await expect(dialog.getByText("REG-123", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "변경 이력", exact: true }).click();
  await expect(dialog.getByText("sync_page", { exact: true })).toBeVisible();
  await expect(dialog.getByText("admin_resolve_conflict", { exact: true })).toBeVisible();
  await dialog.getByText("변경 상세", { exact: true }).last().click();
  await expect(dialog.locator("pre").last()).toContainText('"provider": "apple"');
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`admin-library-${width}.png`), fullPage: true });
  await dialog.getByRole("button", { name: "닫기" }).click();
  await expect(dialog).toHaveCount(0);
});

test("admin client does not render library details when access is refused", async ({ page }) => {
  await page.route("http://music-archive.test/**", async route => new URL(route.request().url()).pathname === "/api/music-archive"
    ? route.fulfill({ status: 403, json: { error: "관리자만 접근할 수 있습니다." } })
    : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://music-archive.test/admin/music");
  await expect(page.getByRole("alert")).toHaveText("관리자만 접근할 수 있습니다.");
  await expect(page.getByRole("heading", { name: "회원 음악 아카이브" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const width of [1280, 390]) test(`admin guide save and durable retry UI at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  let guides: AgencyGuide[] = structuredClone(agencyGuides);
  let status = "partial";
  const mutations: Array<Record<string, unknown>> = [];
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.route("http://music-archive.test/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/music-archive") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        mutations.push(body);
        if (body.action === "admin-guide") {
          const guide = body.guide as AgencyGuide;
          guides = guides.map(item => item.id === guide.id ? { ...item, ...guide } : item);
          return route.fulfill({ json: { guides } });
        }
        status = "queued";
        return route.fulfill({ status: 202, json: { job: { id: "job-1", status } } });
      }
      return route.fulfill({ json: { guides, providers: getMusicProviderStatuses({}), jobs: [{ id: "job-1", library_id: "library-1", external_artist_id: "artist-mbid", provider: "musicbrainz", status, cursor: { scopeNote: "MusicBrainz 조회 가능 범위 중 일부 저장. 다음 페이지에서 계속합니다." }, counts: { releases: 12, tracks: 30, managedTracks: 20, steps: 3 }, error_code: status === "partial" ? "temporary_error" : null, error_message: "제공처의 일시 오류", attempts: 3, available_at: "2026-09-08T00:00:00Z", checked_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z" }] } });
    }
    return route.fulfill({ contentType: "text/html", body: html });
  });
  await page.goto("http://music-archive.test/admin/music");
  await expect(page.getByRole("heading", { name: "수집 작업·오류" })).toBeVisible();
  await expect(page.getByText("불러온 발매작 12개", { exact: false })).toBeVisible();
  await page.getByLabel("표시할 작업").selectOption("all");
  await page.getByRole("button", { name: "저장 지점부터 재시도" }).click();
  await expect(page.getByText("불러오기 준비 중", { exact: true })).toBeVisible();
  expect(mutations[0]).toEqual({ action: "admin-retry", jobId: "job-1" });
  await page.getByLabel("수정할 안내").selectOption("komca");
  await page.getByLabel("안내 제목", { exact: true }).fill("KOMCA · 확인된 공식 절차");
  await page.getByLabel(/^준비 정보·자료/).fill("대상 저작물과 저작자 확인\n기존 작품번호 확인");
  await page.getByLabel("공식 자료 마지막 확인일").fill("2026-09-08");
  await page.getByLabel("회원 화면에 이 안내 표시").uncheck();
  await page.getByRole("button", { name: "공식 안내 저장" }).click();
  await expect(page.getByText("공식 안내를 저장했습니다.", { exact: false })).toBeVisible();
  const saved = mutations.find(body => body.action === "admin-guide")?.guide as AgencyGuide;
  expect(saved.visible).toBe(false);
  expect(saved.preparation).toEqual(["대상 저작물과 저작자 확인", "기존 작품번호 확인"]);
  expect(saved.sources).toEqual(agencyGuides.find(guide => guide.id === "komca")?.sources);
  await page.reload();
  await expect(page.getByLabel("안내 제목", { exact: true })).toHaveValue("KOMCA · 확인된 공식 절차");
  await expect(page.getByLabel("회원 화면에 이 안내 표시")).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(browserErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`admin-music-${width}.png`), fullPage: true });
});
