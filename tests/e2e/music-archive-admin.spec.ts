import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { agencyGuides, type AgencyGuide } from "../../src/lib/music-archive/guides";
import { getMusicProviderStatuses } from "../../src/lib/music-archive/providers";

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
