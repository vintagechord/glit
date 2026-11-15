import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// TBS could not announce results (2026-11): every other station is decided.
// The operator sends the album on to 결과 통보 완료 with TBS still pending, and
// can put it back. The form action is a stub, so no database is reached.
let html: string;
test.beforeAll(async () => {
  const [bundle, css] = await Promise.all([
    build({
      stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {PartialResultNoticeForm} from './src/components/admin/partial-result-notice-form';
        import {CenteredDialogHost} from './src/components/ui/centered-dialog-host';
        const record=async form=>{(window.__submitted||(window.__submitted=[])).push(Object.fromEntries(form))};
        const common={submissionId:'22222222-2222-4222-8222-222222222222',returnTo:'/admin/submissions?type=ALBUM',action:record};
        createRoot(document.getElementById('root')).render(<><CenteredDialogHost/><main style={{maxWidth:760,margin:'24px auto',display:'grid',gap:24}}>
          <section id="in-review"><PartialResultNoticeForm {...common} movedAt={null} pendingStations={['TBS']}/></section>
          <section id="moved"><PartialResultNoticeForm {...common} movedAt="2026-11-16T03:00:00Z" pendingStations={['TBS']}/></section>
        </main></>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": '{"NODE_ENV":"production"}' },
    }),
    readFile(resolve("src/app/globals.css"), "utf8").then(source => postcss([tailwind()]).process(source, { from: resolve("src/app/globals.css") })),
  ]);
  html = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

const submitted = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { __submitted?: unknown[] }).__submitted ?? []);

test("an album in review with a station still pending can be sent on after a confirmation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 820, height: 620 });
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
  await page.goto("/__partial-result-notice");

  const form = page.locator("#in-review form");
  await expect(form).toContainText("일부 방송사 결과 대기");
  await expect(form).toContainText("결과 대기: TBS");
  await expect(form).toContainText("고객 화면에는 계속 결과 대기로 보입니다");
  const shot = testInfo.outputPath("partial-result-notice.png");
  await page.screenshot({ path: shot, fullPage: true });
  // Kept for the owner to look at (tmp/shots is excluded from git locally).
  const kept = resolve("tmp/shots/partial-result-notice/form.png");
  await mkdir(dirname(kept), { recursive: true });
  await copyFile(shot, kept);

  const send = form.getByRole("button", { name: "결과 통보 완료로 이동" });
  await send.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("TBS");
  await expect(dialog).toContainText("고객 화면과 메일은 바뀌지 않고");
  await dialog.getByRole("button", { name: "취소" }).click();
  expect(await submitted(page)).toEqual([]);

  await send.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "확인" }).click();
  await expect.poll(() => submitted(page)).toEqual([
    { submissionId: "22222222-2222-4222-8222-222222222222", returnTo: "/admin/submissions?type=ALBUM", mode: "close" },
  ]);
});

test("an album already sent on shows when, which station is open, and can be put back into review", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 620 });
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
  await page.goto("/__partial-result-notice");

  const form = page.locator("#moved form");
  await expect(form).toContainText("결과 통보 완료 · 일부 대기");
  await expect(form).toContainText("결과 대기: TBS");
  await expect(form).toContainText(/26\. 11\. 16\..*처리/);
  await expect(form.getByRole("button", { name: "결과 통보 완료로 이동" })).toHaveCount(0);

  await form.getByRole("button", { name: "심의 진행 중으로 되돌리기" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "확인" }).click();
  await expect.poll(() => submitted(page)).toEqual([
    { submissionId: "22222222-2222-4222-8222-222222222222", returnTo: "/admin/submissions?type=ALBUM", mode: "reopen" },
  ]);
});
