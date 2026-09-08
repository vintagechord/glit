import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SubmissionCartItem } from "../../src/lib/submission-cart";
import { GUEST_SUBMISSION_CART_STORAGE_KEY } from "../../src/lib/guest-submission-cart";

const ids = Array.from({ length: 6 }, (_, index) => `${index + 1}1111111-1111-4111-8111-111111111111`);
const tokens = Object.fromEntries(ids.map((id, index) => [id, `cart-guest-fixture-${index + 1}`]));
const groupId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const item = (index: number, overrides: Partial<SubmissionCartItem> = {}): SubmissionCartItem => ({
  id: ids[index], type: "ALBUM", status: "SUBMITTED", payment_status: "UNPAID", payment_method: "CARD",
  title: `검증 앨범 ${index + 1}`, artist_name: "검증 아티스트", amount_krw: 35000,
  created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z", package: { name: "3개 패키지" }, ...overrides,
});
const bankItems = () => [
  item(0, { status: "WAITING_PAYMENT", payment_status: "PAYMENT_PENDING", payment_method: "BANK", album_draft_group_id: groupId }),
  item(1, { status: "WAITING_PAYMENT", payment_status: "PAYMENT_PENDING", payment_method: "BANK", album_draft_group_id: groupId, amount_krw: 25000 }),
  item(2, { status: "WAITING_PAYMENT", payment_status: "PAYMENT_PENDING", payment_method: "BANK", amount_krw: 15000 }),
];
const mixedItems = () => [
  item(0, { payment_status: "PAYMENT_PENDING" }),
  item(1, { payment_status: "PAYMENT_PENDING", payment_method: "BANK" }),
  item(2, { payment_status: "PAYMENT_PENDING", payment_method: null }),
  item(3, { amount_krw: null }),
  item(4, { amount_krw: 25000 }),
  item(5, { amount_krw: 0 }),
];
const row = (page: Page, id: string) => page.locator(`#cart-item-${id}`);
const select = (page: Page, id: string) => row(page, id).locator("button[aria-pressed]");
const reopen = (page: Page, id: string) => row(page, id).getByRole("button", { name: "결제 다시 선택", exact: true });
const payment = (page: Page) => page.getByRole("button", { name: "결제하기", exact: true });

type Write = { path: string; body: { submissionIds: string[]; guestTokensBySubmissionId: Record<string, string> } };
type Harness = {
  items: SubmissionCartItem[]; writes: Write[]; unexpected: string[]; errors: string[];
  reopenError: string | null; holdReopen: boolean; releaseReopen?: () => void;
};
let isolatedDocument = "";
async function buildIsolatedDocument() {
  const [bundle, styles] = await Promise.all([
    build({
      stdin: { contents: `import React from "react"; import { createRoot } from "react-dom/client"; import { SubmissionCartCheckout } from "./src/components/dashboard/submission-cart-checkout"; createRoot(document.getElementById("cart-root")).render(<SubmissionCartCheckout {...window.__cartFixture} />);`, resolveDir: process.cwd(), loader: "tsx" },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": '{"NODE_ENV":"production"}' },
      plugins: [{ name: "test-navigation-only", setup(builder) {
        builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: "test-next" }));
        builder.onLoad({ filter: /.*/, namespace: "test-next" }, args => ({ resolveDir: process.cwd(), loader: "js", contents: args.path === "next/navigation"
          ? `const router={push(){},refresh(){window.__cartRefreshes=(window.__cartRefreshes||0)+1}}; const params=new URLSearchParams(); export const useRouter=()=>router; export const usePathname=()=>"/mypage/cart"; export const useSearchParams=()=>params;`
          : `import React from "react"; export default function Link({children,...props}){return React.createElement("a",props,children)}` }));
      } }],
    }),
    readFile(resolve("src/app/globals.css"), "utf8").then(css => postcss([tailwind()]).process(css, { from: resolve("src/app/globals.css") })),
  ]);
  isolatedDocument = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles.css}</style></head><body><main style="max-width:1152px;margin:auto;padding:16px"><h1>장바구니</h1><div id="cart-root"></div></main><script>window.__cartFixture=__FIXTURE_JSON__;</script><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}

