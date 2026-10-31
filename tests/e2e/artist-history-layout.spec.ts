import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const longTitle = "방송 심의 신청서의 아주 긴 제목과공백없이이어지는음반명ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
let html: string;

test.beforeAll(async () => {
  const [bundle, styles] = await Promise.all([
    build({
      stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {ArtistHistoryTabs} from './src/components/dashboard/artist-history';
        import {EnglishLanguagePack} from './src/components/i18n/english-language-pack';
        const submission=(id,title,status='RESULT_READY',extra={})=>({id,title,status,payment_status:'PAID',type:'ALBUM',created_at:'2026-10-24T00:00:00Z',updated_at:null,...extra});
        const groups=[
          {artistId:null,artistName:'앨범 링크 확인 대기',thumbnail:null,submissions:[submission('fixture-1',null,'RESULT_READY',{is_oneclick:true}),submission('fixture-2',${JSON.stringify(longTitle)},'COMPLETED'),submission('fixture-3','Short album title','IN_PROGRESS')]},
          {artistId:'fixture-artist-2',artistName:'이름이아주긴아티스트와여러멤버가함께하는그룹',thumbnail:null,submissions:[submission('fixture-4','Second artist album')]},
          {artistId:'fixture-artist-3',artistName:'Third Artist',thumbnail:null,submissions:[submission('fixture-5','Third artist album','SUBMITTED')]}
        ];
        createRoot(document.getElementById('root')).render(<><ArtistHistoryTabs albumGroups={groups} mvGroups={[]}/><EnglishLanguagePack/></>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": '{"NODE_ENV":"production"}' },
      plugins: [{ name: "history-isolation", setup(builder) {
        builder.onResolve({ filter: /^next\/(?:navigation|image|link)$/ }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "tsx", resolveDir: process.cwd(), contents:
          path === "next/navigation" ? `export const usePathname=()=>location.pathname;` :
          path === "next/link" ? `export default function Link({prefetch,...props}){return <a {...props}/>} ` :
          `export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>}`,
        }));
      } }],
    }),
    readFile(resolve("src/app/globals.css"), "utf8").then(css => postcss([tailwind()]).process(css, { from: resolve("src/app/globals.css") })),
  ]);
  html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles.css}</style></head><body><main style="max-width:1200px;margin:auto;padding:16px"><h1 style="font-size:28px;font-weight:900;margin-bottom:24px">나의 심의 내역</h1><div id="root"></div></main><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

async function mount(page: Page, english = false) {
  const blocked: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request();
    if (request.isNavigationRequest() && request.method() === "GET" && new URL(request.url()).hostname === "history.fixture.invalid") {
      await route.fulfill({ contentType: "text/html", body: html });
      return;
    }
    blocked.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.abort("blockedbyclient");
  });
  await page.goto(`http://history.fixture.invalid${english ? "/en" : ""}/mypage/history`);
  await expect(page.getByRole("group", { name: /ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$/ })).toBeVisible();
  return blocked;
}

for (const width of [320, 390, 1024, 1440]) test(`history cards balance controls and preserve titles at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 });
  const blocked = await mount(page);
  const rows = page.getByRole("group");
  await expect(rows).toHaveCount(5);
  // An untitled released-album URL submission shows its status only.
  const urlOnly = page.getByRole("group", { name: "발매된 음반 URL 접수", exact: true });
  await expect(urlOnly.getByRole("link")).toHaveCount(1);
  await expect(page.getByText("발매된 음반 · URL 접수")).toHaveCount(0);
  for (const row of await rows.all()) {
    const titled = (await row.getByRole("link").count()) > 1;
    const checkbox = await row.getByRole("checkbox").locator("..").boundingBox();
    const status = await row.getByRole("link").first().boundingBox();
    const remove = await row.getByRole("button", { name: /심의 내역 삭제$/ }).boundingBox();
    const title = titled ? await row.getByRole("link").last().boundingBox() : status;
    const bounds = await row.boundingBox();
    expect(checkbox && status && remove && title && bounds).toBeTruthy();
    if (!checkbox || !status || !remove || !title || !bounds) continue;
    expect(checkbox.width).toBeGreaterThanOrEqual(44);
    expect(checkbox.height).toBeGreaterThanOrEqual(44);
    expect(remove.width).toBeGreaterThanOrEqual(44);
    expect(remove.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(status.y - checkbox.y)).toBeLessThan(1);
    expect(Math.abs(remove.y - checkbox.y)).toBeLessThan(1);
    expect(status.x).toBeGreaterThanOrEqual(checkbox.x + checkbox.width);
    expect(remove.x + remove.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    if (titled) {
      expect(title.y).toBeGreaterThanOrEqual(Math.max(status.y + status.height, remove.y + remove.height));
      expect(Math.abs(title.x - checkbox.x)).toBeLessThan(1);
      expect(title.width).toBeGreaterThan(bounds.width - 20);
    }
    expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const cards = page.locator('[class~="@container"]');
  const cardBounds = await Promise.all((await cards.all()).map(card => card.boundingBox()));
  const sameTop = (a: number, b: number) => Math.abs(cardBounds[a]!.y - cardBounds[b]!.y) < 1;
  expect(sameTop(0, 1)).toBe(width >= 768);
  expect(sameTop(0, 2)).toBe(width >= 1280);
  await page.screenshot({ path: testInfo.outputPath(`history-${width}.png`), fullPage: true, animations: "disabled" });
  expect(blocked).toEqual([]);
});

test("English status labels fit at 320px and preserve locale", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  const blocked = await mount(page, true);
  const row = page.getByRole("group", { name: /ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$/ });
  const status = row.getByRole("link", { name: "Review Completed", exact: true });
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("href", "/en/dashboard/submissions/fixture-2");
  expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("history-320-en.png"), fullPage: true, animations: "disabled" });
  expect(blocked).toEqual([]);
});

test("checkboxes remain named and keyboard selectable while canceled deletion sends no request", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const blocked = await mount(page);
  const row = page.getByRole("group", { name: longTitle, exact: true });
  const checkbox = row.getByRole("checkbox", { name: `${longTitle} 선택`, exact: true });
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await expect(page.getByRole("button", { name: "삭제 1", exact: true })).toBeEnabled();
  page.once("dialog", dialog => dialog.dismiss());
  await row.getByRole("button", { name: `${longTitle} 심의 내역 삭제`, exact: true }).click();
  await expect(row).toBeVisible();
  await expect(checkbox).toBeChecked();
  expect(blocked).toEqual([]);
});
