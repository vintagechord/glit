import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import type { publicReviewJob } from "../../src/lib/review-docs/jobs-types";
import { normalizedReviewFixture } from "../fixtures/review-docs/normalized";

type Job = ReturnType<typeof publicReviewJob>;
const apiPath = "/api/admin/review-docs/jobs";
let server: Server;
let origin: string;

function fixtureJob(): Job {
  const data = normalizedReviewFixture();
  return {
    id: "11111111-1111-4111-8111-111111111111", mode: "album", input_kind: "files", status: "needs_review", operation: "extract", version: 1,
    application_date: data.applicationDate, data,
    sources: data.sources.map(({ id, name }) => ({ id, name, mime: undefined, size: undefined, url: undefined })),
    outputs: [], has_zip: false, counts: null, result_version: null, validation: null,
    template_version: null, error_code: null, error_message: null, retryable: false, attempts: 1, extraction_attempts: 1,
    created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z", expires_at: "2099-01-01T00:00:00Z",
  };
}

test.beforeAll(async () => {
  // Render the real client against a fixture API, without production sessions or calls.
  const bundle = await build({
    stdin: { contents: `import {createRoot} from 'react-dom/client'; import {ReviewDocsWorkspace} from './src/features/review-docs/review-docs-workspace'; const root = createRoot(document.getElementById('app')); root.render(<ReviewDocsWorkspace />); window.addEventListener('review-fixture-unmount', () => root.unmount());`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  });
  server = createServer((request, response) => {
    if (request.url === "/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); return; }
    if (request.url?.startsWith("/api/")) { response.writeHead(500); response.end("Unexpected unmocked API request"); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture port unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => { await new Promise<void>((resolve) => server?.close(() => resolve())); });

test("an offline worker reconnects automatically without reloading or losing entered URLs", async ({ page }) => {
  let workerReady = false;
  await page.route(`**${apiPath}`, (route) => route.fulfill({ json: { jobs: [], workerReady } }));
  await page.clock.install();
  await page.goto(origin);
  const start = page.getByRole("button", { name: "업로드·분석 시작" });
  await expect(page.getByRole("status")).toContainText("문서 처리 작업자가 연결되어 있지 않습니다.");
  await expect(start).toBeDisabled();
  await page.getByRole("tab", { name: "멜론·지니 URL · 음반" }).click();
  const urls = page.getByLabel("멜론·지니 URL (한 줄에 하나, 최대 8개)");
  await urls.fill("https://www.melon.com/album/detail.htm?albumId=123456");
  workerReady = true;
  await page.clock.runFor(15_000);
  await expect(start).toBeEnabled();
  await expect(page.getByText("문서 처리 작업자가 연결되어 있지 않습니다.", { exact: false })).toHaveCount(0);
  await expect(urls).toHaveValue("https://www.melon.com/album/detail.htm?albumId=123456");
});

test("unknown connectivity disables worker actions, recovers on focus, and preserves unsaved edits", async ({ page }) => {
  const job = fixtureJob();
  let failed = false;
  let historyReads = 0;
  await page.route(`**${apiPath}/**`, (route) => route.fulfill({ json: { job } }));
  await page.route(`**${apiPath}`, (route) => {
    historyReads++;
    return route.fulfill(failed ? { status: 503, json: { error: "작업 저장소에 연결할 수 없습니다.", code: "DATABASE_UNAVAILABLE" } } : { json: { jobs: [job], workerReady: true } });
  });
  await page.clock.install();
  await page.goto(origin);
  await page.getByRole("button", { name: /음반 자료 · 확인·수정 필요/ }).click();
  const title = page.getByLabel("앨범명", { exact: true });
  await title.fill("저장 전 관리자 수정");
  failed = true;
  await page.clock.runFor(15_000);
  await expect(page.getByRole("alert")).toHaveText("작업 저장소에 연결할 수 없습니다.");
  await expect(page.getByText("문서 처리 작업자가 연결되어 있지 않습니다.", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "누락 번역 요청" })).toBeDisabled();
  await expect(title).toHaveValue("저장 전 관리자 수정");
  await page.getByRole("button", { name: "저장 전으로 되돌리기" }).click();
  await expect(page.getByRole("button", { name: "누락 번역 요청" })).toBeDisabled();
  const readsBeforeHidden = historyReads;
  await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, value: true }));
  await page.clock.runFor(45_000);
  expect(historyReads).toBe(readsBeforeHidden);
  failed = false;
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); window.dispatchEvent(new Event("focus")); });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "누락 번역 요청" })).toBeEnabled();
});

test("history polling never overlaps and a delayed response cannot undo a newly saved job summary", async ({ page }) => {
  let job = fixtureJob();
  let reads = 0;
  let hold = false;
  let release: (() => void) | undefined;
  await page.route(`**${apiPath}/**`, async (route) => {
    if (route.request().method() === "PATCH") job = { ...job, version: job.version + 1, data: route.request().postDataJSON().data };
    await route.fulfill({ json: { job } });
  });
  await page.route(`**${apiPath}`, async (route) => {
    reads++;
    const snapshot = structuredClone(job);
    if (hold) await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: { jobs: [snapshot], workerReady: true } });
  });
  await page.clock.install();
  await page.goto(origin);
  await page.getByRole("button", { name: /음반 자료 · 확인·수정 필요/ }).click();
  hold = true;
  const history = page.getByRole("complementary", { name: "최근 생성 작업 이력" });
  await history.getByRole("button", { name: "새로고침" }).click();
  await expect.poll(() => reads).toBe(2);
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new Event("focus")); });
  await page.clock.runFor(45_000);
  await history.getByRole("button", { name: "새로고침" }).click();
  expect(reads).toBe(2);
  await page.getByLabel("앨범명", { exact: true }).fill("저장된 새 버전");
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(history).toContainText("v2");
  const historyResponse = page.waitForResponse((response) => response.url().endsWith(apiPath));
  hold = false; release?.();
  await (await historyResponse).finished();
  await page.clock.runFor(16);
  await expect(page.getByLabel("앨범명", { exact: true })).toHaveValue("저장된 새 버전");
  await expect(history).toContainText("v2");
});

test("leaving the workspace aborts its pending history request and stops polling", async ({ page }) => {
  let reads = 0;
  let release: (() => void) | undefined;
  await page.route(`**${apiPath}`, async (route) => {
    reads++;
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: { jobs: [], workerReady: true } });
  });
  await page.clock.install();
  await page.goto(origin);
  await expect.poll(() => reads).toBe(1);
  await expect(page.getByRole("button", { name: "업로드·분석 시작" })).toBeDisabled();
  const aborted = page.waitForEvent("requestfailed", (request) => request.url().endsWith(apiPath));
  await page.evaluate(() => window.dispatchEvent(new Event("review-fixture-unmount")));
  release?.();
  await aborted;
  await page.clock.runFor(45_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(reads).toBe(1);
  await expect(page.locator("#app")).toBeEmpty();
});
