import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// A customer typed hanmail.met; the address was corrected on the application.
// The bounced mail keeps the address it bounced from, and its 재발송 button
// says the retry goes to the corrected one. The retry action is a stub, so
// no database or mail server is reached.
let html: string;
test.beforeAll(async () => {
  const [bundle, css] = await Promise.all([
    build({
      stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {ReviewEmailControl} from './src/components/admin/review-email-control';
        import {CenteredDialogHost} from './src/components/ui/centered-dialog-host';
        const mail=(id,operation,status,recipient)=>({id,operation,status,recipient,subject:'[onside] '+operation,attempts:1,createdAt:'2026-11-15T00:00:00Z',
          acceptedAt:status==='accepted'?'2026-11-15T00:00:05Z':null,nextAttemptAt:null,lastAttemptAt:'2026-11-15T00:00:00Z',tracking:'open+click',
          openedAt:null,lastOpenedAt:null,openCount:0,clickedAt:null,lastClickedAt:null,clickCount:0,acknowledgedAt:null});
        createRoot(document.getElementById('root')).render(<><CenteredDialogHost/><main style={{maxWidth:640,margin:'24px auto'}}>
          <ReviewEmailControl submissionId="22222222-2222-4222-8222-222222222222" currentRecipient="artist@hanmail.net" customerEmails={[
            mail('11111111-1111-4111-8111-111111111111','payment completed','failed','artist@hanmail.met'),
            mail('33333333-3333-4333-8333-333333333333','submission update','failed','Artist@Hanmail.net'),
            mail('44444444-4444-4444-8444-444444444444','review result','accepted','artist@hanmail.net'),
            {...mail('55555555-5555-4555-8555-555555555555','guest lookup','failed','artist@hanmail.met'),acknowledgedAt:'2026-11-16T00:30:00Z'},
          ]}/>
        </main></>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": '{"NODE_ENV":"production"}' },
      plugins: [{ name: "email-control-isolation", setup(builder) {
        builder.onResolve({ filter: /^(@\/app\/admin\/emails\/actions|next\/navigation)$/ }, args => ({ path: args.path, namespace: "mock" }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
          args.path === "next/navigation" ? `export const useRouter=()=>({refresh(){}});`
          : `export const retryEmailAction=async()=>{};export const acknowledgeEmailAction=async form=>{(window.__acknowledged||(window.__acknowledged=[])).push(Object.fromEntries(form))};`,
        }));
      } }],
    }),
    readFile(resolve("src/app/globals.css"), "utf8").then(source => postcss([tailwind()]).process(source, { from: resolve("src/app/globals.css") })),
  ]);
  html = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

test("a bounced mail keeps its address and says its retry goes to the corrected one", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 680, height: 900 });
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
  await page.goto("/__email-control#customer-emails");

  const items = page.locator("#customer-emails li");
  await expect(items).toHaveCount(4);
  const bounced = items.nth(0);
  await expect(bounced).toContainText("artist@hanmail.met");
  await expect(bounced.getByRole("button", { name: "재발송 예약" })).toBeVisible();
  await expect(bounced).toContainText("재발송은 현재 수신 이메일로 보냅니다: artist@hanmail.net");
  // Already the current address (case aside): nothing to say.
  await expect(items.nth(1).getByRole("button", { name: "재발송 예약" })).toBeVisible();
  await expect(items.nth(1)).not.toContainText("재발송은 현재 수신 이메일로");
  // Accepted mail has no retry at all.
  await expect(items.nth(2).getByRole("button", { name: "재발송 예약" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("email-retry-recipient.png"), fullPage: true });
});

test("확인 완료 is offered on unhandled failures, asks first, and an acknowledged mail shows when it was handled", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 680, height: 1000 });
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
  await page.goto("/__email-control#customer-emails");
  const items = page.locator("#customer-emails li");
  const acknowledge = items.nth(0).getByRole("button", { name: "확인 완료", exact: true });
  await expect(acknowledge).toBeVisible();
  await expect(items.nth(2).getByRole("button", { name: "확인 완료", exact: true })).toHaveCount(0);

  const handled = items.nth(3);
  await expect(handled).toContainText("발송 실패");
  await expect(handled).toContainText(/확인 완료 26\. 11\. 16\./);
  await expect(handled.getByRole("button", { name: "확인 완료", exact: true })).toHaveCount(0);
  await expect(handled.getByRole("button", { name: "재발송 예약" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("email-acknowledge.png"), fullPage: true });

  await acknowledge.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("사이트 관리 경고에서 빠집니다");
  await dialog.getByRole("button", { name: "취소" }).click();
  expect(await page.evaluate(() => (window as unknown as { __acknowledged?: unknown[] }).__acknowledged ?? [])).toEqual([]);
  await acknowledge.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "확인" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __acknowledged?: unknown[] }).__acknowledged ?? [])).toEqual([
    { id: "11111111-1111-4111-8111-111111111111", submissionId: "22222222-2222-4222-8222-222222222222", returnTo: "" },
  ]);
});
