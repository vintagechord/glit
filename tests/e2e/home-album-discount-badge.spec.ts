import { expect, test } from "@playwright/test";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// 2026-11-16 (owner): the half-price badge sits in the top-right corner of
// the home 음반 심의 card, as it does on the application page, instead of
// taking a line under the title.
const BADGE = "2번째 앨범부터 50% 할인";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }]) {
  test(`the home album card carries its discount badge in the top-right corner at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const cards = page.locator("a[data-scroll-reveal]").filter({ has: page.getByRole("heading", { level: 3 }) });
    await expect(cards).toHaveCount(3);
    const album = cards.filter({ hasText: BADGE });
    await album.scrollIntoViewIfNeeded();
    // Scroll reveal: wait until the card has finished sliding in.
    await expect(album).toHaveAttribute("data-reveal-state", "visible");
    await page.waitForTimeout(1200);

    const badge = album.getByText(BADGE, { exact: true });
    await expect(badge).toBeVisible();
    const [card, mark, title, icon] = await Promise.all([
      album.boundingBox(), badge.boundingBox(),
      album.getByRole("heading", { level: 3 }).boundingBox(), album.locator("svg").first().locator("xpath=..").boundingBox(),
    ]);
    if (!card || !mark || !title || !icon) throw new Error("layout box missing");

    // Top-right corner: on the card's top edge, by its right side.
    expect(mark.y).toBeLessThanOrEqual(card.y + 4);
    expect(mark.y + mark.height).toBeGreaterThan(card.y);
    expect(card.x + card.width - (mark.x + mark.width)).toBeGreaterThanOrEqual(8);
    expect(card.x + card.width - (mark.x + mark.width)).toBeLessThanOrEqual(32);
    expect(mark.x).toBeGreaterThanOrEqual(card.x);
    // It covers neither the icon tile nor the title.
    expect(mark.y + mark.height).toBeLessThanOrEqual(icon.y);
    expect(mark.y + mark.height).toBeLessThan(title.y);

    // Without the extra line the three cards read alike: title, then the button.
    const heights = await cards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
    expect(new Set(heights).size).toBe(1);
    const gaps = await cards.evaluateAll((nodes) => nodes.map((node) => {
      const heading = node.querySelector("h3")!.getBoundingClientRect();
      const action = node.querySelector("h3")!.parentElement!.lastElementChild!.getBoundingClientRect();
      return Math.round(action.top - heading.bottom);
    }));
    expect(new Set(gaps).size).toBe(1);

    const shot = testInfo.outputPath(`home-badge-${viewport.width}.png`);
    await page.screenshot({ path: shot });
    const kept = resolve(`tmp/shots/home-badge-corner/home-${viewport.width}.png`);
    await mkdir(dirname(kept), { recursive: true });
    await copyFile(shot, kept);
  });
}
