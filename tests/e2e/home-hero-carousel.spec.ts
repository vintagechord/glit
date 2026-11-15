import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// 2026-11-16 (owner): the home banner is a carousel of the banners set under
// 메인 배너 관리. It advances by itself, visitors can move it, and the two new
// banners (released-album URL, MV certificate) fit the box the brand banner
// has. The component is bundled on its own; no server or database is reached.
let html: string;
test.beforeAll(async () => {
  const [bundle, css] = await Promise.all([
    build({
      stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {HomeHeroBanner} from './src/components/site/home-hero-banner';
        import {DEFAULT_HERO_SLIDES} from './src/lib/home-hero-banners';
        document.documentElement.setAttribute('data-js','');
        if (location.pathname.startsWith('/en')) document.documentElement.lang = 'en';
        createRoot(document.getElementById('root')).render(<main style={{padding:16,display:'grid',gap:24}}>
          <div id="main"><HomeHeroBanner slides={DEFAULT_HERO_SLIDES} intervalSeconds={60}/></div>
          <div id="auto"><HomeHeroBanner slides={DEFAULT_HERO_SLIDES} intervalSeconds={1}/></div>
          <div id="single"><HomeHeroBanner slides={[DEFAULT_HERO_SLIDES[0]]} intervalSeconds={1}/></div>
        </main>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": '{"NODE_ENV":"production"}' },
      plugins: [{ name: "isolated-hero", setup(builder) {
        builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
          args.path === "next/navigation"
            ? `export const usePathname=()=>location.pathname;export const useRouter=()=>({push(){},replace(){},prefetch(){},refresh(){}});`
            : `import React from 'react'; export default function Link({children,prefetch,replace,scroll,...props}){return <a {...props}>{children}</a>}`,
        }));
      } }],
    }),
    readFile(resolve("src/app/globals.css"), "utf8").then(source => postcss([tailwind()]).process(source, { from: resolve("src/app/globals.css") })),
  ]);
  html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

async function open(page: Page, width: number, path = "/") {
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html; charset=utf-8", body: html }) : route.fulfill({ status: 404 }));
  await page.goto(path);
  await expect(page.locator("#main [data-hero-slide]")).toHaveCount(4);
}

// "배너 2 / 4" → "2/4"
const position = (page: Page, scope: string) => page.locator(`${scope} .onside-hero-count`).innerText().then(text => text.replace(/[^\d/]/g, ""));
const activeDesign = (page: Page, scope: string) => page.locator(`${scope} [data-hero-slide][data-active]`).getAttribute("data-hero-design");

