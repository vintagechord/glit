import { expect, test } from "@playwright/test";
import { build } from "esbuild";

let documentHtml = "";

// Render the actual manual-mode screens with the public build flag. Router,
// auth transport and surrounding site chrome are isolated fixtures; this never
// creates accounts, exchanges credentials, sends email, or reaches a database.
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Forgot from './src/app/forgot-password/page';import {TrackLookupForm} from './src/features/track/track-lookup-form';import {AppShell} from './src/components/site/app-shell';const path=location.pathname.replace(/^\\/en/,'');const Screen=path==='/forgot-password'?Forgot:TrackLookupForm;createRoot(document.getElementById('root')).render(<AppShell><Screen/></AppShell>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE": '"manual"' },
    plugins: [{ name: "manual-email-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(next\/(?:navigation|link|dynamic)|@\/lib\/supabase\/client|@\/features\/auth\/actions|@\/components\/site\/(?:header|footer))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const modules: Record<string, string> = {
          "next/navigation": "export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push(href){window.__manualEffects.navigation.push(href)},replace(){},refresh(){},prefetch(){}});",
          "next/link": "import React from 'react';export default function Link({children,prefetch,...props}){return <a {...props}>{children}</a>}",
          "next/dynamic": "export default ()=>()=>null;",
          "@/lib/supabase/client": "export const createClient=()=>{window.__manualEffects.authClients++;throw new Error('Unexpected auth client in manual reset screen')};",
          "@/features/auth/actions": "export const resetPasswordAction=async()=>{window.__manualEffects.emailActions++;throw new Error('Unexpected email action')};",
          "@/components/site/header": "export const SiteHeader=()=>null;",
          "@/components/site/footer": "export const SiteFooter=()=>null;",
        };
        return { loader: "jsx", contents: modules[path], resolveDir: process.cwd() };
      });
    } }],
  });
  documentHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script>window.__manualEffects={authClients:0,emailActions:0,navigation:[]};</script><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

for (const english of [false, true]) {
  const prefix = english ? "/en" : "";
  test.describe(`${english ? "English" : "Korean"} manual email mode`, () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test.beforeEach(async ({ page }) => {
      await page.route("**/*", async route => {
        if (route.request().resourceType() === "document") return route.fulfill({ contentType: "text/html", body: documentHtml });
        if (new URL(route.request().url()).pathname === "/api/track/validate") return route.fulfill({ json: { ok: true } });
        return route.fulfill({ status: 409, json: { error: "Unexpected request blocked by manual-mode fixture" } });
      });
    });

    test("password recovery offers manual support and no email request form", async ({ page }) => {
      await page.goto(`http://manual-email.test${prefix}/forgot-password`);
      await expect(page.getByRole("heading", { name: english ? "Password Reset Help" : "비밀번호 재설정 안내", exact: true })).toBeVisible();
      await expect(page.locator("#reset-email")).toHaveCount(0);
      await expect(page.getByRole("link", { name: english ? "Contact Support" : "고객센터 문의", exact: true })).toHaveAttribute("href", `${prefix}/support`);
      const notice = page.getByRole("complementary", { name: english ? "Email Delivery Notice" : "이메일 발송 안내" });
      await expect(notice).toContainText(english ? "keep your guest lookup code" : "비회원 조회 코드를 보관해주세요");
      await expect(notice.getByRole("link")).toHaveAttribute("href", `${prefix}/track`);
      expect(await page.evaluate(() => (window as typeof window & { __manualEffects: { emailActions: number } }).__manualEffects.emailActions)).toBe(0);
    });

    test("saved lookup codes still work while email code recovery is replaced with support", async ({ page }) => {
      let validations = 0;
      let emailRecoveries = 0;
      page.on("request", request => {
        const path = new URL(request.url()).pathname;
        if (path === "/api/track/validate") validations++;
        if (path === "/api/track/lookup-code") emailRecoveries++;
      });
      await page.goto(`http://manual-email.test${prefix}/track`);
      await expect(page.locator("#lookup-email")).toHaveCount(0);
      await expect(page.getByRole("link", { name: english ? "Contact Support" : "고객센터 문의", exact: true })).toHaveAttribute("href", `${prefix}/support`);
      await page.locator("#guest-track-token").fill("synthetic-lookup-code");
      await page.locator("main form").getByRole("button").click();
      await expect.poll(() => page.evaluate(() => (window as typeof window & { __manualEffects: { navigation: string[] } }).__manualEffects.navigation)).toEqual([`${prefix}/track/synthetic-lookup-code`]);
      expect(validations).toBe(1);
      expect(emailRecoveries).toBe(0);
    });
  });
}
