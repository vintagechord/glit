import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let documentHtml = "";
test.beforeAll(async () => {
  const [bundle, css] = await Promise.all([
    build({
      stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {LoginForm} from './src/features/auth/login-form';
        import {SignupForm} from './src/features/auth/signup-form';
        import {SocialAuthButtons} from './src/features/auth/social-auth-buttons';
        import {CompleteSignupForm} from './src/features/auth/complete-signup-form';
        import {ProfileSocialAccounts} from './src/features/profile/profile-social-accounts';
        import {ProfileForm} from './src/features/profile/profile-form';
        const params=new URLSearchParams(location.search),nextPath=params.get('next'),english=location.pathname.startsWith('/en/');
        const availability={google:true,naver:params.get('naver')!=='off',kakao:false};
        const content=location.pathname.endsWith('/complete-signup')?<CompleteSignupForm nextPath={nextPath} english={english} consentAlreadySaved={params.get("saved")==="yes"}/>:location.pathname.endsWith('/profile')?<><ProfileForm defaultValues={{name:'Member',company:'',phone:'01012345678'}} canChangePassword={params.get('password')==='yes'}/><ProfileSocialAccounts availability={availability} linkedProviders={params.has('unlinked')?[]:['naver']} english={english}/></>:location.pathname.endsWith('/signup')?<><SocialAuthButtons availability={availability} mode='signup' nextPath={nextPath}/><SignupForm nextPath={nextPath}/></>:<LoginForm nextPath={nextPath} socialSlot={<SocialAuthButtons availability={availability} nextPath={nextPath} errorCode={params.get('social_error')}/>}/>;
        createRoot(document.getElementById('root')).render(<main className='mx-auto w-full max-w-lg space-y-6 p-5'>{content}</main>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": '{"NODE_ENV":"production","NEXT_PUBLIC_EMAIL_DELIVERY_MODE":"transactional"}' },
      plugins: [{ name: "social-ui-fixture", setup(plugin) {
        plugin.onResolve({ filter: /^(next\/(navigation|link)|\.\/actions|@\/features\/auth\/actions|\.\/complete-signup-action|@\/features\/track\/track-lookup-modal|@\/components\/site\/footer)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "jsx", resolveDir: process.cwd(), contents: {
          "next/navigation": "export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:href=>window.__fixture.pushes.push(href),refresh(){}});",
          "next/link": "import React from 'react';export default function Link({children,prefetch,...props}){return <a {...props}>{children}</a>}",
          "./actions": "const action=(_,form)=>{window.__fixture.calls.push(Object.fromEntries(form));return new Promise(resolve=>window.__fixture.resolve=resolve)};export const loginAction=action;export const signupAction=action;",
          "@/features/auth/actions": "export const updateProfileAction=async()=>({});export const updatePasswordAction=async()=>({});",
          "./complete-signup-action": "export const completeSignupAction=(_,form)=>{window.__fixture.calls.push(Object.fromEntries(form));return new Promise(resolve=>window.__fixture.resolve=resolve)};",
          "@/features/track/track-lookup-modal": "export const TrackLookupModalTrigger=()=>null;",
          "@/components/site/footer": "export const privacyContent='개인정보 처리 내용';export const termsContent='이용약관 내용';export const refundContent='환불 정책 내용';export const termsContentEn='Terms content';export const privacyContentEn='Privacy content';export const refundContentEn='Refund content';",
        }[path]! }));
      } }],
    }),
    readFile(resolve("src/app/globals.css"), "utf8").then(source => postcss([tailwind()]).process(source, { from: resolve("src/app/globals.css") })),
  ]);
  documentHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>window.__fixture={calls:[],pushes:[]};</script><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: documentHtml })
    : route.fulfill({ status: 409, body: "External requests blocked" }));
});

