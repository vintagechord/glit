import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const orderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let html: string;

test.beforeAll(async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {SubmissionDetailClient} from './src/features/submissions/submission-detail-client';
      import {EnglishLanguagePack} from './src/components/i18n/english-language-pack';
      import {GUEST_SUBMISSION_ORDERS_STORAGE_KEY} from './src/lib/guest-submission-cart';
      const linked=!location.search.includes('unlinked');
      const bank=location.search.includes('bank');
      // A closed card window leaves the order linked with UNPAID/WAITING_PAYMENT;
      // only an in-flight approval (or a bank request) keeps PAYMENT_PENDING.
      const pending=bank||location.search.includes('pending');
      const submission={id:'${first}',title:'Checkout fixture',artist_name:'Fixture artist',type:'ALBUM',status:linked&&!pending?'WAITING_PAYMENT':'SUBMITTED',payment_status:linked&&pending?'PAYMENT_PENDING':'UNPAID',payment_method:bank?'BANK':'CARD',current_order_id:linked?'${orderId}':null,amount_krw:50000,created_at:'2026-10-24T00:00:00Z',updated_at:'2026-10-24T00:00:00Z',package:{name:'방송국 1곳',station_count:1,price_krw:50000},album_tracks:[]};
      localStorage.setItem(GUEST_SUBMISSION_ORDERS_STORAGE_KEY,JSON.stringify([{submissionId:'${first}',guestToken:'first-private-proof'},{submissionId:'${second}',guestToken:'second-private-proof'}]));
      window.__checkoutNavigation=[];
      createRoot(document.getElementById('root')).render(<><SubmissionDetailClient submissionId={submission.id} initialSubmission={submission} initialFiles={[]} initialStationReviews={[]} enableRealtime={false} initialDataComplete={true} guestToken="first-private-proof"/><EnglishLanguagePack/></>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": '{"NODE_ENV":"production"}' },
    plugins: [{ name: "detail-checkout-services", setup(builder) {
      builder.onResolve({ filter: /^(next\/(?:navigation|image)|@\/lib\/supabase\/client|@\/features\/submissions\/actions)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        path === "next/navigation" ? `const router={push(href){window.__checkoutNavigation.push(href)},refresh(){}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;` :
        path === "next/image" ? `export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>}` :
        path === "@/features/submissions/actions" ? `export const getSubmissionFileUrlAction=async()=>({error:'Fixture excludes file operations'});` :
        `export const createClient=()=>{throw new Error('Unexpected database access')};`,
      }));
    } }],
  });
  html = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

async function mount(page: Page, options: { status?: number; hold?: boolean; query?: string; english?: boolean } = {}) {
  const calls: Record<string, unknown>[] = [];
  const unexpected: string[] = [];
  let release: () => void = () => undefined;
  const held = options.hold ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
  await page.route("**/*", async route => {
    if (route.request().resourceType() === "document") { await route.fulfill({ contentType: "text/html", body: html }); return; }
    if (new URL(route.request().url()).pathname === "/api/orders/return") {
      calls.push(route.request().postDataJSON());
      await held;
      await route.fulfill({ status: options.status ?? 200, json: options.status ? { error: "Fixture approval state changed" } : { ok: true, submissionIds: [first, second] } });
      return;
    }
    unexpected.push(route.request().method());
    await route.fulfill({ status: 409, json: { error: "Unexpected request blocked" } });
  });
  await page.goto(`http://checkout-detail.fixture.invalid${options.english ? "/en" : ""}/track/fixture${options.query ?? ""}`);
  return { calls, unexpected, release };
}

const navigation = (page: Page) => page.evaluate(() => (window as unknown as { __checkoutNavigation: string[] }).__checkoutNavigation);

test("linked guest application payment prepares its entire order once and opens the payment-method step", async ({ page }) => {
  const fixture = await mount(page, { hold: true });
  const pay = page.getByRole("button", { name: "결제하기", exact: true });
  await expect(pay).toBeVisible();
  expect(fixture.calls).toEqual([]);
  await pay.click();
  const pending = page.getByRole("button", { name: "결제 준비 중...", exact: true });
  await expect(pending).toBeDisabled();
  await pending.dispatchEvent("click");
  expect(fixture.calls).toEqual([{ orderId, guestTokensBySubmissionId: { [first]: "first-private-proof", [second]: "second-private-proof" } }]);
  fixture.release();
  await expect.poll(() => navigation(page)).toEqual([`/mypage/cart?step=payment&items=${encodeURIComponent(`${first},${second}`)}`]);
  expect(fixture.calls).toHaveLength(1);
  expect(fixture.unexpected).toEqual([]);
  expect((await navigation(page))[0]).not.toContain("private-proof");
});

test("changed or uncertain payment status shows an error and never opens a new checkout", async ({ page }) => {
  const fixture = await mount(page, { status: 409 });
  await page.getByRole("button", { name: "결제하기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("승인 확인 중");
  await expect(page.getByRole("button", { name: "결제하기", exact: true })).toBeEnabled();
  expect(await navigation(page)).toEqual([]);
  expect(fixture.calls).toHaveLength(1);
  expect(fixture.unexpected).toEqual([]);
});

test("an unlinked application goes directly to its selected payment step without changing an order", async ({ page }) => {
  const fixture = await mount(page, { query: "?unlinked" });
  await page.getByRole("button", { name: "결제하기", exact: true }).click();
  await expect.poll(() => navigation(page)).toEqual([`/mypage/cart?step=payment&items=${first}`]);
  expect(fixture.calls).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test("a card approval still being confirmed sends the customer to orders instead of retrying", async ({ page }) => {
  const fixture = await mount(page, { query: "?pending" });
  await expect(page.getByRole("button", { name: "결제하기", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "주문내역 확인", exact: true }).click();
  await expect.poll(() => navigation(page)).toEqual([`/mypage/orders?focus=${first}`]);
  expect(fixture.calls).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test("existing bank payment instructions stay outside automatic order cancellation", async ({ page }) => {
  const fixture = await mount(page, { query: "?bank" });
  await page.getByRole("button", { name: "입금 안내 보기", exact: true }).click();
  await expect.poll(() => navigation(page)).toEqual([`/mypage/orders?focus=${first}`]);
  expect(fixture.calls).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

for (const status of [200, 409]) test(`English detail checkout preserves locale and translates its ${status === 200 ? "success path" : "error guidance"}`, async ({ page }) => {
  const fixture = await mount(page, { english: true, ...(status === 409 ? { status } : {}) });
  await page.getByRole("button", { name: "Payment", exact: true }).click();
  if (status === 200) {
    await expect.poll(() => navigation(page)).toEqual([`/en/mypage/cart?step=payment&items=${encodeURIComponent(`${first},${second}`)}`]);
  } else {
    await expect(page.getByRole("alert")).toContainText("approval is still being checked");
    expect(await navigation(page)).toEqual([]);
  }
  expect(fixture.calls).toHaveLength(1);
  expect(fixture.unexpected).toEqual([]);
});
