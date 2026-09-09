import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";

let documentHtml = "";
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {KaraokeFileButton} from './src/features/karaoke/karaoke-file-button';import {KaraokeForm} from './src/features/karaoke/karaoke-form';import {SubscriptionPayButtons} from './src/features/subscriptions/subscription-pay';const view=window.location.pathname;createRoot(document.getElementById('root')).render(view==='/file'?<KaraokeFileButton kind="request" targetId="fixture"/>:view==='/karaoke'?<KaraokeForm userId="fixture-member"/>:<SubscriptionPayButtons stdJsUrl="http://recovery.test/sdk.js" stdParams={{oid:'fixture'}} mobileParams={{P_OID:'fixture'}} orderId="fixture" amountLabel="10,000원"/>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": '{"NODE_ENV":"production"}' },
    plugins: [{ name: "isolated-actions-and-navigation", setup(builder) {
      builder.onResolve({ filter: /(^next\/navigation$|karaoke\/actions$|^\.\/actions$)/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents: args.path === "next/navigation"
        ? `const router={push(href){window.__navigation=href},refresh(){}};export const useRouter=()=>router;`
        : `export const createKaraokeRequestAction=async(payload)=>{(window.__applications??=[]).push(payload);return {requestId:'11111111-1111-4111-8111-111111111111',message:'신청 완료'}};const load=()=>window.__fileMode==='hang'?new Promise(()=>{}):window.__fileMode==='error'?Promise.reject(new Error('파일 서버 연결 실패')):Promise.resolve({url:'https://files.example.invalid/fixture.wav'});export const getKaraokeRequestFileUrlAction=load;export const getKaraokeRecommendationFileUrlAction=load;` }));
    } }],
  });
  documentHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

type Fixture = { sdkMode: "load" | "fail"; sdkRequests: number; orders: unknown[]; errors: string[]; unexpected: string[] };
async function mount(page: Page, path: string): Promise<Fixture> {
  const fixture: Fixture = { sdkMode: "load", sdkRequests: 0, orders: [], errors: [], unexpected: [] };
  page.on("pageerror", error => fixture.errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (request.resourceType() === "document" && url.origin === "http://recovery.test") { await route.fulfill({ contentType: "text/html", body: documentHtml }); return; }
    if (url.pathname === "/sdk.js") {
      fixture.sdkRequests++;
      if (fixture.sdkMode === "fail") await route.abort("failed");
      else await route.fulfill({ contentType: "text/javascript; charset=utf-8", body: `window.INIStdPay={pay(){window.__payCalls=(window.__payCalls||0)+1;if(window.__sdkThrows)throw new Error('결제 SDK 실행 실패')}};` });
      return;
    }
    if (url.pathname === "/api/inicis/karaoke/order") {
      fixture.orders.push(request.postDataJSON());
      await route.fulfill({ status: 503, json: { error: "결제 서버 일시 오류" } }); return;
    }
    fixture.unexpected.push(`${request.method()} ${url.href}`);
    await route.fulfill({ status: 409, json: { error: "Test blocked unexpected external request" } });
  });
  await page.goto(`http://recovery.test${path}`);
  return fixture;
}
const clean = (fixture: Fixture) => { expect(fixture.errors).toEqual([]); expect(fixture.unexpected).toEqual([]); };

test("karaoke file lookup rejection clears loading; popup blocking offers a working link", async ({ page }) => {
  const fixture = await mount(page, "/file");
  await page.evaluate(() => { Object.assign(window, { __fileMode: "error", open: () => null }); });
  const button = page.getByRole("button", { name: "파일 확인", exact: true });
  await button.click(); await expect(page.getByRole("alert")).toHaveText("파일 서버 연결 실패"); await expect(button).toBeEnabled();
  await page.evaluate(() => Object.assign(window, { __fileMode: "success" }));
  await button.click(); await expect(page.getByRole("link", { name: "파일 열기" })).toHaveAttribute("href", "https://files.example.invalid/fixture.wav");
  await expect(page.getByRole("alert")).toHaveCount(0); clean(fixture);
});

test("karaoke file lookup with no response expires and can be retried", async ({ page }) => {
  const fixture = await mount(page, "/file"); await page.clock.install();
  await page.evaluate(() => Object.assign(window, { __fileMode: "hang", open: () => null }));
  await page.getByRole("button", { name: "파일 확인", exact: true }).click();
  await expect(page.getByRole("button", { name: "확인 중", exact: true })).toBeDisabled();
  await page.clock.fastForward(20_001);
  await expect(page.getByRole("alert")).toContainText("응답이 지연"); await expect(page.getByRole("button", { name: "파일 확인", exact: true })).toBeEnabled(); clean(fixture);
});

test("subscription SDK load failure removes the failed script so retry can load and open it", async ({ page }) => {
  const fixture = await mount(page, "/subscription"); fixture.sdkMode = "fail";
  const button = page.getByRole("button", { name: "PC · 카드 정기결제", exact: true });
  await button.click(); await expect(page.getByRole("alert")).toContainText("결제 모듈 로딩에 실패"); await expect(button).toBeEnabled();
  await expect(page.locator('script[src="http://recovery.test/sdk.js"]')).toHaveCount(0);
  fixture.sdkMode = "load"; await button.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __payCalls: number }).__payCalls)).toBe(1);
  expect(fixture.sdkRequests).toBe(2); await expect(page.getByRole("alert")).toHaveCount(0); clean(fixture);
});

test("subscription SDK and mobile submit exceptions leave recoverable buttons without uncaught promises", async ({ page }) => {
  const fixture = await mount(page, "/subscription");
  await page.evaluate(() => Object.assign(window, { __sdkThrows: true }));
  const button = page.getByRole("button", { name: "PC · 카드 정기결제", exact: true });
  await button.click(); await expect(page.getByRole("alert")).toHaveText("결제 SDK 실행 실패"); await expect(button).toBeEnabled();
  await page.evaluate(() => { HTMLFormElement.prototype.submit = () => { throw new Error("blocked"); }; });
  const mobile = page.getByRole("button", { name: "모바일 INIBill", exact: true });
  await mobile.click(); await expect(page.getByRole("alert")).toContainText("모바일 결제 화면을 열지 못했습니다"); await expect(mobile).toBeEnabled(); clean(fixture);
});

test("karaoke card initialization retry reuses its saved application instead of creating duplicates", async ({ page }) => {
  const fixture = await mount(page, "/karaoke");
  const field = (text: string) => page.locator("div.space-y-2").filter({ has: page.locator("label", { hasText: new RegExp(`^${text}$`) }) }).locator("input");
  await field("곡명").fill("복구 테스트 곡"); await field("연락처").fill("01012345678");
  await page.getByRole("button", { name: "카드 결제", exact: true }).click();
  const submit = page.getByRole("button", { name: "등록 요청하기", exact: true });
  await submit.click(); await expect(page.getByText("결제 서버 일시 오류", { exact: true })).toBeVisible();
  await submit.click(); await expect.poll(() => fixture.orders.length).toBe(2);
  expect(await page.evaluate(() => (window as unknown as { __applications: unknown[] }).__applications.length)).toBe(1);
  expect(fixture.orders[0]).toEqual(fixture.orders[1]);
  await field("곡명").fill("다른 곡"); await submit.click(); await expect.poll(() => fixture.orders.length).toBe(3);
  expect(await page.evaluate(() => (window as unknown as { __applications: unknown[] }).__applications.length)).toBe(2); clean(fixture);
});
