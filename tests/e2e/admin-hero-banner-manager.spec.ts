import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// 메인 배너 관리 (2026-11-16): every saved banner with its live preview and
// form, the slide interval, and a form for a new banner. The server actions
// are stubs that record what was submitted; no database is reached.
let html: string;
test.beforeAll(async () => {
  const [bundle, css] = await Promise.all([
    build({
      stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {HeroBannerManager} from './src/components/admin/hero-banner-manager';
        import {CenteredDialogHost} from './src/components/ui/centered-dialog-host';
        document.documentElement.setAttribute('data-js','');
        const record=name=>async form=>{(window.__submitted||(window.__submitted=[])).push([name,Object.fromEntries(form)])};
        const actions={save:record('save'),remove:record('remove'),saveInterval:record('interval')};
        const row=(over)=>({badge:null,headline_2:null,body:null,badge_en:null,headline_1_en:null,headline_2_en:null,body_en:null,link_url:null,is_active:true,...over});
        const rows=[
          row({id:'00000000-0000-4000-8000-000000000001',design:'record',badge:'Since 2017',headline_1:'음반·뮤직비디오 심의,',headline_2:'이제 더 간편하게',headline_1_en:'Album & MV Reviews,',headline_2_en:'Now Made Simple',sort_order:10}),
          row({id:'00000000-0000-4000-8000-000000000002',design:'url',headline_1:'이미 발매된 음원은',headline_2:'URL만 입력하면 끝',link_url:'/dashboard/new/album',sort_order:20}),
          row({id:'00000000-0000-4000-8000-000000000003',design:'certificate',headline_1:'뮤직비디오 유통엔',headline_2:'심의 필증이 필수',body:'온라인 심의로 미리 받아두세요',link_url:'/guide/mv-review',sort_order:30,is_active:false}),
        ];
        const empty=location.hash==='#empty';
        createRoot(document.getElementById('root')).render(<><CenteredDialogHost/>
          <HeroBannerManager rows={empty?[]:rows} failed={false} intervalSeconds={7} actions={actions}/></>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": '{"NODE_ENV":"production"}' },
      plugins: [{ name: "isolated-admin", setup(builder) {
        builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
          args.path === "next/navigation"
            ? `export const usePathname=()=>'/admin/hero-banners';export const useRouter=()=>({push(){},replace(){},prefetch(){},refresh(){}});export const useSearchParams=()=>new URLSearchParams();`
            : `import React from 'react'; export default function Link({children,prefetch,replace,scroll,...props}){return <a {...props}>{children}</a>}`,
        }));
      } }],
    }),
    readFile(resolve("src/app/globals.css"), "utf8").then(source => postcss([tailwind()]).process(source, { from: resolve("src/app/globals.css") })),
  ]);
  html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

async function open(page: Page, hash = "") {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html; charset=utf-8", body: html }) : route.fulfill({ status: 404 }));
  await page.goto(`/admin/hero-banners${hash}`);
  await expect(page.getByRole("heading", { level: 1, name: "메인 배너 관리" })).toBeVisible();
}
const submitted = (page: Page) => page.evaluate(() => (window as unknown as { __submitted?: unknown[] }).__submitted ?? []);

test("each banner shows where it stands on the home page, a preview and its text; saving sends the edited fields", async ({ page }, testInfo) => {
  await open(page);
  const cards = page.locator("article");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("메인 1번째 표시 중");
  await expect(cards.nth(1)).toContainText("메인 2번째 표시 중");
  await expect(cards.nth(2)).toContainText("꺼짐");
  // The preview is the banner itself, without a page heading or a link.
  for (const card of await cards.all()) {
    await expect(card.locator(".onside-hero-banner")).toHaveCount(1);
    await expect(card.locator("h1")).toHaveCount(0);
    await expect(card.locator("a.onside-hero-link")).toHaveCount(0);
  }
  await expect(cards.nth(1).locator(".onside-hero-title")).toHaveText("이미 발매된 음원은URL만 입력하면 끝");
  await expect(cards.nth(1).getByLabel("눌렀을 때 이동할 주소")).toHaveValue("/dashboard/new/album");

  const shot = testInfo.outputPath("admin-hero-banners.png");
  await page.screenshot({ path: shot, fullPage: true });
  const kept = resolve("tmp/shots/hero-carousel/admin.png");
  await mkdir(dirname(kept), { recursive: true });
  await copyFile(shot, kept);

  const second = cards.nth(1);
  await second.getByLabel("헤드카피 둘째 줄", { exact: true }).fill("링크만 넣으면 끝");
  await second.getByLabel("메인에 표시", { exact: true }).uncheck();
  await second.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(() => submitted(page)).toEqual([["save", {
    id: "00000000-0000-4000-8000-000000000002", design: "url", sortOrder: "20",
    headline1: "이미 발매된 음원은", headline2: "링크만 넣으면 끝", badge: "", body: "", linkUrl: "/dashboard/new/album",
    headline1En: "", headline2En: "", badgeEn: "", bodyEn: "",
  }]]);
});

test("deleting asks first, the interval and a new banner have their own forms", async ({ page }) => {
  await open(page);
  await page.locator("article").nth(2).getByRole("button", { name: "배너 삭제" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("되돌릴 수 없습니다");
  await dialog.getByRole("button", { name: "취소" }).click();
  expect(await submitted(page)).toEqual([]);
  await page.locator("article").nth(2).getByRole("button", { name: "배너 삭제" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "확인" }).click();
  await expect.poll(() => submitted(page)).toEqual([["remove", { id: "00000000-0000-4000-8000-000000000003" }]]);

  await page.getByLabel(/배너 하나를 보여주는 시간/).fill("9");
  await page.getByRole("button", { name: "간격 저장" }).click();
  await expect.poll(async () => (await submitted(page)).at(-1)).toEqual(["interval", { intervalSeconds: "9" }]);

  const add = page.locator("section").filter({ has: page.getByRole("heading", { name: "새 배너 추가" }) });
  await expect(add.getByLabel("순서", { exact: true })).toHaveValue("40");
  await add.locator('select[name="design"]').selectOption("certificate");
  await add.getByLabel("헤드카피 첫째 줄 (필수)", { exact: true }).fill("방송용 뮤직비디오도");
  await add.getByRole("button", { name: "배너 추가" }).click();
  await expect.poll(async () => (await submitted(page)).at(-1)).toEqual(["save", {
    design: "certificate", sortOrder: "40", isActive: "on", headline1: "방송용 뮤직비디오도", headline2: "", badge: "", body: "", linkUrl: "",
    headline1En: "", headline2En: "", badgeEn: "", bodyEn: "",
  }]);
});

test("with nothing saved the page says the built-in banners are showing", async ({ page }) => {
  await open(page, "#empty");
  await expect(page.locator("article")).toHaveCount(0);
  await expect(page.getByText("저장된 배너가 없어 기본 배너 4개가 표시되고 있습니다.", { exact: false })).toBeVisible();
});
