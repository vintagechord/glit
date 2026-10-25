import { devices, expect, test, type Page } from "@playwright/test";
import { GUEST_SUBMISSION_CART_STORAGE_KEY } from "../../src/lib/guest-submission-cart";
import { INICIS_MOBILE_UNAVAILABLE_MESSAGE } from "../../src/lib/inicis/device";

const submissionId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const guestToken = "mobile-checkout-fixture-token";
const item = {
  id: submissionId, type: "ALBUM", status: "SUBMITTED", payment_status: "UNPAID", payment_method: "CARD", current_order_id: null,
  title: "모바일 결제 점검 음반", artist_name: "테스트 아티스트", amount_krw: 49000,
  created_at: "2026-10-16T00:00:00Z", updated_at: "2026-10-16T00:00:00Z", package: { name: "음반 심의" },
};

async function guardServices(page: Page, origin: string) {
  const writes: string[] = [], unexpected: string[] = [], gateway: string[] = [], errors: string[] = [];
  let bankSelected = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ key, submissionId, guestToken }) => {
    localStorage.setItem(key, JSON.stringify([{ submissionId, guestToken }]));
  }, { key: GUEST_SUBMISSION_CART_STORAGE_KEY, submissionId, guestToken });
  await page.context().route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname.endsWith("inicis.com")) {
      gateway.push(request.url()); await route.abort(); return;
    }
    if (url.pathname === "/api/cart/items") {
      await route.fulfill({ json: { items: bankSelected ? [] : [item] } }); return;
    }
    if (url.pathname === "/api/cart/bank") {
      writes.push(url.pathname);
      expect(request.postDataJSON()).toEqual({ submissionIds: [submissionId], guestTokensBySubmissionId: { [submissionId]: guestToken } });
      bankSelected = true;
      await route.fulfill({ json: { count: 1, totalAmountKrw: 49000 } }); return;
    }
    if (url.pathname === "/api/orders") {
      await route.fulfill({ json: { orders: bankSelected ? [{
        id: orderId, status: "BANK_PENDING", paymentMethod: "BANK", amountKrw: 49000, amount: 49000, currency: "KRW", source: "live", note: null,
        createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-16T00:00:00Z", paidAt: null, returnedAt: null, canReturnToCart: true,
        items: [{ id: "fixture-item", submissionId, submissionRef: submissionId, type: "ALBUM", title: item.title, artistName: item.artist_name, packageName: "음반 심의", amountKrw: 49000, amount: 49000, isOneclick: false }],
      }] : [], nextOffset: null } }); return;
    }
    if (url.origin === origin && ["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      await route.continue(); return;
    }
    if (url.origin !== origin && ["GET", "HEAD"].includes(request.method())) {
      await route.fulfill({ status: 404, body: "External request blocked" }); return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 409, json: { error: "Unexpected mutation blocked" } });
  });
  return { writes, unexpected, gateway, errors };
}

test.describe("mobile checkout uses the available bank route without opening PC STDPay", () => {
  test.use({ userAgent: devices["iPhone 13"].userAgent, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("actual cart defaults to bank payment and completes the mocked bank selection", async ({ page, baseURL }, testInfo) => {
    const effects = await guardServices(page, new URL(baseURL!).origin);
    await page.goto("/mypage/cart");
    // The cart first lists the selection; payment methods appear on the payment step.
    await page.getByRole("button", { name: "결제하기", exact: true }).click();
    await expect(page.getByRole("button", { name: "카드 결제 · PC에서 이용", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "무통장 입금", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(INICIS_MOBILE_UNAVAILABLE_MESSAGE, { exact: true })).toBeVisible();
    const bank = page.getByRole("button", { name: "입금 신청", exact: true });
    await expect(bank).toBeEnabled();
    expect(effects.writes).toEqual([]);
    expect(effects.gateway).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath("mobile-card-guidance.png"), fullPage: true });
    await bank.click();
    await expect(page).toHaveURL(new RegExp(`/mypage/orders\\?focus=${submissionId}$`));
    await expect(page.locator(`#order-${orderId}`)).toContainText("입금 대기");
    expect(effects.writes).toEqual(["/api/cart/bank"]);
    expect(effects.gateway).toEqual([]);
    expect(effects.unexpected).toEqual([]);
    expect(effects.errors).toEqual([]);
  });

  test("a direct popup URL explains the available method before any order or SDK call", async ({ page, baseURL }) => {
    const effects = await guardServices(page, new URL(baseURL!).origin);
    await page.goto(`/pay/inicis/popup?context=music&submissionId=${submissionId}`);
    await expect(page.getByText(INICIS_MOBILE_UNAVAILABLE_MESSAGE, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "장바구니에서 결제 방법 선택" })).toHaveAttribute("href", "/mypage/cart");
    expect(effects.writes).toEqual([]);
    expect(effects.gateway).toEqual([]);
    expect(effects.unexpected).toEqual([]);
    expect(effects.errors).toEqual([]);
  });
});
