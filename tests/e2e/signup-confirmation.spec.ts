import { expect, test } from "@playwright/test";
import { build } from "esbuild";

let documentHtml = "";

// The real components run with isolated server actions. No database, email,
// auth provider, account creation, or session exchange is reachable here.
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ConfirmEmailForm} from './src/features/auth/confirm-email-form';import {AccountEmailForm} from './src/features/auth/account-email-form';const nextPath=new URLSearchParams(location.search).get('next');createRoot(document.getElementById('root')).render(location.pathname.endsWith('/find-id')?<AccountEmailForm purpose="account" nextPath={nextPath}/>:<ConfirmEmailForm nextPath={nextPath}/>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "confirmation-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(next\/(?:navigation|link)|\.\/actions)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "jsx", resolveDir: process.cwd(), contents: {
        "next/navigation": "export const usePathname=()=>location.pathname;",
        "next/link": "import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}",
        "./actions": "const call=(kind,form)=>{window.__fixture.calls.push({kind,form:Object.fromEntries(form)});return new Promise(resolve=>window.__fixture.resolve=resolve);};export const confirmSignupAction=(_,form)=>call('confirm',form);export const resendSignupAction=(_,form)=>call('resend',form);export const findAccountIdAction=(_,form)=>call('account',form);",
      }[path] }));
    } }],
  });
  documentHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body><main id="root"></main><script>window.__fixture={calls:[]};</script><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: documentHtml })
    : route.fulfill({ status: 409, body: "External request blocked" }));
});

for (const english of [false, true]) {
  test(`${english ? "English" : "Korean"} confirmation requires a deliberate submit, blocks duplicates, then preserves the draft return path`, async ({ page }) => {
    const prefix = english ? "/en" : "";
    const next = "/dashboard/new?draft=fixture";
    await page.goto(`http://email-ui.test${prefix}/confirm-email?next=${encodeURIComponent(next)}#token_hash=fixture-signup-token-123456&type=signup&signature=${"a".repeat(64)}`);
    const button = page.getByRole("button", { name: english ? "Verify email and complete signup" : "이메일 확인하고 가입 완료", exact: true });
    await expect(button).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __fixture: { calls: unknown[] } }).__fixture.calls.length)).toBe(0);
    await page.locator("#signup-new-password").fill("Fixture-password-123");
    await page.locator("#signup-confirm-password").fill("Fixture-password-123");
    await button.click();
    await expect(page.getByRole("button", { name: english ? "Verifying..." : "확인 중...", exact: true })).toBeDisabled();
    const calls = await page.evaluate(() => (window as unknown as { __fixture: { calls: Array<{ kind: string; form: Record<string, string> }> } }).__fixture.calls);
    expect(calls).toHaveLength(1);
    expect(calls[0].form.token_hash).toBe("fixture-signup-token-123456");
    expect(calls[0].form.type).toBe("signup");
    expect(calls[0].form.signature).toBe("a".repeat(64));
    await page.evaluate(() => (window as unknown as { __fixture: { resolve: (value: object) => void } }).__fixture.resolve({ message: "인증 완료" }));
    await expect(page.getByRole("status")).toHaveText("인증 완료");
    await expect(page.getByRole("link", { name: english ? "Log in" : "로그인", exact: true })).toHaveAttribute("href", `${prefix}/login?next=${encodeURIComponent(`${prefix}${next}`)}`);
    expect(new URL(page.url()).hash).toBe("");
  });
}

test("failed confirmation stays recoverable and email account lookup shows the generic response", async ({ page }) => {
  await page.goto(`http://email-ui.test/confirm-email#token_hash=fixture-signup-token-123456&type=signup&signature=${"a".repeat(64)}`);
  await page.locator("#signup-new-password").fill("Fixture-password-123");
  await page.locator("#signup-confirm-password").fill("Fixture-password-123");
  await page.getByRole("button", { name: "이메일 확인하고 가입 완료", exact: true }).click();
  await page.evaluate(() => (window as unknown as { __fixture: { resolve: (value: object) => void } }).__fixture.resolve({ error: "인증 링크가 만료되었습니다." }));
  await expect(page.getByRole("alert")).toHaveText("인증 링크가 만료되었습니다.");
  await expect(page.locator("#signup-email")).toBeVisible();
  await page.goto("http://email-ui.test/find-id?next=https://evil.invalid");
  await page.locator("#account-email").fill("owner@example.invalid");
  await page.getByRole("button", { name: "이메일로 받기", exact: true }).click();
  await page.evaluate(() => (window as unknown as { __fixture: { resolve: (value: object) => void } }).__fixture.resolve({ message: "가입된 이메일이라면 아이디 안내를 보내드립니다.", retryAfterSeconds: 60 }));
  await expect(page.getByRole("status")).toHaveText("가입된 이메일이라면 아이디 안내를 보내드립니다.");
  await expect(page.getByRole("button", { name: /초 후 다시 보내기/ })).toBeDisabled();
  await expect(page.getByRole("link", { name: "로그인", exact: true })).toHaveAttribute("href", "/login");
});
