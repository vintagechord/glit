import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SubmissionCartItem } from "../../src/lib/submission-cart";
import type { SubmissionOrder, SubmissionOrderStatus } from "../../src/lib/submission-orders-types";
import { GUEST_SUBMISSION_CART_STORAGE_KEY, GUEST_SUBMISSION_ORDERS_STORAGE_KEY } from "../../src/lib/guest-submission-cart";

const ids = Array.from({ length: 12 }, (_, index) => `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`);
const orderIds = Array.from({ length: 12 }, (_, index) => `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`);
const tokens = Object.fromEntries(ids.map((id, index) => [id, `commerce-guest-fixture-${index + 1}`]));
const groupId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const item = (index: number, overrides: Partial<SubmissionCartItem> = {}): SubmissionCartItem => ({
  id: ids[index], type: "ALBUM", status: "SUBMITTED", payment_status: "UNPAID", payment_method: "CARD", current_order_id: null,
  title: `검증 앨범 ${index + 1}`, artist_name: "검증 아티스트", amount_krw: 35000,
  created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z", package: { name: "3개 패키지" }, ...overrides,
});
const order = (index: number, status: SubmissionOrderStatus, overrides: Partial<SubmissionOrder> = {}): SubmissionOrder => ({
  id: orderIds[index], status, paymentMethod: status === "BANK_PENDING" ? "BANK" : status === "PAYPAL_PENDING" ? "PAYPAL" : "CARD",
  amountKrw: 35000, amount: 35000, currency: "KRW", source: "live", note: null,
  createdAt: `2026-09-08T00:${String(50 - index).padStart(2, "0")}:00Z`, updatedAt: "2026-09-08T00:00:00Z", paidAt: null, returnedAt: null,
  canReturnToCart: ["BANK_PENDING", "CARD_PENDING", "PAYPAL_PENDING", "FAILED", "CANCELED"].includes(status),
  items: [{ id: `item-${index}`, submissionId: ids[index], submissionRef: ids[index], type: "ALBUM", title: `주문 앨범 ${index + 1}`, artistName: "검증 아티스트", packageName: "3개 패키지", amountKrw: 35000, amount: 35000, isOneclick: false }], ...overrides,
});
const mixedItems = () => [
  item(0), item(1, { status: "WAITING_PAYMENT", payment_method: "BANK", amount_krw: 25000 }),
  item(2, { payment_status: "PAYMENT_PENDING" }),
  item(3, { payment_status: "PAYMENT_PENDING", payment_method: "BANK" }),
  item(4, { current_order_id: orderIds[4] }),
  item(5, { payment_status: "PAID" }),
  item(6, { status: "DRAFT" }),
  item(7, { amount_krw: null }), item(8, { amount_krw: 0 }),
];
const bankGroup = () => order(0, "BANK_PENDING", {
  amountKrw: 60000, amount: 60000,
  items: [...order(0, "BANK_PENDING").items, { ...order(1, "BANK_PENDING").items[0], amountKrw: 25000, amount: 25000 }],
});
const row = (page: Page, id: string) => page.locator(`#cart-item-${id}`);
const select = (page: Page, id: string) => row(page, id).locator("button[aria-pressed]");
const orderRow = (page: Page, id: string) => page.locator(`#order-${id}`);
const payment = (page: Page) => page.getByRole("button", { name: "결제하기", exact: true });
const returnButton = (page: Page, id = orderIds[0]) => orderRow(page, id).getByRole("button", { name: "장바구니로 돌리기", exact: true });
type Body = { submissionIds?: string[]; guestTokensBySubmissionId?: Record<string, string>; orderId?: string; offset?: number };
type Harness = {
  items: SubmissionCartItem[]; orders: SubmissionOrder[]; writes: { path: string; body: Body }[];
  reads: { method: string; body: Body | null; offset: number }[]; unexpected: string[]; errors: string[];
  bankError: string | null; returnError: string | null; holdReturn: boolean; releaseReturn?: () => void;
  holdOrders?: boolean; releaseOrders?: () => void;
  invalidIds: string[]; pageSize: number; cardMode: "reject" | "open";
};
let isolatedDocument = "";
async function buildIsolatedDocument() {
  const [bundle, styles] = await Promise.all([
    build({
      stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client"; import {SubmissionCartCheckout} from "./src/components/dashboard/submission-cart-checkout"; import {SubmissionOrdersClient} from "./src/components/dashboard/submission-orders-client"; const f=window.__commerceFixture; createRoot(document.getElementById("commerce-root")).render(f.view==="orders"?<SubmissionOrdersClient userId={f.userId}/>:<SubmissionCartCheckout userId={f.userId} initialItems={f.initialItems}/>);`, resolveDir: process.cwd(), loader: "tsx" },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": '{"NODE_ENV":"production"}' },
      plugins: [{ name: "test-navigation-only", setup(builder) {
        builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: "test-next" }));
        builder.onLoad({ filter: /.*/, namespace: "test-next" }, args => ({ resolveDir: process.cwd(), loader: "js", contents: args.path === "next/navigation"
          ? `const router={push(href){(window.__commerceNavigation??=[]).push(href)},refresh(){window.__commerceRefreshes=(window.__commerceRefreshes||0)+1}};const params=new URLSearchParams(window.location.search);export const useRouter=()=>router;export const usePathname=()=>window.location.pathname;export const useSearchParams=()=>params;`
          : `import React from "react";export default function Link({children,...props}){return React.createElement("a",props,children)}` }));
      } }],
    }),
    readFile(resolve("src/app/globals.css"), "utf8").then(css => postcss([tailwind()]).process(css, { from: resolve("src/app/globals.css") })),
  ]);
  isolatedDocument = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles.css}</style></head><body><main style="max-width:1152px;margin:auto;padding:16px"><div id="commerce-root"></div></main><script>window.__commerceFixture=__FIXTURE_JSON__;</script><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}