// Intercept every write, including guest cart reads (POST), draft claims and PG
// calls. The live-route cases use the real Next page but never write real data.
async function mount(page: Page, items: SubmissionCartItem[], identity: string | null = null, live = false): Promise<Harness> {
  const harness: Harness = { items: structuredClone(items), writes: [], unexpected: [], errors: [], reopenError: null, holdReopen: false };
  page.on("pageerror", error => harness.errors.push(error.message));
  await page.addInitScript(({ entries, key }) => {
    if (entries.length) localStorage.setItem(key, JSON.stringify(entries)); else localStorage.removeItem(key);
    const state = window as unknown as { __cartEvents: number };
    state.__cartEvents = 0;
    window.addEventListener("onside:cart-updated", () => { state.__cartEvents += 1; });
  }, { entries: identity ? [] : items.map(entry => ({ submissionId: entry.id, guestToken: tokens[entry.id] })), key: GUEST_SUBMISSION_CART_STORAGE_KEY });
  await page.context().route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (!live && request.resourceType() === "document") {
      const fixture = JSON.stringify({ userId: identity, initialItems: identity ? harness.items : [] }).replace(/</g, "\\u003c");
      await route.fulfill({ contentType: "text/html", body: isolatedDocument.replace("__FIXTURE_JSON__", fixture) }); return;
    }
    if (url.pathname === "/api/cart/items" && request.method() === "POST") {
      await route.fulfill({ json: { items: harness.items, invalidSubmissionIds: [] } }); return;
    }
    if (url.pathname === "/api/cart/reopen" && request.method() === "POST") {
      const body = request.postDataJSON() as Write["body"];
      harness.writes.push({ path: url.pathname, body });
      if (harness.holdReopen) await new Promise<void>(resolve => { harness.releaseReopen = resolve; });
      if (harness.reopenError) { await route.fulfill({ status: 409, json: { error: harness.reopenError } }); return; }
      harness.items = harness.items.map(entry => body.submissionIds.includes(entry.id) ? { ...entry, status: "SUBMITTED", payment_status: "UNPAID" } : entry);
      await route.fulfill({ json: { ok: true, reopenedIds: body.submissionIds } }); return;
    }
    if (url.pathname === "/api/cart/bank" && request.method() === "POST") {
      const body = request.postDataJSON() as Write["body"];
      harness.writes.push({ path: url.pathname, body });
      const chosen = harness.items.filter(entry => body.submissionIds.includes(entry.id));
      harness.items = harness.items.map(entry => body.submissionIds.includes(entry.id) ? { ...entry, status: "WAITING_PAYMENT", payment_status: "PAYMENT_PENDING", payment_method: "BANK" } : entry);
      await route.fulfill({ json: { count: chosen.length, totalAmountKrw: chosen.reduce((sum, entry) => sum + (entry.amount_krw ?? 0), 0) } }); return;
    }
    if (live && ["GET", "HEAD", "OPTIONS"].includes(request.method())) { await route.continue(); return; }
    harness.unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 409, json: { error: "Unexpected request blocked by cart UI test." } });
  });
  await page.goto(live ? "/mypage/cart" : "http://cart.test/mypage/cart");
  await expect(select(page, items[0].id)).toBeVisible();
  return harness;
}
const expectClean = (harness: Harness) => { expect(harness.errors).toEqual([]); expect(harness.unexpected).toEqual([]); };

async function verifyMixedCart(page: Page) {
  for (const id of [ids[0], ids[4]]) { await expect(select(page, id)).toBeEnabled(); await expect(select(page, id)).toHaveAttribute("aria-pressed", "true"); }
  for (const id of [ids[1], ids[2], ids[3], ids[5]]) { await expect(select(page, id)).toBeDisabled(); await expect(select(page, id)).toHaveAttribute("aria-pressed", "false"); }
  await expect(row(page, ids[0])).not.toContainText("입금 확인 중");
  await expect(row(page, ids[0]).getByRole("link", { name: /수정$/ })).toHaveCount(0);
  await expect(reopen(page, ids[1])).toBeEnabled();
  await expect(reopen(page, ids[2])).toHaveCount(0);
  await expect(page.locator("aside")).toContainText("60,000원");
  await expect(payment(page)).toBeEnabled();
  await page.getByRole("button", { name: "전체 해제", exact: true }).click(); await expect(payment(page)).toBeDisabled();
  await page.getByRole("button", { name: "전체 선택", exact: true }).click(); await expect(payment(page)).toBeEnabled();
  await expect(select(page, ids[1])).toHaveAttribute("aria-pressed", "false");
}

async function confirmBankReopen(page: Page) {
  await reopen(page, ids[0]).click();
  const dialog = page.getByRole("alertdialog", { name: "결제 다시 선택" });
  await expect(dialog).toContainText("같은 신청서의 앨범 2건이 함께 변경됩니다.");
  await expect(dialog).toContainText("아직 입금하지 않았다면");
  await expect(dialog).toContainText("이미 입금했다면 입금 확인을 기다려주세요.");
  return dialog;
}
async function verifyReopenedGroup(page: Page, harness: Harness, guest: boolean) {
  for (const id of ids.slice(0, 2)) { await expect(select(page, id)).toBeEnabled(); await expect(select(page, id)).toHaveAttribute("aria-pressed", "true"); await expect(reopen(page, id)).toHaveCount(0); }
  await expect(select(page, ids[2])).toBeDisabled();
  await expect(payment(page)).toBeEnabled();
  await expect(page.locator("aside")).toContainText("60,000원");
  const last = harness.writes.at(-1)!;
  expect(last.path).toBe("/api/cart/reopen");
  expect(last.body).toEqual({ submissionIds: ids.slice(0, 2), guestTokensBySubmissionId: guest ? Object.fromEntries(ids.slice(0, 2).map(id => [id, tokens[id]])) : {} });
  expect(await page.evaluate(() => (window as unknown as { __cartEvents: number }).__cartEvents)).toBe(1);
}

