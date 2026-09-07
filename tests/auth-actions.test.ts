import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("auth actions validate, map transport failures, preserve safe login redirects and avoid duplicate reset attempts", async () => {
  const result = await build({ stdin: { contents: `export * from './src/features/auth/actions'; export {state,calls} from 'auth-fixture';`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "auth-action-test", setup(plugin) {
      plugin.onResolve({ filter: /^(auth-fixture|@\/lib\/supabase\/(?:server|admin)|@\/lib\/email|@\/lib\/request-rate-limit|next\/(?:navigation|headers))$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = `import {state,calls} from 'auth-fixture';`;
        const files: Record<string, string> = {
          'auth-fixture': `export const state={error:null,throws:false}; export const calls=[];`,
          '@/lib/supabase/server': `${shared} export async function createServerSupabase(){ return {auth:{signInWithPassword:async input=>{calls.push({method:'login',input});if(state.throws)throw state.error;return {error:state.error};},resetPasswordForEmail:async()=>{calls.push({method:'reset'});return {error:state.error};}}}; }`,
          '@/lib/supabase/admin': `${shared} export function createAdminClient(){return {auth:{admin:{createUser:async()=>{calls.push({method:'signup'});return {data:{user:{id:'fixture'}},error:state.error};},generateLink:async()=>{calls.push({method:'generateLink'});return {data:null,error:state.error};}}}};}`,
          '@/lib/email': `${shared} export async function sendWelcomeEmail(){calls.push({method:'welcome'});return {ok:true};} export async function sendPasswordResetEmail(){calls.push({method:'sendReset'});return {ok:true};}`,
          '@/lib/request-rate-limit': `export const consumeRateLimit=()=>({allowed:true}); export const getRequestIdentifier=()=> 'fixture';`,
          'next/navigation': `export function redirect(location){throw Object.assign(new Error('test redirect'),{location});}`,
          'next/headers': `export async function headers(){return new Headers();}`,
        };
        return { loader: "js", contents: files[path] };
      });
    } }],
  });
  type Action = (_: object, form: FormData) => Promise<{ error?: string; fieldErrors?: Record<string, string>; message?: string }>;
  const bundled = { exports: {} as { state: { error: unknown; throws: boolean }; calls: { method: string; input?: unknown }[]; loginAction: Action; signupAction: Action; resetPasswordAction: Action } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  const auth = bundled.exports;
  const form = (values: Record<string, string>) => { const body = new FormData(); for (const [name, value] of Object.entries(values)) body.set(name, value); return body; };
  const signIn = { email: "qa@example.invalid", password: "legacy" };
  const originalResend = process.env.RESEND_API_KEY;
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
    auth.calls.length = 0;
    const invalidSignup = await auth.signupAction({}, form({ ...signIn, password: "123", confirmPassword: "123", agreeAge: "on", agreeTerms: "on", agreePrivacy: "on", agreeRefund: "on" }));
    assert.match(invalidSignup.fieldErrors?.password ?? "", /8자 이상/); assert.equal(auth.calls.length, 0);
    process.env.RESEND_API_KEY = "fixture-only";
    auth.state.error = { message: "fetch failed", name: "AuthRetryableFetchError" };
    const reset = await auth.resetPasswordAction({}, form({ resetEmail: signIn.email }));
    assert.match(reset.error ?? "", /인증 서버에 연결/); assert.deepEqual(auth.calls.map((call) => call.method), ["generateLink"]);
    delete process.env.RESEND_API_KEY; auth.calls.length = 0;
    await auth.resetPasswordAction({}, form({ resetEmail: signIn.email }));
    assert.deepEqual(auth.calls.map((call) => call.method), ["reset"], "no custom-link request when custom sender is not configured");
  } finally {
    if (originalResend === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalResend;
  }
});
