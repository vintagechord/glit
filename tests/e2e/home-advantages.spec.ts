import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
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

for (const width of [320, 390, 1280]) {
  for (const english of [false, true]) {
    test(`home advantages and three-item navigation at ${width}px (${english ? "en" : "ko"})`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize({ width, height: 1000 });
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto(english ? "/en" : "/");
      await expect(page.getByText(english ? "Beyond review, with Onside" : "심의 그 다음까지, 온사이드", { exact: true })).toBeVisible();
      const nav = page.getByRole("navigation", { name: width < 1024
        ? english ? "Mobile navigation" : "모바일 주요 메뉴"
        : english ? "Primary navigation" : "주요 메뉴", exact: true });
      await expect(nav.getByRole("link")).toHaveCount(3);
      await expect(nav.getByRole("link", { name: /이용가이드|^가이드$|^Guide$/ })).toHaveCount(0);
      const benefits = page.locator("main section");
      await expect(benefits.getByRole("link")).toHaveCount(3);
      await expect(benefits.getByRole("link").nth(2)).toHaveAttribute("href", english ? "/en/support#artmelon" : "/support#artmelon");
      await expect(benefits).not.toContainText(/30%|50%|할인|Discount/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`home-${width}-${english ? "en" : "ko"}.png`), fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}
