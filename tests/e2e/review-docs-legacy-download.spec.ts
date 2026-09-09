import { expect, test, type Download, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import PizZip from "pizzip";
import { generateReviewDocuments } from "../../src/lib/admin/review-docs";
import { normalizedReviewFixture } from "../fixtures/review-docs/normalized";

const origin = "http://review-docs-download.test";
const submissionId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const melonUrl = "https://www.melon.com/album/detail.htm?albumId=13780811";
const genieUrl = "https://www.genie.co.kr/detail/albumInfo?axnm=87816941";
const filename = "심의자료_가을의 노래.zip";
const translationError = "외국어 가사 번역을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.";
let html: string;
let zip: Buffer;

// The actual production controls consume a local fixture API. This exercises
// browser downloads and errors, without live provider/authentication requests.
test.beforeAll(async () => {
  const fixture = normalizedReviewFixture();
  fixture.albums[0].tracks[0].lyrics = "I love you (번역 : 나는 너를 사랑해)\n오늘도 너를 기다려";
  const [bundle, documents] = await Promise.all([
    build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';
          import {MelonReviewDocsDownloadForm, ReviewDocsSingleDownloadButton, ReviewDocsSelectionProvider, ReviewDocsRowCheckbox, ReviewDocsBulkToolbar} from './src/components/admin/review-docs-download';
          createRoot(document.getElementById('app')).render(<main>
            <section aria-label="관리자 링크 생성"><MelonReviewDocsDownloadForm /></section>
            <section aria-label="발매 음반 상세"><ReviewDocsSingleDownloadButton id="${submissionId}" /></section>
            <section aria-label="발매 음반 목록"><ReviewDocsSelectionProvider ids={['${submissionId}', '${otherId}']}>
              <ReviewDocsRowCheckbox id="${submissionId}" label="첫 번째 음반" />
              <ReviewDocsRowCheckbox id="${otherId}" label="두 번째 음반" />
              <ReviewDocsBulkToolbar />
            </ReviewDocsSelectionProvider></section>
          </main>);`,
        loader: "tsx",
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
    }),
    generateReviewDocuments(fixture),
  ]);
  zip = documents.zip;
  html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="app"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

type Flow = {
  name: string;
  region: string;
  button: string;
  endpoint: string;
  method: string;
  body: unknown;
  prepare: (page: Page) => Promise<void>;
  verifyInput: (page: Page) => Promise<void>;
};

const flows: Flow[] = [
  {
    name: "administrator Melon and Genie links",
    region: "관리자 링크 생성",
    button: "전체 ZIP 다운로드",
    endpoint: "/api/admin/review-docs/melon",
    method: "POST",
    body: { genieUrls: [genieUrl], melonUrls: [melonUrl] },
    prepare: async (page) => {
      await page.getByLabel("지니 링크 · 우선").fill(`${genieUrl}\n${genieUrl}`);
      await page.getByLabel("멜론 링크 · 보완").fill(melonUrl);
    },
    verifyInput: async (page) => {
      await expect(page.getByLabel("지니 링크 · 우선")).toHaveValue(`${genieUrl}\n${genieUrl}`);
      await expect(page.getByLabel("멜론 링크 · 보완")).toHaveValue(melonUrl);
    },
  },
  {
    name: "released album detail",
    region: "발매 음반 상세",
    button: "DOCX ZIP 다운로드",
    endpoint: `/api/admin/submissions/${submissionId}/review-docs`,
    method: "GET",
    body: null,
    prepare: async () => {},
    verifyInput: async () => {},
  },
  {
    name: "selected released album list",
    region: "발매 음반 목록",
    button: "선택 ZIP 다운로드",
    endpoint: "/api/admin/submissions/review-docs",
    method: "POST",
    body: { ids: [submissionId] },
    prepare: async (page) => {
      await page.getByLabel("첫 번째 음반 심의자료 다운로드 선택").check();
    },
    verifyInput: async (page) => {
      await expect(page.getByLabel("첫 번째 음반 심의자료 다운로드 선택")).toBeChecked();
      await expect(page.getByLabel("두 번째 음반 심의자료 다운로드 선택")).not.toBeChecked();
    },
  },
];

const zipResponse = () => ({
  status: 200,
  headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="review-docs.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  },
  body: zip,
});

async function verifyDownload(download: Download) {
  expect(download.suggestedFilename()).toBe(filename);
  expect(await download.failure()).toBeNull();
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const downloaded = await readFile(downloadedPath!);
  expect(downloaded.equals(zip)).toBe(true);
  const files = Object.values(new PizZip(downloaded, { checkCRC32: true }).files).filter((file) => !file.dir);
  expect(files).toHaveLength(9);
  expect(files.every((file) => file.name.endsWith(".docx"))).toBe(true);
}

for (const flow of flows) {
  test(`${flow.name} downloads the ZIP with its Korean filename and correct request`, async ({ page }) => {
    const requests: Array<{ method: string; body: unknown }> = [];
    let release: (() => void) | undefined;
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (!pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: html });
      expect(pathname).toBe(flow.endpoint);
      requests.push({ method: request.method(), body: request.postDataJSON() });
      await new Promise<void>((resolve) => { release = resolve; });
      return route.fulfill(zipResponse());
    });
    await page.goto(origin);
    await flow.prepare(page);
    const region = page.getByRole("region", { name: flow.region });
    await region.getByRole("button", { name: flow.button, exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(region.getByRole("button", { name: "생성 중", exact: true })).toBeDisabled();
    expect(requests).toEqual([{ method: flow.method, body: flow.body }]);
    const pendingDownload = page.waitForEvent("download");
    release!();
    await verifyDownload(await pendingDownload);
    await expect(region.getByRole("button", { name: flow.button, exact: true })).toBeEnabled();
    await expect(region.getByRole("alert")).toHaveCount(0);
  });

  test(`${flow.name} shows translation failure without downloading and can retry`, async ({ page }) => {
    const downloads: Download[] = [];
    let attempts = 0;
    page.on("download", (download) => downloads.push(download));
    await page.route(`${origin}/**`, async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: html });
      expect(pathname).toBe(flow.endpoint);
      attempts++;
      return route.fulfill(attempts === 1
        ? { status: 503, json: { error: translationError } }
        : zipResponse());
    });
    await page.goto(origin);
    await flow.prepare(page);
    const region = page.getByRole("region", { name: flow.region });
    const button = region.getByRole("button", { name: flow.button, exact: true });
    await button.click();
    await expect(region.getByRole("alert")).toHaveText(translationError);
    await expect(button).toBeEnabled();
    expect(downloads).toHaveLength(0);
    await flow.verifyInput(page);
    const pendingDownload = page.waitForEvent("download");
    await button.click();
    await verifyDownload(await pendingDownload);
    await expect(region.getByRole("alert")).toHaveCount(0);
    expect(attempts).toBe(2);
    expect(downloads).toHaveLength(1);
  });
}
