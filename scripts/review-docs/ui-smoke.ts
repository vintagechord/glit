/** Browser coverage of the real client with a local fixture API; no production calls. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "@playwright/test";
import { emptyReviewData } from "../../src/lib/review-docs/model";
import { emptyAlbum, emptyTrack } from "../../src/features/review-docs/editor";

async function main() {
  const temporary = await mkdtemp(path.join(tmpdir(), "onside-review-ui-"));
  const out = path.resolve("tmp/review-docs-ui"); await mkdir(out, { recursive: true });
  const source = { id: "source1", kind: "file" as const, name: "기준자료.docx", text: "아티스트: 검증 아티스트\n앨범: 검증 앨범\n곡명: 첫 번째 곡\n가사: 우리 노래를 부르자", warnings: [] };
  const data = { ...emptyReviewData("album", "2026-09-07"), sources: [source], albums: [{ ...emptyAlbum("album1"), artistName: "검증 아티스트", title: "검증 앨범", company: "검증 기획사", sourceIds: [source.id], tracks: [{ ...emptyTrack("track1", 1), title: "첫 번째 곡", lyrics: "우리 노래를 부르자", lyricStatus: "provided" as const, sourceIds: [source.id] }] }] };
  let job = { id: "11111111-1111-4111-8111-111111111111", mode: "album", input_kind: "files", status: "needs_review", operation: "extract", version: 1, application_date: "2026-09-07", data, sources: [{ id: source.id, name: source.name, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }], outputs: [] as { id: string; name: string; size: number }[], has_zip: false, counts: null as null | { albumCount: number; trackCount: number; docxCount: number }, result_version: null as number | null, validation: null as null | { structureChecked: boolean; rendered: boolean }, template_version: null, error_code: null, error_message: null, retryable: false, attempts: 1, extraction_attempts: 1, created_at: "2026-09-07T03:00:00Z", updated_at: "2026-09-07T03:00:00Z", expires_at: "2026-09-14T03:00:00Z" };
  const requests: { method: string; url: string }[] = [];
  const errors: string[] = [];
  let workerReady = true;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const css = await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") });
  await writeFile(path.join(temporary, "style.css"), css.css);
  await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ReviewDocsWorkspace} from './src/features/review-docs/review-docs-workspace'; createRoot(document.getElementById('app')).render(<main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6"><h1 className="text-3xl font-black">심의자료 생성</h1><ReviewDocsWorkspace /></main>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, outfile: path.join(temporary, "app.js"), platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const server = createServer(async (request, response) => {
    const url = request.url || "/";
    if (url.startsWith("/api/")) {
      requests.push({ method: request.method ?? "GET", url });
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      response.setHeader("Content-Type", "application/json");
      if (request.method === "PATCH") {
        assert.equal(body.version, job.version); job = { ...job, data: body.data, version: job.version + 1, status: "needs_review", outputs: [], has_zip: false };
      }
      if (url.endsWith("/generate")) {
        assert.equal(body.version, job.version); job = { ...job, status: "completed", result_version: job.version, has_zip: true, outputs: [{ id: "doc1", name: "곡별가사.docx", size: 1234 }], counts: { albumCount: 1, trackCount: 1, docxCount: 1 }, validation: { structureChecked: true, rendered: false } };
      }
      response.end(JSON.stringify(url.endsWith("/jobs") && request.method === "GET" ? { jobs: [job], workerReady, limits: {} } : { job, duplicate: false })); return;
    }
    if (url === "/app.js" || url === "/style.css") { response.setHeader("Content-Type", url.endsWith(".js") ? "text/javascript" : "text/css"); response.end(await readFile(path.join(temporary, url.slice(1)))); return; }
    response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture port");
    browser = await chromium.launch({ headless: true, channel: process.env.REVIEW_UI_BROWSER_CHANNEL || "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole("tab", { name: "멜론·지니 URL · 음반" }).click();
    await page.getByLabel("멜론·지니 URL (한 줄에 하나, 최대 8개)").fill("https://www.melon.com/album/detail.htm?albumId=1\nhttps://www.melon.com/album/detail.htm?albumId=1");
    await page.getByRole("button", { name: "업로드·분석 시작" }).click();
    await page.getByRole("alert").filter({ hasText: "중복 URL" }).waitFor();
    assert.equal(requests.filter((request) => request.method === "POST").length, 0);
    await page.getByRole("button", { name: /음반 자료 · 확인·수정 필요/ }).click();
    const title = page.getByLabel("앨범명", { exact: true });
    await title.fill("관리자 수정 앨범");
    assert.equal(await page.getByRole("button", { name: "전체 심의자료 생성", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "상태 새로고침" }).click();
    assert.equal(await title.inputValue(), "관리자 수정 앨범");
    await page.getByRole("button", { name: "수정 내용 저장" }).click();
    await page.getByRole("status").filter({ hasText: "수정 내용을 저장했습니다" }).waitFor();
    assert.equal(job.version, 2); assert.equal(job.data.albums[0].title, "관리자 수정 앨범");
    await page.getByRole("button", { name: "전체 심의자료 생성", exact: true }).click();
    await page.getByRole("link", { name: "전체 ZIP 다운로드" }).waitFor();
    assert.equal(job.result_version, 2);
    await page.getByText("Word/PDF 렌더링 육안 검수는 별도로 필요합니다.", { exact: false }).waitFor();
    await page.screenshot({ path: path.join(out, "desktop.png"), fullPage: true });
    await page.screenshot({ path: path.join(out, "desktop-viewport.png") });
    await title.fill("다음 버전");
    assert.equal(await page.getByRole("link", { name: "전체 ZIP 다운로드" }).count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, "mobile.png"), fullPage: true });
    await page.screenshot({ path: path.join(out, "mobile-viewport.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile horizontal overflow");
    await page.getByRole("button", { name: "수정 내용 저장" }).click();
    await page.getByRole("status").filter({ hasText: "수정 내용을 저장했습니다" }).waitFor();
    workerReady = false; await page.reload();
    await page.getByText("문서 처리 작업자가 연결되어 있지 않습니다.", { exact: false }).waitFor();
    assert.equal(await page.getByRole("button", { name: "업로드·분석 시작" }).isDisabled(), true);
    workerReady = true; job = { ...job, status: "needs_review", data: { ...job.data, sources: [{ ...source, text: "" }], issues: [{ id: "source:source1", code: "EXTRACTION_FAILED", severity: "error", sourceId: "source1", message: "파일 분석 실패" }] }, extraction_attempts: 1 };
    await page.reload();
    await page.getByRole("button", { name: /음반 자료 · 확인·수정 필요/ }).click();
    assert.equal(await page.getByLabel("원문과 비교해 수정·확인했습니다", { exact: true }).count(), 0);
    await page.getByText("원본 처리 실패는 확인만으로 해제할 수 없습니다.", { exact: false }).waitFor();
    const retry = page.getByRole("button", { name: "실패한 원본 다시 분석 (1개)" });
    await retry.click();
    assert.equal(requests.at(-1)?.url.endsWith("/retry"), true);
    job.extraction_attempts = 3;
    await page.reload();
    await page.getByRole("button", { name: /음반 자료 · 확인·수정 필요/ }).click();
    assert.equal(await retry.isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log("PASS: tabs, duplicate URL, fixture history, dirty draft preservation, save/version, generate/download, stale result protection, worker offline, failed-source retry/cap/non-confirmable errors, mobile overflow; no page errors.");
    console.log(`Screenshots: ${out}/desktop.png, ${out}/mobile.png (fixture API, no production calls).`);
  } finally { await browser?.close(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(temporary, { recursive: true, force: true }); }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