for (const english of [false, true]) {
  test(`${english ? "English" : "Korean"} approved Naver login and linking controls have no review restriction notice`, async ({ page }) => {
    const prefix = english ? "/en" : "";
    const reviewText = english ? "Under review" : "검수 중";
    const restriction = english ? /only app administrators and registered testers/ : /네이버 앱 관리자와 등록된 테스터만/;
    await page.setViewportSize({ width: 320, height: 800 });
    for (const mode of ["login", "signup"]) {
      await page.goto(`http://social-ui.test${prefix}/${mode}?next=%2Fmypage`);
      const naver = page.getByRole("link", { name: english ? "Continue with Naver" : `네이버로 ${mode === "signup" ? "시작하기" : "로그인"}`, exact: true });
      await expect(naver).toBeVisible();
      await expect(naver).toHaveAttribute("href", `/auth/social/naver?locale=${english ? "en" : "ko"}&next=${encodeURIComponent(`${prefix}/mypage`)}`);
      await expect(naver).not.toHaveAttribute("aria-describedby");
      await expect(page.getByText(reviewText, { exact: true })).toHaveCount(0);
      await expect(page.getByText(restriction)).toHaveCount(0);
      const google = page.getByRole("link", { name: english ? "Continue with Google" : `Google로 ${mode === "signup" ? "시작하기" : "로그인"}`, exact: true });
      await expect(google).not.toHaveAttribute("aria-describedby");
      await expect(page.getByRole("button", { name: english ? /Continue with Kakao.*Setup pending/ : /카카오.*준비 중/ })).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    }
    await page.goto(`http://social-ui.test${prefix}/login?naver=off`);
    await expect(page.getByText(reviewText, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: english ? /Continue with Naver.*Setup pending/ : /네이버.*준비 중/ })).toBeDisabled();
    await page.goto(`http://social-ui.test${prefix}/profile?unlinked=yes`);
    const linkForm = page.locator('form[action="/auth/link/naver"]');
    await expect(linkForm).toHaveAttribute("method", "post");
    await expect(linkForm.getByRole("button")).toBeEnabled();
    await expect(linkForm.getByRole("button")).not.toHaveAttribute("aria-describedby");
    await expect(page.getByText(reviewText, { exact: true })).toHaveCount(0);
    await expect(page.getByText(restriction)).toHaveCount(0);
    await page.goto(`http://social-ui.test${prefix}/profile`);
    await expect(page.getByText(reviewText, { exact: true })).toHaveCount(0);
    await expect(page.getByText(english ? "Linked" : "연결됨", { exact: true })).toBeVisible();
  });
  for (const mode of ["login", "signup"]) {
    test(`${english ? "English" : "Korean"} ${mode}: native social links preserve draft destination, with disabled setup state at 320px`, async ({ page }, testInfo) => {
      const requests: string[] = [];
      page.on("request", request => { if (request.resourceType() !== "document") requests.push(request.url()); });
      await page.setViewportSize({ width: 320, height: 800 });
      const next = "/dashboard/new/album?draft=fixture#tracks";
      await page.goto(`http://social-ui.test${english ? "/en" : ""}/${mode}?next=${encodeURIComponent(next)}`);
      const provider = page.getByRole("link", { name: english ? "Continue with Google" : `Google로 ${mode === "signup" ? "시작하기" : "로그인"}`, exact: true });
      await expect(provider).toBeVisible();
      const marks = page.locator(`[aria-label="${english ? "Social sign-in" : "소셜 로그인"}"] svg`);
      await expect(marks).toHaveCount(3);
      expect(await marks.evaluateAll(elements => elements.every(element => Boolean(element.closest('[aria-hidden="true"]'))))).toBe(true);
      const target = new URL((await provider.getAttribute("href"))!, page.url());
      expect(target.pathname).toBe("/auth/social/google");
      expect(target.searchParams.get("locale")).toBe(english ? "en" : "ko");
      expect(target.searchParams.get("next")).toBe(`${english ? "/en" : ""}${next}`);
      expect(await provider.evaluate(element => element.closest("form"))).toBeNull();
      await expect(page.getByRole("button", { name: english ? /Continue with Kakao.*Setup pending/ : /카카오.*준비 중/ })).toBeDisabled();
      await expect(page.locator(`form input[name="next"]`)).toHaveValue(`${english ? "/en" : ""}${next}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      expect(await page.evaluate(() => (window as unknown as { __fixture: { calls: unknown[] } }).__fixture.calls.length)).toBe(0);
      expect(requests).toEqual([]);
      if (english && mode === "login") await page.screenshot({ path: testInfo.outputPath("social-auth-320.png"), fullPage: true });
    });
  }
  test(`${english ? "English" : "Korean"} completion requires deliberate consent, keeps marketing optional, restores modal focus and handles save failure`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`http://social-ui.test${english ? "/en" : ""}/complete-signup?next=%2Fdashboard%2Fnew%3Fdraft%3Dsaved`);
    await expect(page.locator('input[type="email"],input[type="password"]')).toHaveCount(0);
    const selectRequired = page.getByRole("checkbox", { name: english ? "Accept all required agreements" : "필수 항목 전체 동의", exact: true });
    await expect(selectRequired).not.toBeChecked();
    const viewTerms = page.getByRole("button", { name: english ? "View Terms of Use" : "이용약관 보기", exact: true });
    await viewTerms.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(viewTerms).toBeFocused();
    await selectRequired.check();
    for (const name of ["agreeAge", "agreeTerms", "agreePrivacy", "agreeRefund"]) await expect(page.locator(`input[name="${name}"]`)).toBeChecked();
    await expect(page.locator('input[name="agreeMarketing"]')).not.toBeChecked();
    await page.getByRole("button", { name: english ? "Complete signup" : "가입 완료", exact: true }).click();
    await expect(page.getByRole("button", { name: english ? "Completing signup..." : "가입 완료 중...", exact: true })).toBeDisabled();
    const calls = await page.evaluate(() => (window as unknown as { __fixture: { calls: Record<string, string>[] } }).__fixture.calls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ agreeAge: "on", agreeTerms: "on", agreePrivacy: "on", agreeRefund: "on", locale: english ? "en" : "ko", next: `${english ? "/en" : ""}/dashboard/new?draft=saved` });
    expect(calls[0].agreeMarketing).toBeUndefined();
    await page.evaluate(() => (window as unknown as { __fixture: { resolve: (state: object) => void } }).__fixture.resolve({ error: "Please retry" }));
    await expect(page.getByRole("alert")).toHaveText("Please retry");
    await expect(page.getByRole("button", { name: english ? "Complete signup" : "가입 완료", exact: true })).toBeEnabled();
    await expect(selectRequired).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
}

test("provider errors are allowlisted and social-only profile hides password while linking uses deliberate POST", async ({ page }) => {
  await page.goto("http://social-ui.test/en/login?social_error=cancelled&next=https%3A%2F%2Fexternal.invalid");
  await expect(page.getByRole("alert")).toContainText("cancelled");
  expect(await page.getByRole("link", { name: "Continue with Google", exact: true }).getAttribute("href")).toBe("/auth/social/google?locale=en");
  await page.goto("http://social-ui.test/en/login?social_error=untrusted-secret");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.goto("http://social-ui.test/en/profile?social_error=link-conflict");
  await expect(page.getByRole("alert")).toContainText("already linked");
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  const linkForm = page.locator('form[action="/auth/link/google"]');
  await expect(linkForm).toHaveAttribute("method", "post");
  await expect(linkForm.locator('input[name="next"]')).toHaveValue("/en/mypage/profile");
  await expect(linkForm.locator('input[name="locale"]')).toHaveValue("en");
  await expect(page.locator('form[action="/auth/link/naver"]')).toHaveCount(0);
  await expect(page.getByText("Linked", { exact: true })).toBeVisible();
  await expect(page.locator('form[action="/auth/link/kakao"] button')).toBeDisabled();
  await page.goto("http://social-ui.test/en/profile?password=yes");
  await expect(page.locator('input[type="password"]')).toHaveCount(2);
});

test("saved consent offers a session retry without asking the member to agree again", async ({ page }) => {
  await page.goto("http://social-ui.test/en/complete-signup?saved=yes&next=%2Fmypage");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to Onside", exact: true }).click();
  const calls = await page.evaluate(() => (window as unknown as { __fixture: { calls: Record<string, string>[] } }).__fixture.calls);
  expect(calls).toEqual([{ next: "/en/mypage", locale: "en" }]);
});
