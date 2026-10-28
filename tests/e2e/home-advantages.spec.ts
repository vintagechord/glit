import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let html: string;
test.beforeAll(async () => {
  const [bundle, css] = await Promise.all([
    build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `
          import React from 'react';
          import {createRoot} from 'react-dom/client';
          import {SiteHeader} from './src/components/site/header';
          import {HomeHeroAdBanner} from './src/components/site/home-hero-ad-banner';
          import {EnglishLanguagePack} from './src/components/i18n/english-language-pack';
          createRoot(document.getElementById('root')).render(<><EnglishLanguagePack/><SiteHeader/><main style={{padding:16}}><HomeHeroAdBanner/></main></>);
        `,
      },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": '{"NODE_ENV":"production"}' },
      plugins: [{
        name: "isolated-home",
        setup(builder) {
          builder.onResolve({ filter: /^(next\/(navigation|link)|@\/lib\/supabase\/client)$/ }, args => ({ path: args.path, namespace: "fixture" }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
            loader: "tsx", resolveDir: process.cwd(),
            contents: args.path === "next/navigation"
              ? `export const usePathname=()=>location.pathname;`
              : args.path === "next/link"
                ? `import React from 'react'; export default function Link({children,prefetch,replace,scroll,...props}){return <a {...props}>{children}</a>}`
                : `export const createClient=()=>({auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}});`,
          }));
        },
      }],
    }),
    readFile(resolve("src/app/globals.css"), "utf8")
      .then(source => postcss([tailwind()]).process(source, { from: resolve("src/app/globals.css") })),
  ]);
  html = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

async function expectWithinViewport(page: Page, dialog: Locator) {
  const viewport = page.viewportSize()!;
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
}

for (const width of [320, 390, 1280]) {
  for (const english of [false, true]) {
    test(`compact home services open public examples at ${width}px (${english ? "en" : "ko"})`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      const externalRequests: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize({ width, height: 800 });
      await page.route("**/*", route => {
        if (route.request().resourceType() === "document") {
          return route.fulfill({ contentType: "text/html", body: html });
        }
        externalRequests.push(`${route.request().method()} ${route.request().url()}`);
        return route.fulfill({ status: 404, body: "External calls blocked" });
      });
      await page.goto(english ? "/en" : "/");
      const initialUrl = page.url();
      const nav = page.getByRole("navigation", { name: width < 1024
        ? english ? "Mobile navigation" : "모바일 주요 메뉴"
        : english ? "Primary navigation" : "주요 메뉴", exact: true });
      await expect(nav.getByRole("link")).toHaveCount(3);
      await expect(nav.getByRole("link", { name: /이용가이드|^가이드$|^Guide$/ })).toHaveCount(0);
      const benefits = page.getByRole("region", {
        name: english ? "Your next steps with Onside" : "온사이드와 함께하는 심의 그 다음",
        exact: true,
      });
      const services = benefits.getByRole("button");
      const serviceNames = english
        ? ["Broadcast request instructions", "Review archive", "Artmelon store"]
        : ["방송 신청 방법 제공", "심의 기록 보관", "아트멜론 입점"];
      const serviceDescriptions = english
        ? ["Onside recommends radio programs that match your music after its review is complete.", "Your Onside reviews are saved to your account automatically. You can also record reviews handled elsewhere.", "We connect you with Artmelon, a platform for selling CDs, vinyl and merch."]
        : ["심의가 완료된 내 음악에 맞는 방송국의 프로그램을 온사이드가 제안합니다.", "온사이드의 심의는 자동으로 계정에 저장되며, 외부 진행 심의도 계정에 기록할 수 있습니다", "CD·LP·굿즈 판매 플랫폼 아트멜론과 연결합니다"];
      await expect(services).toHaveCount(3);
      for (const name of serviceNames) {
        await expect(benefits.getByRole("button", { name, exact: true })).toBeVisible();
      }
      await expect(benefits.getByRole("link")).toHaveCount(0);
      await expect(benefits.getByText(english ? "Preview" : "미리보기", { exact: true })).toHaveCount(0);
      await expect(benefits).not.toContainText(/30%|50%|할인|Discount/);
      const sectionHeight = (await benefits.boundingBox())!.height;
      expect(sectionHeight).toBeLessThanOrEqual(160);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const serviceBounds = [];
      for (const button of await services.all()) {
        const bounds = (await button.boundingBox())!;
        serviceBounds.push(bounds);
        expect(bounds.height).toBeGreaterThanOrEqual(80);
        await expect(button).toHaveAttribute("aria-haspopup", "dialog");
      }
      expect(Math.max(...serviceBounds.map(bounds => bounds.y)) - Math.min(...serviceBounds.map(bounds => bounds.y))).toBeLessThanOrEqual(1);
      expect(Math.max(...serviceBounds.map(bounds => bounds.height)) - Math.min(...serviceBounds.map(bounds => bounds.height))).toBeLessThanOrEqual(1);
      const measurementsPath = testInfo.outputPath("compact-layout.json");
      await writeFile(measurementsPath, JSON.stringify({
        width, language: english ? "en" : "ko", sectionHeight,
        buttonHeights: serviceBounds.map(bounds => bounds.height),
      }));
      await testInfo.attach("compact-layout", { path: measurementsPath, contentType: "application/json" });
      await page.screenshot({ path: testInfo.outputPath(`home-${width}-${english ? "en" : "ko"}.png`), fullPage: true });

      for (let index = 0; index < 3; index += 1) {
        const trigger = benefits.getByRole("button", { name: serviceNames[index], exact: true });
        const previousBodyOverflow = await page.evaluate(() => document.body.style.overflow);
        await trigger.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: serviceNames[index], exact: true });
        await expect(dialog).toBeVisible();
        expect(await dialog.evaluate(element => element instanceof HTMLDialogElement && element.matches(":modal"))).toBe(true);
        await expect(dialog.getByText(english ? "Service preview" : "서비스 이용 예시", { exact: true })).toHaveCount(0);
        await expect(dialog.getByText(serviceDescriptions[index], { exact: true })).toBeVisible();
        await expect(dialog.getByText(english ? "ILLUSTRATIVE EXAMPLE · FICTIONAL DATA" : "이해를 돕기 위한 가상의 예시입니다", { exact: true })).toBeVisible();
        await expect(dialog.getByRole("link")).toHaveCount(0);
        await expect(dialog.locator("form")).toHaveCount(0);
        await expectWithinViewport(page, dialog);
        expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
        expect(page.url()).toBe(initialUrl);
        const close = dialog.getByRole("button", {
          name: english ? "Close service preview" : "서비스 예시 닫기",
          exact: true,
        });
        await expect(close).toBeVisible();
        for (const key of ["Shift+Tab", "Tab", "Tab"]) {
          await page.keyboard.press(key);
          expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
        }
        await page.screenshot({ path: testInfo.outputPath(`service-${index + 1}-${width}-${english ? "en" : "ko"}.png`) });
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        expect(await page.evaluate(() => document.body.style.overflow)).toBe(previousBodyOverflow);
        expect(page.url()).toBe(initialUrl);
        await trigger.click();
        await expect(dialog).toBeVisible();
        await close.click();
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await trigger.click();
        await expect(dialog).toBeVisible();
        await page.mouse.click(1, 1);
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(externalRequests).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
