import { devices, expect, test, type Page } from "@playwright/test";
import { GUEST_SUBMISSION_CART_STORAGE_KEY } from "../../src/lib/guest-submission-cart";
import { INICIS_MOBILE_REDIRECT_MESSAGE } from "../../src/lib/inicis/device";

// The dev server for this spec runs with INICIS_MOBILE_HASH_KEY_PROD set, so
// phones are offered the INIpayMobile card flow next to bank transfer.
const submissionId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const pgOrderId = "SUBP-1761900000000-11111111-abcdef12";
const guestToken = "mobile-checkout-fixture-token";
const mobileGateway = "https://stgmobile.inicis.com/smart/payment/";
const item = {
  id: submissionId, type: "ALBUM", status: "SUBMITTED", payment_status: "UNPAID", payment_method: "CARD", current_order_id: null,
  title: "모바일 결제 점검 음반", artist_name: "테스트 아티스트", amount_krw: 49000,
  created_at: "2026-10-16T00:00:00Z", updated_at: "2026-10-16T00:00:00Z", package: { name: "음반 심의" },
};
const mobileInit = {
  orderId: pgOrderId, channel: "mobile",
  mobile: { actionUrl: mobileGateway, params: { P_INI_PAYMENT: "CARD", P_MID: "fixturemid", P_OID: pgOrderId, P_AMT: "49000", P_GOODS: "음반 심의", P_UNAME: "테스트", P_NEXT_URL: "https://onside.test/api/inicis/mobile/return", P_NOTI: `${pgOrderId}_0f7b2f6e-7f41-4c2a-9c3e-3b2a1d4e5f60`, P_RESERVED: "centerCd=Y&amt_hash=Y", P_CHARSET: "utf8", P_TIMESTAMP: "1761900000000", P_CHKFAKE: "fixture" } },
  closeUrl: "/api/inicis/close?oid=" + pgOrderId + "&state=0f7b2f6e-7f41-4c2a-9c3e-3b2a1d4e5f60&cancel=1",
};

