import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// The application email field with its typo hint, rendered alone: the hint
// is a `peer-focus:hidden` sibling, so it never shows while the customer is
// still typing, and 바꾸기 replaces the address.
let html: string;
test.beforeAll(async () => {
  const [bundle, css] = await Promise.all([
    build({
      stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {EmailTypoHint} from './src/components/forms/email-typo-hint';
        function Field(){
          const [email,setEmail]=React.useState('');
          return <main style={{maxWidth:420,margin:'24px auto'}} className="space-y-2">
            <label htmlFor="email">이메일 *</label>
            <input id="email" type="email" value={email} onChange={e=>setEmail(e.target.value)} className="peer w-full rounded-2xl border px-4 py-3"/>
            <EmailTypoHint email={email} onApply={setEmail}/>
            <button type="button">다음</button>
          </main>;
        }
        createRoot(document.getElementById('root')).render(<Field/>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": '{"NODE_ENV":"production"}' },
    }),
    readFile(resolve("src/app/globals.css"), "utf8").then(source => postcss([tailwind()]).process(source, { from: resolve("src/app/globals.css") })),
  ]);
  html = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

test("a mistyped provider shows one line after the field is left, and 바꾸기 fixes it", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
  await page.goto("/__email-typo-hint");
  const field = page.getByLabel("이메일 *");
  const hint = page.getByText("혹시 hanmail.net인가요?");

  await field.fill("Artist@hanmail.met");
  await expect(hint).toBeHidden();
  await field.press("Tab");
  await expect(hint).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("email-typo-hint.png") });
  await page.getByRole("button", { name: "바꾸기" }).click();
  await expect(field).toHaveValue("Artist@hanmail.net");
  await expect(hint).toHaveCount(0);

  // A correct or company address never shows anything.
  for (const value of ["artist@naver.com", "artist@studio.co.kr"]) {
    await field.fill(value);
    await field.press("Tab");
    await expect(page.getByRole("button", { name: "바꾸기" })).toHaveCount(0);
  }
});
