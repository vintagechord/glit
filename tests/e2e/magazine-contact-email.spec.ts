import { expect, test } from "@playwright/test";
import { build } from "esbuild";

let documentHtml = "";
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {MagazineRequestForm} from './src/features/magazine/magazine-request-form';
      const params=new URLSearchParams(location.search);
      createRoot(document.getElementById('root')).render(<MagazineRequestForm isAuthenticated={params.get('guest')!=='yes'} requiresContactEmail={params.get('email')!=='yes'} availableCredits={100}/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "magazine-contact-ui-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(next\/(navigation|link)|\.\/actions|@\/lib\/credits|@\/lib\/supabase\/client)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "jsx", resolveDir: process.cwd(), contents: {
        "next/navigation": `export const usePathname=()=>location.pathname;export const useRouter=()=>({refresh(){}});`,
        "next/link": `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
        "./actions": `export const createMagazineRequestAction=async(form)=>{window.__calls.push(Object.fromEntries(form));return {error:'Test submission received'};};export const createMagazineArtworkUploadAction=async()=>({error:'Artwork upload blocked'});`,
        "@/lib/supabase/client": `export const createClient=()=>{throw new Error('Storage is not available in this fixture');};`,
        "@/lib/credits": `export const MAGAZINE_REQUEST_CREDIT_COST=1;export const MAGAZINE_REQUEST_UNAVAILABLE_MESSAGE='Unavailable';`,
      }[path]! }));
    } }],
  });
  documentHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script>window.__calls=[];</script><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: documentHtml })
    : route.fulfill({ status: 409, body: "External requests blocked" }));
});

for (const locale of ["", "/en"]) {
  test(`${locale || "Korean"} no-email member supplies required contact email in the request payload`, async ({ page }) => {
    await page.goto(`http://magazine-ui.test${locale}/magazine`);
    const contact = page.getByRole("textbox", { name: locale ? "Contact email (required)" : "안내받을 이메일 (필수)" });
    await expect(contact).toBeVisible();
    await expect(contact).toHaveAttribute("type", "email");
    await page.getByRole("button", { name: "발행 요청", exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls.length)).toBe(0);
    await contact.fill("request-contact@example.com");
    await page.getByRole("button", { name: "발행 요청", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __calls: Record<string, unknown>[] }).__calls[0]?.requesterEmail)).toBe("request-contact@example.com");
  });
}

test("email members and guests are not asked for another account email", async ({ page }) => {
  await page.goto("http://magazine-ui.test/magazine?email=yes");
  await expect(page.locator('input[name="requesterEmail"]')).toHaveCount(0);
  await page.getByRole("button", { name: "발행 요청", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __calls: Record<string, unknown>[] }).__calls[0]?.requesterEmail)).toBeUndefined();
  await page.goto("http://magazine-ui.test/magazine?guest=yes");
  await expect(page.locator('input[name="requesterEmail"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "발행 요청", exact: true })).toBeDisabled();
});