for (const width of [572, 390, 320]) {
  test(`the four banners share the brand banner's box and keep their headlines clear at ${width}px`, async ({ page }, testInfo) => {
    await open(page, width);
    const boxes = await page.evaluate(() => ["#main", "#single"].map(scope => {
      const box = document.querySelector(`${scope} .onside-hero-banner`)!.getBoundingClientRect();
      return [Math.round(box.width), Math.round(box.height)];
    }));
    expect(boxes[0]).toEqual(boxes[1]);

    const next = page.locator("#main").getByRole("button", { name: "다음 메인 배너" });
    for (const design of ["record", "url", "certificate", "reasons"]) {
      await expect.poll(() => activeDesign(page, "#main")).toBe(design);
      await page.waitForTimeout(design === "url" ? 2600 : 500);
      const report = await page.evaluate(() => {
        const slide = document.querySelector<HTMLElement>("#main [data-hero-slide][data-active]")!;
        const rect = (selector: string) => slide.querySelector(selector)?.getBoundingClientRect() ?? null;
        const title = slide.querySelector<HTMLElement>(".onside-hero-title")!;
        const lines = Array.from(title.querySelectorAll("span"));
        const frame = slide.getBoundingClientRect();
        return {
          lines: lines.length,
          lineOverflow: Math.max(...lines.map(line => line.scrollWidth - line.clientWidth)),
          titleRight: title.getBoundingClientRect().right,
          titleInside: title.getBoundingClientRect().right <= frame.right && title.getBoundingClientRect().left >= frame.left,
          paperLeft: rect(".onside-hero-cert-paper")?.left ?? null,
          jacketLeft: rect(".onside-hero-jacket-art")?.left ?? null,
          field: rect(".onside-hero-url") ? { left: rect(".onside-hero-url")!.left - frame.left, right: frame.right - rect(".onside-hero-url")!.right, bottom: frame.bottom - rect(".onside-hero-url")!.bottom } : null,
          doneOpacity: slide.querySelector(".onside-hero-url-done") ? getComputedStyle(slide.querySelector(".onside-hero-url-done")!).opacity : null,
          bodyBottom: rect(".onside-hero-body") ? frame.bottom - rect(".onside-hero-body")!.bottom : null,
          shelfLeft: slide.querySelector(".onside-hero-shelf li") ? Math.min(...Array.from(slide.querySelectorAll(".onside-hero-shelf li")).map(item => item.getBoundingClientRect().left)) : null,
          shelfInside: Array.from(slide.querySelectorAll(".onside-hero-shelf li")).every(item => item.getBoundingClientRect().top >= frame.top && item.getBoundingClientRect().bottom <= frame.bottom),
          brands: Array.from(slide.querySelectorAll(".onside-hero-shelf li")).map(item => item.textContent),
          ctaBottom: rect(".onside-hero-cta") ? frame.bottom - rect(".onside-hero-cta")!.bottom : null,
          ctaText: slide.querySelector(".onside-hero-cta")?.textContent ?? null,
        };
      });
      expect(report.lines).toBe(2);
      expect(report.lineOverflow).toBeLessThanOrEqual(0);
      expect(report.titleInside).toBe(true);
      if (design === "certificate") {
        // The headline stops short of the certificate, and its supporting line stays inside.
        expect(report.titleRight).toBeLessThan(report.paperLeft! - 2);
        expect(report.bodyBottom!).toBeGreaterThan(8);
      }
      if (design === "reasons") {
        // The headline and its pill stop short of the brand shelf, which shows whole.
        expect(report.titleRight).toBeLessThan(report.shelfLeft! - 2);
        expect(report.shelfInside).toBe(true);
        expect(report.brands).toEqual(["온사이드", "워터멜론", "아트멜론", "빈티지하우스", "마하픽스"]);
        expect(report.ctaText).toBe("온사이드를 고르는 이유 보기");
        expect(report.ctaBottom!).toBeGreaterThan(8);
      }
      if (design === "url") {
        expect(report.titleRight).toBeLessThan(report.jacketLeft! - 2);
        expect(report.field!.left).toBeGreaterThanOrEqual(12);
        expect(report.field!.right).toBeGreaterThanOrEqual(12);
        expect(report.field!.bottom).toBeGreaterThanOrEqual(12);
        // The address has finished typing and the confirmation is up.
        expect(report.doneOpacity).toBe("1");
      }
      const shot = testInfo.outputPath(`hero-${width}-${design}.png`);
      await page.locator("#main .onside-hero-banner").screenshot({ path: shot });
      const kept = resolve(`tmp/shots/hero-carousel/banner-${design}-${width}.png`);
      await mkdir(dirname(kept), { recursive: true });
      await copyFile(shot, kept);
      await next.click();
    }
    // After the last banner, next returns to the first.
    await expect.poll(() => activeDesign(page, "#main")).toBe("record");
  });
}

test("visitors move the banner with the buttons or a swipe, and only the banner on show can be reached", async ({ page }) => {
  await open(page, 572);
  const main = page.locator("#main");
  expect(await position(page, "#main")).toBe("1/4");
  await main.getByRole("button", { name: "다음 메인 배너" }).click();
  await expect.poll(() => position(page, "#main")).toBe("2/4");
  await expect(main.locator("[data-hero-slide][data-active]")).toHaveAttribute("data-hero-design", "url");
  await expect(main.locator('[data-hero-slide]:not([data-active])')).toHaveCount(3);
  for (const slide of await main.locator('[data-hero-slide]:not([data-active])').all()) await expect(slide).toHaveAttribute("inert", "");
  // The banner on show is one link to its page; the brand banner has none.
  await expect(main.locator("[data-hero-slide][data-active] a.onside-hero-link")).toHaveAttribute("href", "/dashboard/new/album");
  await expect(main.locator('[data-hero-design="record"] a')).toHaveCount(0);
  await expect(main.locator(".onside-hero-banner")).toHaveAttribute("data-hero-field", "url");

  await main.getByRole("button", { name: "이전 메인 배너" }).click();
  await expect.poll(() => position(page, "#main")).toBe("1/4");
  // Previous from the first goes to the last.
  await main.getByRole("button", { name: "이전 메인 배너" }).click();
  await expect.poll(() => position(page, "#main")).toBe("4/4");
  // The last banner leads to the case for Onside.
  await expect(main.locator("[data-hero-slide][data-active] a.onside-hero-link")).toHaveAttribute("href", "/about");

  // A swipe is the strip scrolling; the position follows it.
  await main.locator("[data-hero-slides]").evaluate(strip => strip.scrollTo({ left: strip.clientWidth, behavior: "auto" }));
  await expect.poll(() => position(page, "#main")).toBe("2/4");
  // One page heading: the brand banner's.
  await expect(main.locator("h1")).toHaveCount(1);
  await expect(main.locator("h1")).toHaveText("음반·뮤직비디오 심의,이제 더 간편하게");
  await expect(main.locator("h2")).toHaveCount(3);
});

