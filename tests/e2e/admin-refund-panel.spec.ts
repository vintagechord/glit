import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// The admin refund panel rendered alone; the server action is a recorder, so
// no database or payment provider is reached.
let html: string;
test.beforeAll(async () => {
  const [bundle, css] = await Promise.all([
    build({
      stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {AdminRefundPanel} from './src/components/admin/refund-panel';
        import {CenteredDialogHost} from './src/components/ui/centered-dialog-host';
        const params=new URLSearchParams(location.search);
        const status=params.get('status')||'PAID';
        createRoot(document.getElementById('root')).render(<><CenteredDialogHost/><main style={{maxWidth:520,margin:'24px auto'}}>
          <AdminRefundPanel submissionId="11111111-1111-4111-8111-111111111111" paymentStatus={status} paymentMethod="BANK" amountKrw={260000}
            orderTitles={params.has('group')?['첫 앨범','둘째 앨범']:['첫 앨범']} cashReceiptIssued={params.has('receipt')} refundedAt={status==='REFUNDED'?'2026-11-02T09:00:00Z':null}/>
        </main></>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": '{"NODE_ENV":"production"}' },
      plugins: [{ name: "refund-panel-isolation", setup(builder) {
        builder.onResolve({ filter: /^(@\/features\/admin\/actions|next\/navigation|next\/link)$/ }, args => ({ path: args.path, namespace: "mock" }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
          args.path === "next/navigation" ? `export const useRouter=()=>({refresh(){window.__refreshed=(window.__refreshed||0)+1}});`
          : args.path === "next/link" ? `export default function Link({prefetch,...props}){return <a {...props}/>}`
          : `export const recordRefundAction=async input=>{(window.__refundCalls||(window.__refundCalls=[])).push(input);return window.__refundResult||{message:'같은 주문으로 결제한 접수 2건을 환불로 기록했습니다.'}};`,
        }));
      } }],
    }),
    readFile(resolve("src/app/globals.css"), "utf8").then(source => postcss([tailwind()]).process(source, { from: resolve("src/app/globals.css") })),
  ]);
  html = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

async function open(page: Page, query: string) {
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
  await page.goto(`/__refund-panel?${query}`);
}

test("a paid order group is recorded as refunded only after the admin confirms the money went back", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 600, height: 1000 });
  await open(page, "status=PAID&group&receipt");
  await expect(page.getByText("같은 주문으로 결제한 2건이 함께 환불로 기록됩니다.")).toBeVisible();
  await expect(page.getByText(/현금영수증이 발급되어 있습니다/)).toBeVisible();
  await expect(page.getByRole("radio", { name: /계좌 송금/ })).toBeChecked();
  const submit = page.getByRole("button", { name: "환불 완료로 기록" });
  await expect(submit).toBeDisabled();
  await page.getByPlaceholder(/이니시스 취소 처리/).fill("신한 송금");
  await page.getByRole("checkbox", { name: /실제 환불/ }).check();
  await page.screenshot({ path: testInfo.outputPath("refund-panel.png"), fullPage: true });
  await submit.click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("같은 주문으로 결제한 접수 2건");
  await confirm.getByRole("button", { name: "취소" }).click();
  expect(await page.evaluate(() => (window as unknown as { __refundCalls?: unknown[] }).__refundCalls ?? [])).toEqual([]);
  await submit.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "확인" }).click();
  await expect(page.getByRole("dialog")).toContainText("환불로 기록했습니다");
  expect(await page.evaluate(() => (window as unknown as { __refundCalls?: unknown[] }).__refundCalls)).toEqual([
    { submissionId: "11111111-1111-4111-8111-111111111111", method: "BANK_TRANSFER", note: "신한 송금", notifyCustomer: true },
  ]);
  await page.getByRole("dialog").getByRole("button", { name: "닫기" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __refreshed?: number }).__refreshed ?? 0)).toBe(1);
});

test("refunded and unpaid submissions show a record or nothing", async ({ page }) => {
  await open(page, "status=REFUNDED&receipt");
  await expect(page.getByText(/환불 완료 · /)).toBeVisible();
  await expect(page.getByRole("button", { name: "환불 완료로 기록" })).toHaveCount(0);
  await expect(page.getByText(/현금영수증이 발급되어 있습니다/)).toBeVisible();
  await open(page, "status=UNPAID");
  await expect(page.getByText("환불 처리")).toHaveCount(0);
});