test.describe("isolated cart account fixtures", () => {
  test.beforeAll(buildIsolatedDocument);
  for (const identity of ["member-a", "member-b", null]) test(`${identity ?? "guest"} uses payment state, not account identity, for selection`, async ({ page }) => {
    const harness = await mount(page, mixedItems(), identity); await verifyMixedCart(page); expect(harness.writes).toHaveLength(0); expectClean(harness);
  });
  for (const identity of ["member-a", null]) test(`${identity ?? "guest"} bank group can cancel, reject, then explicitly reopen`, async ({ page }, testInfo) => {
    const width = identity ? 1280 : 390; await page.setViewportSize({ width, height: 900 });
    const harness = await mount(page, bankItems(), identity); await expect(payment(page)).toBeDisabled();
    const dialog = await confirmBankReopen(page);
    await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`reopen-confirm-${width}.png`), fullPage: true, animations: "disabled" });
    await dialog.getByRole("button", { name: "취소", exact: true }).click(); expect(harness.writes).toHaveLength(0);
    await expect(select(page, ids[0])).toBeDisabled();
    harness.reopenError = "입금 확인이 완료되어 결제 수단을 변경할 수 없습니다.";
    await (await confirmBankReopen(page)).getByRole("button", { name: "결제 다시 선택", exact: true }).click();
    const error = page.getByRole("dialog", { name: "확인 필요" }); await expect(error).toContainText(harness.reopenError);
    await error.getByRole("button", { name: "확인", exact: true }).click(); await expect(select(page, ids[0])).toBeDisabled(); await expect(payment(page)).toBeDisabled();
    expect(harness.items.slice(0, 2).every(entry => entry.payment_status === "PAYMENT_PENDING")).toBe(true);
    harness.reopenError = null; harness.holdReopen = true;
    try {
      await page.getByRole("button", { name: "무통장 입금", exact: true }).click();
      await (await confirmBankReopen(page)).getByRole("button", { name: "결제 다시 선택", exact: true }).click();
      await expect.poll(() => harness.writes.length).toBe(2);
      await expect(row(page, ids[0]).getByRole("button", { name: "변경 중", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "입금 신청", exact: true })).toBeDisabled();
    } finally { harness.holdReopen = false; harness.releaseReopen?.(); }
    await verifyReopenedGroup(page, harness, !identity);
    expect(await page.evaluate(() => (window as unknown as { __cartRefreshes: number }).__cartRefreshes)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`reopened-${width}.png`), fullPage: true, animations: "disabled" });
    await page.reload(); await expect(select(page, ids[0])).toBeEnabled(); await expect(select(page, ids[2])).toBeDisabled(); expectClean(harness);
  });
  test("requesting bank transfer from an unpaid card selection immediately locks it until reopening", async ({ page }) => {
    const harness = await mount(page, [item(0, { payment_status: "UNPAID", payment_method: "CARD" })], "member-a");
    await expect(payment(page)).toBeEnabled(); await page.getByRole("button", { name: "무통장 입금", exact: true }).click();
    await page.getByRole("button", { name: "입금 신청", exact: true }).click();
    const success = page.getByRole("dialog", { name: "완료" }); await expect(success).toContainText("입금 신청이 완료되었습니다.");
    await success.getByRole("button", { name: "확인", exact: true }).click();
    await expect(select(page, ids[0])).toBeDisabled(); await expect(reopen(page, ids[0])).toBeEnabled();
    await expect(page.getByRole("button", { name: "입금 신청", exact: true })).toBeDisabled(); expectClean(harness);
  });
});

// These three cases can also run against a deployment via NEXT_E2E_BASE_URL.
// All cart data and writes stay intercepted; public server HTML/CSS/JS is real.
test.describe("live cart route with mocked data and writes", () => {
  test("card pending remains selectable while bank and unknown pending remain locked", async ({ page }) => {
    const harness = await mount(page, mixedItems(), null, true); await verifyMixedCart(page); expect(harness.writes).toHaveLength(0); expectClean(harness);
  });
  test("bank request reopens only the confirmed album group", async ({ page }) => {
    const harness = await mount(page, bankItems(), null, true);
    const dialog = await confirmBankReopen(page); expect(harness.writes).toHaveLength(0);
    await dialog.getByRole("button", { name: "결제 다시 선택", exact: true }).click();
    await verifyReopenedGroup(page, harness, true); expectClean(harness);
  });
  test("mobile bank recovery fits a 390px viewport", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const harness = await mount(page, bankItems(), null, true);
    await page.screenshot({ path: testInfo.outputPath("cart-bank-pending-390.png"), fullPage: true, animations: "disabled" });
    const dialog = await confirmBankReopen(page);
    await page.screenshot({ path: testInfo.outputPath("cart-reopen-confirm-390.png"), fullPage: true, animations: "disabled" });
    await dialog.getByRole("button", { name: "결제 다시 선택", exact: true }).click(); await verifyReopenedGroup(page, harness, true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath("cart-reopened-390.png"), fullPage: true, animations: "disabled" }); expectClean(harness);
  });
});