test("the banner advances by itself, and waits while it is pointed at, focused or stopped", async ({ page }) => {
  await open(page, 572);
  await page.mouse.move(5, 5);
  await expect.poll(() => position(page, "#auto"), { timeout: 4000 }).toBe("2/4");
  await expect.poll(() => position(page, "#auto"), { timeout: 4000 }).toBe("3/4");
  await expect.poll(() => position(page, "#auto"), { timeout: 4000 }).toBe("4/4");
  await expect.poll(() => position(page, "#auto"), { timeout: 4000 }).toBe("1/4");

  // Pointing at it holds it.
  await page.locator("#auto .onside-hero-banner").hover({ position: { x: 40, y: 40 } });
  const held = await position(page, "#auto");
  await page.waitForTimeout(2500);
  expect(await position(page, "#auto")).toBe(held);
  await page.mouse.move(5, 5);
  await expect.poll(() => position(page, "#auto"), { timeout: 4000 }).not.toBe(held);

  // The stop button holds it, and stops the record and the broadcaster band too.
  const stop = page.locator("#auto").getByRole("button", { name: "배너 움직임 멈춤" });
  await stop.click();
  await page.mouse.move(5, 5);
  await expect(page.locator("#auto .onside-hero-banner")).toHaveAttribute("data-hero-motion", "paused");
  const stopped = await position(page, "#auto");
  await page.waitForTimeout(2500);
  expect(await position(page, "#auto")).toBe(stopped);
  await page.locator("#auto").getByRole("button", { name: "배너 움직임 재생" }).click();
  await page.mouse.move(5, 5);
  await expect.poll(() => position(page, "#auto"), { timeout: 4000 }).not.toBe(stopped);

  // A single banner has nothing to move to: no arrows, only the stop button.
  await expect(page.locator("#single .onside-hero-nav")).toHaveCount(0);
  await expect(page.locator("#single").getByRole("button", { name: "배너 움직임 멈춤" })).toBeVisible();
});

test("visitors who ask for reduced motion get no automatic advance, and the buttons still work", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, 572);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(2600);
  expect(await position(page, "#auto")).toBe("1/4");
  await page.locator("#auto").getByRole("button", { name: "다음 메인 배너" }).click();
  await expect.poll(() => position(page, "#auto")).toBe("2/4");
  // The address field shows its finished state without typing.
  await expect(page.locator("#auto .onside-hero-url-done")).toHaveCSS("opacity", "1");
});

test("the English site shows each banner's English text", async ({ page }) => {
  await open(page, 572, "/en");
  const main = page.locator("#main");
  await expect(main.locator("h1")).toHaveText("Album & MV Reviews,Now Made Simple");
  await expect(main.locator("h1")).toHaveAttribute("lang", "en");
  await expect(main.locator('[data-hero-design="url"] h2')).toHaveText("Already released?Just paste the URL");
  await expect(main.locator('[data-hero-design="certificate"] .onside-hero-body')).toHaveText("Get it ahead with an online review");
  await expect(main.getByRole("button", { name: "Next main banner" })).toBeVisible();
  // Screen readers hear each banner's link in English too.
  await expect(main.locator('[data-hero-design="url"] a.onside-hero-link')).toHaveAttribute("aria-label", "Already released? Just paste the URL");
  await expect(main.locator('[data-hero-design="reasons"] a.onside-hero-link')).toHaveAttribute("aria-label", "Why file your review with Onside?");
  const overflow = await main.locator(".onside-hero-title span").evaluateAll(lines => Math.max(...lines.map(line => (line as HTMLElement).scrollWidth - (line as HTMLElement).clientWidth)));
  expect(overflow).toBeLessThanOrEqual(0);
});