// All writes and gateway calls are intercepted, including on a deployed Next
// page. No account, order, submission, email, or real payment is changed.
async function mount(page: Page, options: { items?: SubmissionCartItem[]; orders?: SubmissionOrder[]; identity?: string | null; live?: boolean; view?: "cart" | "orders"; english?: boolean; invalidIds?: string[]; pageSize?: number } = {}): Promise<Harness> {
  const { items = [], orders = [], identity = null, live = false, view = "cart", english = false } = options;
  const liveOrigin = new URL(process.env.NEXT_E2E_BASE_URL || "http://localhost:3000").origin;
  const harness: Harness = { items: structuredClone(items), orders: structuredClone(orders), writes: [], reads: [], unexpected: [], errors: [], bankError: null, returnError: null, holdReturn: false, invalidIds: options.invalidIds ?? [], pageSize: options.pageSize ?? 30, cardMode: "reject" };
  page.on("pageerror", error => harness.errors.push(error.message));
  const entries = (refs: string[]) => [...new Set(refs)].map(id => ({ submissionId: id, guestToken: tokens[id] }));
  await page.addInitScript(({ cartEntries, orderEntries, cartKey, ordersKey }) => {
    localStorage.setItem(cartKey, JSON.stringify(cartEntries)); localStorage.setItem(ordersKey, JSON.stringify(orderEntries));
  }, { cartEntries: identity ? [] : entries(items.map(entry => entry.id)), orderEntries: identity ? [] : entries(orders.flatMap(entry => entry.items.map(value => value.submissionRef))), cartKey: GUEST_SUBMISSION_CART_STORAGE_KEY, ordersKey: GUEST_SUBMISSION_ORDERS_STORAGE_KEY });
  await page.context().route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (!live && request.resourceType() === "document") {
      const fixture = JSON.stringify({ view, userId: identity, initialItems: identity ? harness.items : [] }).replace(/</g, "\\u003c");
      await route.fulfill({ contentType: "text/html", body: isolatedDocument.replace("__FIXTURE_JSON__", fixture) }); return;
    }
    if (url.pathname === "/api/cart/items" && request.method() === "POST") {
      await route.fulfill({ json: { items: harness.items, invalidSubmissionIds: harness.invalidIds } }); return;
    }
    if (url.pathname === "/api/orders" && ["GET", "POST"].includes(request.method())) {
      const body = request.method() === "POST" ? request.postDataJSON() as Body : null;
      const offset = Number(body?.offset ?? url.searchParams.get("offset") ?? 0);
      harness.reads.push({ method: request.method(), body, offset });
      if (harness.holdOrders) await new Promise<void>(resolve => { harness.releaseOrders = resolve; });
      const next = offset + harness.pageSize;
      await route.fulfill({ json: { orders: harness.orders.slice(offset, next), nextOffset: harness.orders.length > next ? next : null } }); return;
    }
    if (url.pathname === "/api/cart/bank" && request.method() === "POST") {
      const body = request.postDataJSON() as Body; harness.writes.push({ path: url.pathname, body });
      if (harness.bankError) { await route.fulfill({ status: 409, json: { error: harness.bankError } }); return; }
      const chosen = harness.items.filter(entry => body.submissionIds?.includes(entry.id));
      harness.items = harness.items.filter(entry => !body.submissionIds?.includes(entry.id));
      harness.orders = [bankGroup()];
      await route.fulfill({ json: { count: chosen.length, totalAmountKrw: chosen.reduce((sum, entry) => sum + (entry.amount_krw ?? 0), 0) } }); return;
    }
    if (url.pathname === "/api/orders/return" && request.method() === "POST") {
      const body = request.postDataJSON() as Body; harness.writes.push({ path: url.pathname, body });
      if (harness.holdReturn) await new Promise<void>(resolve => { harness.releaseReturn = resolve; });
      if (harness.returnError) { await route.fulfill({ status: 409, json: { error: harness.returnError } }); return; }
      const returnedOrder = harness.orders.find(entry => entry.id === body.orderId)!;
      const submissionIds = returnedOrder.items.map(entry => entry.submissionId!);
      returnedOrder.status = "CANCELED"; returnedOrder.canReturnToCart = false; returnedOrder.returnedAt = "2026-09-08T01:00:00Z";
      harness.items = submissionIds.map(id => item(ids.indexOf(id), { album_draft_group_id: groupId, amount_krw: id === ids[0] ? 35000 : 25000 }));
      await route.fulfill({ json: { ok: true, submissionIds } }); return;
    }
    if (url.pathname === "/api/inicis/submission/order" && request.method() === "POST") {
      harness.writes.push({ path: url.pathname, body: request.postDataJSON() as Body });
      if (harness.cardMode === "reject") { await route.fulfill({ status: 409, json: { error: "주문 상태가 변경되었습니다. 새로고침 후 다시 시도해주세요." } }); return; }
      const closeUrl = `${url.origin}/api/inicis/close?oid=fixture-card&state=${orderIds[0]}`;
      await route.fulfill({ json: { orderId: "fixture-card", stdJsUrl: `${url.origin}/fixture-inicis.js`, stdParams: { oid: "fixture-card", closeUrl }, closeUrl } }); return;
    }
    if (url.pathname === "/fixture-inicis.js") {
      await route.fulfill({ contentType: "application/javascript", body: "window.INIStdPay={pay:function(){window.__fixtureGatewayOpened=true;}};" }); return;
    }
    if (live && ["GET", "HEAD", "OPTIONS"].includes(request.method()) && url.origin === liveOrigin) { await route.continue(); return; }
    harness.unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 409, json: { error: "Unexpected request blocked by commerce UI test." } });
  });
  const path = `${english ? "/en" : ""}/mypage/${view}`;
  await page.goto(live ? path : `http://commerce.test${path}`);
  if (view === "orders") await expect(page.getByRole("button", { name: "새로고침", exact: true })).toBeEnabled();
  else await expect(page.getByText("장바구니를 불러오는 중입니다...", { exact: true })).toHaveCount(0);
  return harness;
}
const expectClean = (harness: Harness) => { expect(harness.errors).toEqual([]); expect(harness.unexpected).toEqual([]); };
const navigation = (page: Page) => page.evaluate(() => (window as unknown as { __commerceNavigation?: string[] }).__commerceNavigation ?? []);
const stored = (page: Page, key: string) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || "[]") as { submissionId: string; guestToken: string }[], key);
const returnButtonContrast = (page: Page) => returnButton(page).evaluate(element => {
  const style = getComputedStyle(element);
  const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
  const context = canvas.getContext("2d")!;
  const luminance = (color: string) => {
    context.fillStyle = color; context.fillRect(0, 0, 1, 1);
    const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
      const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const foreground = luminance(style.color); const background = luminance(style.backgroundColor);
  return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
});

async function verifyMixedCart(page: Page) {
  for (const id of ids.slice(0, 2)) { await expect(select(page, id)).toBeEnabled(); await expect(select(page, id)).toHaveAttribute("aria-pressed", "true"); }
  for (const id of ids.slice(2, 7)) await expect(row(page, id)).toHaveCount(0);
  for (const id of ids.slice(7, 9)) { await expect(select(page, id)).toBeDisabled(); await expect(select(page, id)).toHaveAttribute("aria-pressed", "false"); }
  await expect(page.getByRole("button", { name: "결제 다시 선택", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "주문내역 보기", exact: true })).toHaveAttribute("href", "/mypage/orders");
  await expect(page.locator("aside")).toContainText("60,000원"); await expect(payment(page)).toBeEnabled();
  await page.getByRole("button", { name: "전체 해제", exact: true }).click(); await expect(payment(page)).toBeDisabled();
  await page.getByRole("button", { name: "전체 선택", exact: true }).click(); await expect(payment(page)).toBeEnabled();
}
async function confirmReturn(page: Page, id = orderIds[0]) {
  await returnButton(page, id).click();
  const dialog = page.getByRole("alertdialog", { name: "장바구니로 돌리기" });
  await expect(dialog).toContainText("이 주문에 포함된 신청서를 모두 장바구니로 돌립니다.");
  await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeFocused();
  return dialog;
}

// These tests render production components with only Next navigation replaced;
// member identities vary without creating or impersonating real accounts.
test.describe("isolated commerce account fixtures", () => {
  test.beforeAll(buildIsolatedDocument);
  for (const identity of ["member-a", "member-b", null]) test(`${identity ?? "guest"}: only unpaid items without an order are payable`, async ({ page }) => {
    const harness = await mount(page, { items: mixedItems(), identity }); await verifyMixedCart(page); expect(harness.writes).toHaveLength(0); expectClean(harness);
  });
  test("order polling does not cancel an ongoing slow refresh and retains the returned update", async ({ page }) => {
    const harness = await mount(page, { view: "orders", orders: [bankGroup()], identity: "member-a" });
    await page.clock.install();
    harness.holdOrders = true;
    try {
      await page.getByRole("button", { name: "새로고침", exact: true }).click();
      await expect.poll(() => harness.reads.length).toBe(2);
      await page.clock.fastForward(15_001);
      expect(harness.reads).toHaveLength(2);
      harness.orders[0] = { ...harness.orders[0], status: "PAID", canReturnToCart: false };
      harness.holdOrders = false; harness.releaseOrders?.();
      await expect(page.getByRole("button", { name: "새로고침", exact: true })).toBeEnabled();
      await expect(orderRow(page, orderIds[0])).toContainText("결제 완료");
      expectClean(harness);
    } finally { harness.holdOrders = false; harness.releaseOrders?.(); }
  });
  test("guest cart pruning preserves credentials for previous orders", async ({ page }) => {
    const harness = await mount(page, { items: [item(0, { current_order_id: orderIds[0], payment_status: "PAYMENT_PENDING" })], invalidIds: [ids[0]] });
    await expect(page.getByText("장바구니가 비어 있습니다.", { exact: true })).toBeVisible();
    expect(await stored(page, GUEST_SUBMISSION_CART_STORAGE_KEY)).toEqual([]);
    expect(await stored(page, GUEST_SUBMISSION_ORDERS_STORAGE_KEY)).toEqual([{ submissionId: ids[0], guestToken: tokens[ids[0]] }]); expectClean(harness);
  });
  for (const identity of ["member-a", null]) test(`${identity ?? "guest"}: bank checkout moves the selected album group into orders`, async ({ page }) => {
    const items = [item(0, { album_draft_group_id: groupId }), item(1, { album_draft_group_id: groupId, amount_krw: 25000 })];
    const harness = await mount(page, { items, identity });
    await select(page, ids[0]).click(); for (const id of ids.slice(0, 2)) await expect(select(page, id)).toHaveAttribute("aria-pressed", "false");
    await select(page, ids[1]).click(); for (const id of ids.slice(0, 2)) await expect(select(page, id)).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "무통장 입금", exact: true }).click();
    await expect(page.locator("aside")).toContainText("입금 신청 후 주문내역에서 계좌와 입금 상태를 확인할 수 있습니다.");
    harness.bankError = "이미 주문이 생성된 신청서입니다.";
    await page.getByRole("button", { name: "입금 신청", exact: true }).click();
    const error = page.getByRole("dialog", { name: "확인 필요" }); await expect(error).toContainText(harness.bankError); await error.getByRole("button", { name: "확인", exact: true }).click();
    await expect(select(page, ids[0])).toBeEnabled(); expect(await navigation(page)).toEqual([]);
    harness.bankError = null; await page.getByRole("button", { name: "입금 신청", exact: true }).click();
    await expect(page.getByText("장바구니가 비어 있습니다.", { exact: true })).toBeVisible();
    expect(await navigation(page)).toEqual([`/mypage/orders?focus=${ids[0]}`]);
    expect(harness.writes.at(-1)).toEqual({ path: "/api/cart/bank", body: { submissionIds: ids.slice(0, 2), guestTokensBySubmissionId: identity ? {} : Object.fromEntries(ids.slice(0, 2).map(id => [id, tokens[id]])) } });
    if (!identity) { expect(await stored(page, GUEST_SUBMISSION_CART_STORAGE_KEY)).toEqual([]); expect(await stored(page, GUEST_SUBMISSION_ORDERS_STORAGE_KEY)).toHaveLength(2); } expectClean(harness);
  });
  test("card initialization failure retains the cart; a created order routes cancellation to orders", async ({ page }) => {
    const harness = await mount(page, { items: [item(0)], english: true });
    await payment(page).click(); const error = page.getByRole("dialog", { name: "확인 필요" }); await expect(error).toContainText("주문 상태가 변경되었습니다.");
    await error.getByRole("button", { name: "확인", exact: true }).click(); await expect(select(page, ids[0])).toBeEnabled(); expect(await navigation(page)).toEqual([]);
    harness.cardMode = "open"; await payment(page).click(); await expect(page.getByText("장바구니가 비어 있습니다.", { exact: true })).toBeVisible();
    expect(await stored(page, GUEST_SUBMISSION_CART_STORAGE_KEY)).toEqual([]); expect(await stored(page, GUEST_SUBMISSION_ORDERS_STORAGE_KEY)).toHaveLength(1);
    await page.evaluate(() => window.postMessage({ type: "INICIS:CANCEL" }, window.location.origin));
    await expect.poll(() => navigation(page)).toEqual([`/en/mypage/orders?focus=${ids[0]}`]);
    await page.evaluate(() => window.postMessage({ type: "INICIS:CANCEL" }, window.location.origin));
    expect(await navigation(page)).toHaveLength(1); expectClean(harness);
  });
  for (const identity of ["member-a", null]) test(`${identity ?? "guest"}: order status filters and history remain separate from payment controls`, async ({ page }) => {
    const statuses: SubmissionOrderStatus[] = ["BANK_PENDING", "CARD_PENDING", "PAYPAL_PENDING", "PAID", "FAILED", "CANCELED", "REFUNDED", "REVIEW_REQUIRED"];
    const orders = statuses.map((status, index) => order(index, status));
    orders[2] = { ...orders[2], currency: "USD", amount: 25, amountKrw: null, items: orders[2].items.map(value => ({ ...value, amount: 25, amountKrw: null })) };
    orders[5] = { ...orders[5], returnedAt: "2026-09-08T01:00:00Z", canReturnToCart: false, items: orders[5].items.map(value => ({ ...value, submissionId: null })) };
    const harness = await mount(page, { view: "orders", orders, identity });
    await expect(page.getByRole("article")).toHaveCount(8); await expect(orderRow(page, orderIds[0])).toContainText("입금 계좌");
    expect(await returnButtonContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    expect(await returnButtonContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await expect(orderRow(page, orderIds[2])).toContainText("25 USD");
    await expect(orderRow(page, orderIds[5])).toContainText("기존 주문 이력은 보관됩니다."); await expect(orderRow(page, orderIds[5]).getByRole("link")).toHaveCount(0);
    for (const index of [3, 5, 6, 7]) await expect(returnButton(page, orderIds[index])).toHaveCount(0);
    await expect(payment(page)).toHaveCount(0); await expect(page.getByRole("button", { name: "입금 신청", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "진행", exact: true })).toHaveCount(0);
    for (const [label, count] of [["대기", 4], ["완료", 1], ["실패·취소", 3], ["전체", 8]] as const) {
      await page.getByRole("button", { name: label, exact: true }).click(); await expect(page.getByRole("article")).toHaveCount(count);
    }
    expect(harness.reads[0].method).toBe(identity ? "GET" : "POST");
    if (!identity) expect(harness.reads[0].body?.guestTokensBySubmissionId).toEqual(Object.fromEntries(ids.slice(0, 8).map(id => [id, tokens[id]])));
    expect(harness.writes).toHaveLength(0); expectClean(harness);
  });
  for (const identity of ["member-a", null]) test(`${identity ?? "guest"}: grouped bank return can cancel, reject, then return exactly once`, async ({ page }, testInfo) => {
    const width = identity ? 1280 : 390; await page.setViewportSize({ width, height: 900 });
    const harness = await mount(page, { view: "orders", orders: [bankGroup()], identity });
    let dialog = await confirmReturn(page); await expect(dialog).toContainText("아직 입금하지 않은 경우에만 진행해주세요.");
    await page.screenshot({ path: testInfo.outputPath(`order-return-${width}.png`), fullPage: true, animations: "disabled" });
    await page.keyboard.press("Escape"); expect(harness.writes).toHaveLength(0); await expect(returnButton(page)).toBeFocused();
    harness.returnError = "입금 확인이 완료되어 장바구니로 돌릴 수 없습니다.";
    dialog = await confirmReturn(page); await dialog.getByRole("button", { name: "장바구니로 돌리기", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(harness.returnError); expect(await navigation(page)).toEqual([]);
    await expect(orderRow(page, orderIds[0])).toContainText("입금 대기");
    harness.returnError = null; harness.holdReturn = true;
    try {
      dialog = await confirmReturn(page); await dialog.getByRole("button", { name: "장바구니로 돌리기", exact: true }).click();
      await expect.poll(() => harness.writes.length).toBe(2);
      await expect(orderRow(page, orderIds[0]).getByRole("button", { name: "변경 중", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "새로고침", exact: true })).toBeDisabled();
    } finally { harness.holdReturn = false; harness.releaseReturn?.(); }
    await expect.poll(() => navigation(page)).toEqual([`/mypage/cart?focus=${ids[0]}`]);
    expect(harness.writes.at(-1)).toEqual({ path: "/api/orders/return", body: { orderId: orderIds[0], guestTokensBySubmissionId: identity ? {} : Object.fromEntries(ids.slice(0, 2).map(id => [id, tokens[id]])) } });
    if (!identity) { expect(await stored(page, GUEST_SUBMISSION_CART_STORAGE_KEY)).toHaveLength(2); expect(await stored(page, GUEST_SUBMISSION_ORDERS_STORAGE_KEY)).toHaveLength(2); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width); expectClean(harness);
  });
  test("orders paginate without duplicate history", async ({ page }) => {
    const harness = await mount(page, { view: "orders", orders: [order(0, "PAID"), order(1, "CANCELED"), order(2, "REFUNDED")], identity: "member-a", pageSize: 2 });
    await expect(page.getByRole("article")).toHaveCount(2); await page.getByRole("button", { name: "이전 주문 더 보기", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(3); await expect(page.getByRole("button", { name: "이전 주문 더 보기", exact: true })).toHaveCount(0);
    expect(harness.reads.map(read => read.offset)).toEqual([0, 2]);
    await page.getByRole("button", { name: "새로고침", exact: true }).click(); await expect(page.getByRole("article")).toHaveCount(2); expectClean(harness);
  });
  test("empty guest history requests no private data and exposes no checkout", async ({ page }) => {
    const harness = await mount(page, { view: "orders" });
    await expect(page.getByText("주문 내역이 없습니다.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "비회원 조회 코드로 확인", exact: true })).toHaveAttribute("href", "/track?mode=guest");
    await expect(payment(page)).toHaveCount(0); expect(harness.reads).toHaveLength(0); expect(harness.writes).toHaveLength(0); expectClean(harness);
  });
});

// Public HTML/CSS/JS are real; all commerce data and writes stay intercepted.
// Run on a preview or deployment with NEXT_E2E_BASE_URL.
test.describe("live commerce routes with mocked data and writes", () => {
  test("cart selection excludes orders consistently", async ({ page }) => {
    const harness = await mount(page, { items: mixedItems(), live: true }); await verifyMixedCart(page); expectClean(harness);
  });
  test("bank checkout reaches orders and the explicit return restores its group", async ({ page }) => {
    const harness = await mount(page, { items: [item(0, { album_draft_group_id: groupId }), item(1, { album_draft_group_id: groupId, amount_krw: 25000 })], live: true });
    await expect(payment(page)).toBeEnabled(); await page.getByRole("button", { name: "무통장 입금", exact: true }).click(); await page.getByRole("button", { name: "입금 신청", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/mypage/orders\\?focus=${ids[0]}$`));
    await expect(orderRow(page, orderIds[0])).toContainText("입금 계좌"); expect(await stored(page, GUEST_SUBMISSION_CART_STORAGE_KEY)).toEqual([]);
    const dialog = await confirmReturn(page); await dialog.getByRole("button", { name: "장바구니로 돌리기", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/mypage/cart\\?focus=${ids[0]}$`));
    for (const id of ids.slice(0, 2)) await expect(select(page, id)).toBeEnabled();
    await expect(page.locator("aside")).toContainText("60,000원"); expect(harness.writes.map(write => write.path)).toEqual(["/api/cart/bank", "/api/orders/return"]); expectClean(harness);
  });
  test("mobile orders show bank, card, paid and failed history without overflow", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const harness = await mount(page, { view: "orders", orders: [bankGroup(), order(2, "CARD_PENDING", { canReturnToCart: false }), order(3, "PAID"), order(4, "FAILED")], live: true });
    await expect(page.getByRole("article")).toHaveCount(4); await expect(returnButton(page, orderIds[2])).toHaveCount(0);
    expect(await returnButtonContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: testInfo.outputPath("orders-390.png"), fullPage: true, animations: "disabled" });
    const dialog = await confirmReturn(page); await page.screenshot({ path: testInfo.outputPath("orders-return-confirm-390.png"), fullPage: true, animations: "disabled" });
    await dialog.getByRole("button", { name: "취소", exact: true }).click(); expect(harness.writes).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390); expectClean(harness);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.screenshot({ path: testInfo.outputPath("orders-1280.png"), fullPage: true, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
  });
});