async function guardServices(page: Page, origin: string) {
  const writes: Array<{ path: string; body: unknown }> = [], unexpected: string[] = [], errors: string[] = [];
  const gateway: Array<{ url: string; method: string; postData: string | null }> = [];
  let bankSelected = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ key, submissionId, guestToken }) => {
    localStorage.setItem(key, JSON.stringify([{ submissionId, guestToken }]));
  }, { key: GUEST_SUBMISSION_CART_STORAGE_KEY, submissionId, guestToken });
  await page.context().route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname.endsWith("inicis.com")) {
      gateway.push({ url: request.url(), method: request.method(), postData: request.postData() });
      await route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>gateway fixture</body></html>" }); return;
    }
    if (url.pathname === "/api/cart/items") {
      await route.fulfill({ json: { items: bankSelected ? [] : [item] } }); return;
    }
    if (url.pathname === "/api/cart/bank") {
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push({ path: url.pathname, body });
      bankSelected = true;
      await route.fulfill({ json: { count: 1, totalAmountKrw: 49000 } }); return;
    }
    if (url.pathname === "/api/inicis/submission/order") {
      writes.push({ path: url.pathname, body: request.postDataJSON() });
      await route.fulfill({ json: mobileInit }); return;
    }
    if (url.pathname === "/api/inicis/close") {
      // React dev mode runs the popup effect twice; the cancelled first order is closed.
      writes.push({ path: url.pathname, body: null });
      await route.fulfill({ status: 200, headers: { "X-Inicis-Cancellation-Persisted": "true" }, body: "" }); return;
    }
    if (url.pathname === "/api/orders") {
      await route.fulfill({ json: { orders: bankSelected ? [{
        id: orderId, status: "BANK_PENDING", paymentMethod: "BANK", amountKrw: 49000, amount: 49000, currency: "KRW", source: "live", note: null,
        createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-16T00:00:00Z", paidAt: null, returnedAt: null, canReturnToCart: true,
        depositorName: "홍길동", depositDueAt: "2099-01-01T14:59:59.000Z",
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

test.describe("mobile checkout offers INIpayMobile card payment and bank transfer", () => {
  test.use({ userAgent: devices["iPhone 13"].userAgent, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("card payment leaves for the mobile gateway with a top-level EUC-KR form", async ({ page, baseURL }, testInfo) => {
    const effects = await guardServices(page, new URL(baseURL!).origin);
    await page.goto("/mypage/cart");
    await page.getByRole("button", { name: "결제하기", exact: true }).click();
    const card = page.getByRole("button", { name: "카드 결제", exact: true });
    await expect(card).toBeEnabled();
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(INICIS_MOBILE_REDIRECT_MESSAGE, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath("mobile-card-choice.png"), fullPage: true });
    await page.getByRole("button", { name: "결제하기", exact: true }).click();
    await expect.poll(() => effects.gateway.length).toBe(1);
    expect(effects.gateway[0].url).toBe(mobileGateway);
    expect(effects.gateway[0].method).toBe("POST");
    const posted = new URLSearchParams(effects.gateway[0].postData ?? "");
    expect(posted.get("P_INI_PAYMENT")).toBe("CARD");
    expect(posted.get("P_OID")).toBe(pgOrderId);
    expect(posted.get("P_RESERVED")).toBe("centerCd=Y&amt_hash=Y");
    expect(effects.writes).toEqual([{ path: "/api/inicis/submission/order", body: expect.objectContaining({ submissionId, channel: "mobile", context: "music" }) }]);
    expect(effects.unexpected).toEqual([]);
    expect(effects.errors).toEqual([]);
  });

  test("bank transfer collects the depositor name and expected deposit date", async ({ page, baseURL }) => {
    const effects = await guardServices(page, new URL(baseURL!).origin);
    await page.goto("/mypage/cart");
    await page.getByRole("button", { name: "결제하기", exact: true }).click();
    await page.getByRole("button", { name: "무통장 입금", exact: true }).click();
    const bank = page.getByRole("button", { name: "입금 신청", exact: true });
    await bank.click();
    const notice = page.getByRole("dialog", { name: "확인 필요" });
    await expect(notice).toContainText("입금자명을 입력해주세요.");
    await notice.getByRole("button", { name: "확인", exact: true }).click();
    expect(effects.writes).toEqual([]);
    await page.getByLabel("입금자명").fill("홍길동");
    await expect(page.getByLabel("입금 예정일")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await bank.click();
    await expect(page).toHaveURL(new RegExp(`/mypage/orders\\?focus=${submissionId}$`));
    await expect(page.locator(`#order-${orderId}`)).toContainText("입금 대기");
    await expect(page.locator(`#order-${orderId}`)).toContainText("홍길동");
    await expect(page.locator(`#order-${orderId}`)).toContainText("2099-01-01");
    expect(effects.writes).toEqual([{ path: "/api/cart/bank", body: { submissionIds: [submissionId], guestTokensBySubmissionId: { [submissionId]: guestToken }, depositorName: "홍길동", depositDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), cashReceipt: null } }]);
    expect(effects.gateway).toEqual([]);
    expect(effects.unexpected).toEqual([]);
    expect(effects.errors).toEqual([]);
  });

  test("a direct popup URL on a phone also hands off to the mobile gateway", async ({ page, baseURL }) => {
    const effects = await guardServices(page, new URL(baseURL!).origin);
    await page.goto(`/pay/inicis/popup?context=music&submissionId=${submissionId}`);
    await expect.poll(() => effects.gateway.length).toBe(1);
    expect(effects.gateway[0].url).toBe(mobileGateway);
    const orderWrites = effects.writes.filter((write) => write.path === "/api/inicis/submission/order");
    expect(orderWrites.length).toBeGreaterThanOrEqual(1);
    for (const write of orderWrites) expect(write.body).toEqual(expect.objectContaining({ submissionId, channel: "mobile" }));
    expect(effects.writes.every((write) => ["/api/inicis/submission/order", "/api/inicis/close"].includes(write.path))).toBe(true);
    expect(effects.unexpected).toEqual([]);
    expect(effects.errors).toEqual([]);
  });
});
