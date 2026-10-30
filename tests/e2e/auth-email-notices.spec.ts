import { expect, test } from "@playwright/test";
import { build } from "esbuild";

let documentHtml = "";

// Exercise the actual forms and shared popup host without reaching account or
// mail services. Each response is resolved explicitly by the test.
test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {SignupForm} from './src/features/auth/signup-form';import {LoginForm} from './src/features/auth/login-form';import ForgotPasswordPage from './src/app/forgot-password/page';import {CenteredDialogHost} from './src/components/ui/centered-dialog-host';const nextPath=new URLSearchParams(location.search).get('next');createRoot(document.getElementById('root')).render(<><CenteredDialogHost/>{location.pathname.endsWith('/signup')?<SignupForm nextPath={nextPath}/>:location.pathname.endsWith('/login')?<LoginForm nextPath={nextPath}/>:<ForgotPasswordPage/>}</>);`,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "email-notice-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(next\/(?:navigation|link)|(?:\.\/|@\/features\/auth\/)actions|@\/lib\/email-delivery-mode|@\/components\/site\/footer|@\/features\/track\/track-lookup-modal)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "jsx", resolveDir: process.cwd(), contents: {
        "next/navigation": "export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:(href)=>window.__fixture.redirects.push(href)});",
        "next/link": "import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}",
        "@/lib/email-delivery-mode": "export const getEmailDeliveryMode=()=> 'transactional';",
        "@/components/site/footer": "export const privacyContent='Privacy',termsContent='Terms',refundContent='Refund',termsContentEn='Terms',privacyContentEn='Privacy',refundContentEn='Refund';",
        "@/features/track/track-lookup-modal": "export const TrackLookupModalTrigger=()=>null;",
      }[path] ?? "const call=(kind,form)=>{window.__fixture.calls.push({kind,form:Object.fromEntries(form)});return new Promise(resolve=>window.__fixture.resolve=resolve);};export const signupAction=(_,form)=>call('signup',form);export const resetPasswordAction=(_,form)=>call('reset',form);export const loginAction=(_,form)=>call('login',form);" }));
    } }],
  });
  documentHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body><main id="root"></main><script>window.__fixture={calls:[],redirects:[]};</script><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: documentHtml })
    : route.fulfill({ status: 409, body: "External request blocked" }));
});

for (const english of [false, true]) {
  test(`${english ? "English" : "Korean"} duplicate signup opens a focused popup without completing signup`, async ({ page }) => {
    await page.goto(`http://auth-ui.test${english ? "/en" : ""}/signup`);
    await page.locator("#signup-email").fill("registered@example.invalid");
    await page.getByLabel(english ? "Accept all required items" : "필수 항목 전체 동의", { exact: true }).check();
    await page.getByRole("button", { name: english ? "Sign up" : "회원가입", exact: true }).click();
    await page.evaluate(() => (window as unknown as { __fixture: { resolve: (value: object) => void } }).__fixture.resolve({ error: "이미 가입된 이메일입니다.", notice: "email_already_registered" }));
    const popup = page.getByRole("dialog", { name: english ? "Notice" : "안내", exact: true });
    await expect(popup).toContainText(english ? "This email is already registered." : "이미 가입된 이메일입니다.");
    await expect(popup.getByRole("button")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(popup.getByRole("button")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(page.locator("[inert]")).toHaveCount(0);
    await expect(page.getByRole("link", { name: english ? "Resend verification email" : "인증 메일 다시 받기", exact: true })).toHaveCount(0);
    // A verified duplicate is pointed at login and password reset instead.
    await expect(page.getByRole("link", { name: english ? "Reset password" : "비밀번호 찾기", exact: true })).toHaveAttribute("href", `${english ? "/en" : ""}/forgot-password`);
    expect(await page.evaluate(() => (window as unknown as { __fixture: { redirects: string[] } }).__fixture.redirects)).toEqual([]);
  });

  test(`${english ? "English" : "Korean"} unverified re-signup offers the verification resend link without sending mail`, async ({ page }) => {
    await page.goto(`http://auth-ui.test${english ? "/en" : ""}/signup`);
    await page.locator("#signup-email").fill("pending@example.invalid");
    await page.getByLabel(english ? "Accept all required items" : "필수 항목 전체 동의", { exact: true }).check();
    await page.getByRole("button", { name: english ? "Sign up" : "회원가입", exact: true }).click();
    await page.evaluate((isEnglish) => (window as unknown as { __fixture: { resolve: (value: object) => void } }).__fixture.resolve({
      error: isEnglish
        ? "This email already has a pending signup. Email verification is not complete yet, so request a new verification email below."
        : "이미 가입 신청된 이메일입니다. 아직 이메일 인증이 완료되지 않았으니 아래에서 인증 메일을 다시 요청해주세요.",
      notice: "email_already_registered", verificationPending: true,
    }), english);
    const popup = page.getByRole("dialog", { name: english ? "Notice" : "안내", exact: true });
    await expect(popup).toContainText(english ? "pending signup" : "인증 메일을 다시 요청");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("link", { name: english ? "Resend verification email" : "인증 메일 다시 받기", exact: true })).toHaveAttribute("href", `${english ? "/en" : ""}/confirm-email`);
    expect(await page.evaluate(() => (window as unknown as { __fixture: { redirects: string[] } }).__fixture.redirects)).toEqual([]);
  });

  for (const registered of [false, true]) {
    test(`${english ? "English" : "Korean"} reset shows ${registered ? "sent" : "unregistered"} popup and allows the appropriate retry`, async ({ page }) => {
      await page.goto(`http://auth-ui.test${english ? "/en" : ""}/forgot-password`);
      const sendLink = english ? "Send link" : "링크 보내기";
      await page.locator("#reset-email").fill("owner@example.invalid");
      await page.getByRole("button", { name: sendLink, exact: true }).click();
      await page.evaluate((isRegistered) => (window as unknown as { __fixture: { resolve: (value: object) => void } }).__fixture.resolve(isRegistered
        ? { message: "가입한 이메일로 비밀번호 재설정 안내가 발송되었습니다. 메일함과 스팸함을 확인해주세요.", notice: "password_reset_sent", retryAfterSeconds: 60 }
        : { error: "가입 이력이 없는 이메일입니다.", notice: "email_not_registered" }), registered);
      const popup = page.getByRole("dialog", { name: english ? "Notice" : "안내", exact: true });
      await expect(popup).toContainText(registered
        ? english ? "Password reset instructions have been sent to your registered email." : "가입한 이메일로 비밀번호 재설정 안내가 발송되었습니다."
        : english ? "This email has no signup history." : "가입 이력이 없는 이메일입니다.");
      await expect(popup.getByRole("button")).toBeFocused();
      await popup.getByRole("button").click();
      await expect(page.locator("#reset-email")).toHaveValue("owner@example.invalid");
      if (registered) {
        await expect(page.getByRole("button", { name: english ? /Resend in \d+ seconds/ : /초 후 다시 보내기/ })).toBeDisabled();
        await expect(page.getByRole("status")).toContainText("비밀번호 재설정 안내가 발송되었습니다.");
      } else {
        await expect(page.getByRole("status")).toHaveCount(0);
        await expect(page.getByRole("button", { name: sendLink, exact: true })).toBeEnabled();
        // The same response on a new submission must show another popup.
        await page.getByRole("button", { name: sendLink, exact: true }).click();
        await page.evaluate(() => (window as unknown as { __fixture: { resolve: (value: object) => void } }).__fixture.resolve({ error: "가입 이력이 없는 이메일입니다.", notice: "email_not_registered" }));
        await expect(popup).toBeVisible();
      }
    });
  }

  test(`${english ? "English" : "Korean"} login offers password reset and signup without account lookup`, async ({ page }) => {
    const prefix = english ? "/en" : "";
    await page.goto(`http://auth-ui.test${prefix}/login?next=%2Fdashboard%2Fnew`);
    await expect(page.locator('a[href*="find-id"]')).toHaveCount(0);
    await expect(page.getByText(/아이디 찾기|Find account/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: english ? "Forgot password" : "비밀번호 찾기", exact: true })).toHaveAttribute("href", `${prefix}/forgot-password?next=${encodeURIComponent(`${prefix}/dashboard/new`)}`);
    await expect(page.getByRole("link", { name: english ? "Sign up" : "회원가입", exact: true })).toHaveAttribute("href", `${prefix}/signup?next=${encodeURIComponent(`${prefix}/dashboard/new`)}`);
    if (english) await expect(page.getByText(/[가-힣]/)).toHaveCount(0);
  });
}
