import { expect, test } from "@playwright/test";

// Only public routes, with all writes blocked: no draft creation, payment,
// account change or message can escape this regression test.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => ["GET", "HEAD", "OPTIONS"].includes(route.request().method())
    ? route.continue()
    : route.fulfill({ status: 409, json: { error: "Public language audit blocks writes" } }));
});

const routes = [
  "/en", "/en/dashboard/new", "/en/dashboard/new/album",
  "/en/dashboard/new/mv?type=distribution", "/en/dashboard/new/mv?type=broadcast",
  "/en/guide", "/en/faq", "/en/support", "/en/track", "/en/login",
  "/en/mypage/cart", "/en/mypage/orders",
];

for (const width of [390, 1280]) for (const route of routes) {
  test(`English public review UI is complete and fits ${width}px: ${route}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect.poll(() => page.evaluate(() => {
      const values: string[] = [];
      const skip = 'script,style,noscript,textarea,code,pre,[data-no-translate],[translate="no"],[contenteditable]:not([contenteditable="false"])';
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || parent.closest(skip) || !parent.getClientRects().length || getComputedStyle(parent).visibility === "hidden") continue;
        if (/[가-힣]/.test(node.textContent ?? "")) values.push((node.textContent ?? "").trim());
      }
      for (const element of document.querySelectorAll<HTMLElement>('[placeholder],[aria-label],[title]')) {
        if (element.closest(skip) || !element.getClientRects().length) continue;
        for (const attr of ["placeholder", "aria-label", "title"]) {
          if (element.getAttribute("data-no-translate-attributes")?.split(/[\s,]+/).includes(attr)) continue;
          const text = element.getAttribute(attr) ?? "";
          if (/[가-힣]/.test(text)) values.push(`${attr}: ${text}`);
        }
      }
      return [...new Set(values)].filter(Boolean);
    }), { timeout: 15_000 }).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    expect(errors).toEqual([]);
  });
}
