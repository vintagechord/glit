import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("auth actions validate, map transport failures, preserve safe login redirects and avoid duplicate reset attempts", async () => {
  const result = await build({ stdin: { contents: `export * from './src/features/auth/actions'; export {state,calls} from 'auth-fixture';`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "auth-action-test", setup(plugin) {
      plugin.onResolve({ filter: /^(auth-fixture|@\/lib\/supabase\/(?:server|admin|env)|@\/lib\/email|@\/lib\/request-rate-limit|next\/(?:navigation|headers)|.*account-lookup)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = `import {state,calls} from 'auth-fixture';`;
        const files: Record<string, string> = {
          'auth-fixture': `export const state={error:null,throws:false,linkData:null,emailResult:{ok:true},limited:false,account:{id:'fixture',email:'qa@example.invalid',email_confirmed_at:'2026-01-01'}}; export const calls=[];`,
          '@/lib/supabase/server': `${shared} export async function createServerSupabase(){ return {auth:{signInWithPassword:async input=>{calls.push({method:'login',input});if(state.throws)throw state.error;return {error:state.error};},resetPasswordForEmail:async()=>{calls.push({method:'reset'});return {error:state.error};}}}; }`,
          '@/lib/supabase/env': `export const getServiceRoleKey=()=> 'fixture-only-signing-key';`,
          '@/lib/supabase/admin': `${shared} export function createAdminClient(){return {auth:{admin:{createUser:async input=>{calls.push({method:'signup',input});return {data:{user:{id:'fixture'}},error:state.error};},generateLink:async()=>{calls.push({method:'generateLink'});return {data:state.linkData,error:state.error};}}}};}`,
          './account-lookup': `${shared} export const SIGNUP_VERIFICATION_FLOW='email_password_v1'; export async function findAccountByEmail(){return state.account;}`,
          '@/lib/email': `${shared} export async function sendSignupVerificationEmail(){return {ok:true};} export async function sendWelcomeEmail(){calls.push({method:'welcome'});return {ok:true};} export async function sendPasswordResetEmail(input){calls.push({method:'sendReset',input});return state.emailResult;}`,
          '@/lib/request-rate-limit': `${shared} export const consumePersistentRateLimit=()=>({allowed:!state.limited,retryAfterSeconds:state.limited?120:0}); export const getRequestIdentifier=()=> 'fixture';`,
          'next/navigation': `export function redirect(location){throw Object.assign(new Error('test redirect'),{location});}`,
          'next/headers': `export async function headers(){return new Headers();}`,
        };
        return { loader: "js", contents: files[path] };
      });
    } }],
  });
  type Action = (_: object, form: FormData) => Promise<{ error?: string; fieldErrors?: Record<string, string>; message?: string; notice?: string; retryAfterSeconds?: number }>;
  const bundled = { exports: {} as { state: { error: unknown; throws: boolean; linkData: unknown; emailResult: {ok:boolean;reason?:string;retryAfterSeconds?:number}; limited:boolean; account: {id:string;email:string;email_confirmed_at:string}|null }; calls: { method: string; input?: unknown }[]; loginAction: Action; signupAction: Action; resetPasswordAction: Action } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  const auth = bundled.exports;
  const form = (values: Record<string, string>) => { const body = new FormData(); for (const [name, value] of Object.entries(values)) body.set(name, value); return body; };
  const signIn = { email: "qa@example.invalid", password: "legacy" };
  const originalResend = process.env.RESEND_API_KEY;
  const originalSender = process.env.RESEND_FROM;
  const originalEmailMode = process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE;
  const validSender = "onside <noreply@example.invalid>";
  process.env.RESEND_FROM = validSender;
  try {
    for (const throws of [false, true]) {
      auth.state.error = new TypeError("fetch failed"); auth.state.throws = throws;
      const state = await auth.loginAction({}, form(signIn));
      assert.match(state.error ?? "", /인증 서버에 연결/); assert.doesNotMatch(state.error ?? "", /fetch/);
    }
    auth.state.error = null; auth.state.throws = false;
    for (const [next, expected] of [["/admin/review-docs", "/admin/review-docs"], ["https://evil.test", "/mypage"], ["/login?next=%2Fadmin", "/mypage"], ["/en/login?loop=1", "/mypage"]]) {
      await assert.rejects(auth.loginAction({}, form({ ...signIn, next })), (error: unknown) => (error as { location: string }).location === expected);
    }
    await assert.rejects(auth.loginAction({}, form({ ...signIn, locale: "en", next: "/dashboard/new?draft=fixture" })), (error: unknown) => (error as { location: string }).location === "/en/dashboard/new?draft=fixture");
    await assert.rejects(auth.loginAction({}, form({ ...signIn, locale: "en", next: "//evil.invalid" })), (error: unknown) => (error as { location: string }).location === "/en/mypage");
    auth.calls.length = 0;
    process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = "manual";
    const signup = await auth.signupAction({}, form({ ...signIn, password: "fixture-password", confirmPassword: "fixture-password", agreeAge: "on", agreeTerms: "on", agreePrivacy: "on", agreeRefund: "on" }));
    assert.ok(signup.message);
    const created = auth.calls.find(call => call.method === "signup")?.input as { app_metadata: { signupConsent: { acceptedAt: string; versions: object; marketing: boolean; age14OrOlder: boolean }; emailOwnershipVerifiedAtSignup: boolean } };
    assert.equal(created.app_metadata.emailOwnershipVerifiedAtSignup, false);
    assert.equal(created.app_metadata.signupConsent.marketing, false);
    assert.equal(created.app_metadata.signupConsent.age14OrOlder, true);
    assert.ok(Number.isFinite(Date.parse(created.app_metadata.signupConsent.acceptedAt)));
    assert.deepEqual(Object.keys(created.app_metadata.signupConsent.versions).sort(), ["privacy", "refund", "terms"]);
    auth.calls.length = 0;
    auth.state.error = { code: "email_exists" };
    const duplicate = await auth.signupAction({}, form({ ...signIn, password: "fixture-password", confirmPassword: "fixture-password", agreeAge: "on", agreeTerms: "on", agreePrivacy: "on", agreeRefund: "on" }));
    assert.equal(duplicate.error, "이미 가입된 이메일입니다.");
    assert.equal(duplicate.notice, "email_already_registered");
    assert.equal(duplicate.message, undefined);
    assert.deepEqual(auth.calls.map(call => call.method), ["signup"], "duplicate manual signup must not send a welcome email");
    auth.state.error = null;
    auth.calls.length = 0;
    const invalidSignup = await auth.signupAction({}, form({ ...signIn, password: "123", confirmPassword: "123", agreeAge: "on", agreeTerms: "on", agreePrivacy: "on", agreeRefund: "on" }));
    assert.match(invalidSignup.fieldErrors?.password ?? "", /8자 이상/); assert.equal(auth.calls.length, 0);
    process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = "transactional";
    process.env.RESEND_API_KEY = "fixture-only";
    for (const from of [undefined, "", "onside <myonside@daum.net>", "onside <noreply@example.invalid>\r\nBcc: private@example.invalid"]) {
      if (from === undefined) delete process.env.RESEND_FROM;
      else process.env.RESEND_FROM = from;
      auth.calls.length = 0;
      const blocked = await auth.resetPasswordAction({}, form({ resetEmail: signIn.email }));
      assert.match(blocked.error ?? "", /메일 발송 설정/);
      assert.equal(blocked.message, undefined);
      assert.deepEqual(auth.calls, [], "invalid senders must not create a token, send custom mail, or fall back to default mail");
    }
    process.env.RESEND_FROM = validSender;
    auth.state.error = { message: "fetch failed", name: "AuthRetryableFetchError" };
    const reset = await auth.resetPasswordAction({}, form({ resetEmail: signIn.email }));
    assert.ok(reset.error); assert.equal(reset.message, undefined); assert.equal(reset.notice, undefined); assert.deepEqual(auth.calls.map((call) => call.method), ["generateLink"]);
    delete process.env.RESEND_API_KEY; auth.calls.length = 0;
    await auth.resetPasswordAction({}, form({ resetEmail: signIn.email }));
    assert.equal(auth.calls.length, 0, "unconfigured mail must not consume Supabase built-in quota");
    process.env.RESEND_API_KEY = "fixture-only";
    auth.state.error = null;
    auth.state.linkData = { user: auth.state.account, properties: { hashed_token: "fixture-recovery-hash", verification_type: "recovery", action_link: "https://provider.invalid/consume-once" } };
    auth.calls.length = 0;
    const sent = await auth.resetPasswordAction({}, form({ resetEmail: signIn.email }));
    assert.equal(sent.message, "가입한 이메일로 비밀번호 재설정 안내가 발송되었습니다. 메일함과 스팸함을 확인해주세요.");
    assert.equal(sent.notice, "password_reset_sent");
    assert.equal(sent.retryAfterSeconds, 60);
    assert.deepEqual(auth.calls.map((call) => call.method), ["generateLink", "sendReset"]);
    const sentLink = new URL((auth.calls[1].input as {link:string}).link);
    assert.equal(sentLink.pathname, "/reset-password");
    assert.equal(new URLSearchParams(sentLink.hash.slice(1)).get("token_hash"), "fixture-recovery-hash");
    assert.equal(new URLSearchParams(sentLink.hash.slice(1)).get("type"), "recovery");
    auth.calls.length = 0;
    await auth.resetPasswordAction({}, form({ resetEmail: signIn.email, locale: "en", next: "/dashboard/new?draft=fixture" }));
    const localizedLink = new URL((auth.calls[1].input as {link:string}).link);
    assert.equal(localizedLink.pathname, "/en/reset-password");
    assert.equal(localizedLink.searchParams.get("next"), "/en/dashboard/new?draft=fixture");

    for (const reason of ["configuration", "rate_limit", "delivery"]) {
      auth.calls.length = 0;
      auth.state.emailResult = { ok: false, reason, retryAfterSeconds: reason === "rate_limit" ? 90 : undefined };
      const failed = await auth.resetPasswordAction({}, form({ resetEmail: signIn.email }));
      assert.ok(failed.error, "delivery failures must let the customer retry instead of wait for unsent mail");
      assert.equal(failed.message, undefined);
      assert.equal(failed.notice, undefined);
      assert.deepEqual(auth.calls.map((call) => call.method), ["generateLink", "sendReset"], "custom delivery failures must not consume default email quota or issue a second token");

    }
    auth.calls.length = 0;
    auth.state.account = null;
    auth.state.error = { code: "user_not_found" };
    const unknown = await auth.resetPasswordAction({}, form({ resetEmail: signIn.email }));
    assert.equal(unknown.error, "가입 이력이 없는 이메일입니다.");
    assert.equal(unknown.notice, "email_not_registered");
    assert.equal(unknown.message, undefined);
    assert.equal(auth.calls.length, 0);
    auth.calls.length = 0;
    auth.state.limited = true;
    const limited = await auth.resetPasswordAction({}, form({ resetEmail: signIn.email }));
    assert.equal(limited.retryAfterSeconds, 120);
    assert.equal(auth.calls.length, 0);

    auth.state.limited = false;
    for (const mode of ["manual", "unexpected-value"]) {
      process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = mode;
      for (const configured of [true, false]) {
        if (configured) process.env.RESEND_API_KEY = "fixture-only";
        else delete process.env.RESEND_API_KEY;
        auth.calls.length = 0;
        const blocked = await auth.resetPasswordAction({}, form({ resetEmail: signIn.email }));
        assert.match(blocked.error ?? "", /고객센터/);
        assert.equal(blocked.message, undefined);
        assert.deepEqual(auth.calls, [], "deferred or invalid delivery must not generate tokens, send mail, or invoke Supabase fallback");
      }
    }

  } finally {
    if (originalResend === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalResend;
    if (originalSender === undefined) delete process.env.RESEND_FROM; else process.env.RESEND_FROM = originalSender;
    if (originalEmailMode === undefined) delete process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE; else process.env.NEXT_PUBLIC_EMAIL_DELIVERY_MODE = originalEmailMode;
  }
});
