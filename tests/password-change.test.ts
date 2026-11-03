import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import type { ActionState } from "../src/features/auth/actions";

type Fixture = {
  updatePasswordAction: (state: ActionState, body: FormData) => Promise<ActionState>;
  state: { user: Record<string, unknown> | null; verifyError: unknown; verifiedUserId: string; limited: boolean; updateError: unknown };
  calls: Array<{ client: "session" | "isolated" | "admin"; method: string; input?: unknown }>;
};

async function fixture(): Promise<Fixture> {
  const result = await build({
    stdin: { contents: "export {updatePasswordAction} from './src/features/auth/actions'; export {state,calls} from 'password-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "password-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(password-fixture|@\/lib\/supabase\/(?:server|admin|env)|@\/lib\/email|@\/lib\/request-rate-limit|next\/(?:navigation|headers)|.*account-lookup)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls} from 'password-fixture';";
        const modules: Record<string, string> = {
          "password-fixture": "export const calls=[]; export const state={user:{id:'member',email:'member@example.invalid',identities:[{provider:'email'}],app_metadata:{provider:'email',providers:['email']}},verifyError:null,verifiedUserId:'member',limited:false,updateError:null};",
          "@/lib/supabase/server": `${shared} export async function createServerSupabase(){return {auth:{
            getUser:async()=>({data:{user:state.user},error:null}),
            signInWithPassword:async input=>{calls.push({client:'session',method:'signIn',input});return {data:{},error:null};},
            updateUser:async input=>{calls.push({client:'session',method:'update',input});return {error:state.updateError};},
            signOut:async input=>{calls.push({client:'session',method:'signOut',input});return {error:null};}}};}`,
          "@/lib/supabase/env": "export const getServiceRoleKey=()=> 'fixture-signing-key';",
          "@/lib/supabase/admin": `${shared} export function createAdminClient(){return {auth:{
            signInWithPassword:async input=>{calls.push({client:'isolated',method:'signIn',input});if(state.verifyError)return {data:{user:null,session:null},error:state.verifyError};return {data:{user:{id:state.verifiedUserId},session:{access_token:'check-session'}},error:null};},
            admin:{signOut:async(token,scope)=>{calls.push({client:'admin',method:'revoke',input:{token,scope}});return {error:null};}}}};}`,
          "@/lib/email": "export const sendWelcomeEmail=()=>{throw Error('unexpected mail')};export const sendSignupVerificationEmail=sendWelcomeEmail;export const sendPasswordResetEmail=sendWelcomeEmail;",
          "@/lib/request-rate-limit": `${shared} export const consumePersistentRateLimit=async input=>{calls.push({client:'admin',method:'limit',input});return {allowed:!state.limited,retryAfterSeconds:120};}; export const getRequestIdentifier=()=> 'fixture';`,
          "next/navigation": "export function redirect(){throw Error('unexpected redirect');}",
          "next/headers": "export async function headers(){return new Headers();}",
          "./account-lookup": "export const SIGNUP_VERIFICATION_FLOW='email_password_v1'; export async function findAccountByEmail(){throw Error('unexpected lookup');}",
        };
        return { contents: modules[path], loader: "js" };
      });
    } }],
  });
  const bundled = { exports: {} as Fixture };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  return bundled.exports;
}

const form = (values: Record<string, string>) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(values)) body.set(key, value);
  return body;
};
const change = { currentPassword: "current-secret", newPassword: "new-secret-123", confirmPassword: "new-secret-123" };

test("password change verifies the current password on an isolated client before updating", async () => {
  const auth = await fixture();
  const result = await auth.updatePasswordAction({}, form(change));
  assert.match(result.message ?? "", /비밀번호가 변경되었습니다/);
  assert.deepEqual(auth.calls.map(call => `${call.client}:${call.method}`), ["admin:limit", "isolated:signIn", "admin:revoke", "session:update", "session:signOut"]);
  assert.deepEqual(auth.calls[1].input, { email: "member@example.invalid", password: "current-secret" });
  assert.deepEqual(auth.calls[2].input, { token: "check-session", scope: "local" }, "the check's own session is revoked");
  assert.deepEqual(auth.calls[3].input, { password: "new-secret-123" });
  assert.deepEqual(auth.calls[4].input, { scope: "others" }, "other sessions must sign in again");
  assert.equal((auth.calls[0].input as { identifier: string }).identifier, "member");
  assert.equal(auth.calls.some(call => call.client === "session" && call.method === "signIn"), false, "the browser session cookies are never rewritten by the check");
});

test("a session alone cannot set a password", async () => {
  const missing = await fixture();
  const noCurrent = await missing.updatePasswordAction({}, form({ newPassword: change.newPassword, confirmPassword: change.confirmPassword }));
  assert.equal(noCurrent.fieldErrors?.currentPassword, "현재 비밀번호를 입력해주세요.");
  assert.equal(missing.calls.length, 0);

  const wrong = await fixture();
  wrong.state.verifyError = { code: "invalid_credentials", status: 400, message: "Invalid login credentials" };
  const rejected = await wrong.updatePasswordAction({}, form(change));
  assert.equal(rejected.fieldErrors?.currentPassword, "현재 비밀번호가 올바르지 않습니다.");
  assert.equal(wrong.calls.some(call => call.method === "update"), false);

  const otherUser = await fixture();
  otherUser.state.verifiedUserId = "someone-else";
  assert.ok((await otherUser.updatePasswordAction({}, form(change))).fieldErrors?.currentPassword);
  assert.equal(otherUser.calls.some(call => call.method === "update"), false);
  assert.ok(otherUser.calls.some(call => call.method === "revoke"), "a verified session for another account is still revoked");

  const limited = await fixture();
  limited.state.limited = true;
  const tooMany = await limited.updatePasswordAction({}, form(change));
  assert.equal(tooMany.retryAfterSeconds, 120);
  assert.equal(limited.calls.some(call => call.method === "signIn" || call.method === "update"), false);

  const offline = await fixture();
  offline.state.verifyError = { name: "AuthRetryableFetchError", message: "fetch failed" };
  const unreachable = await offline.updatePasswordAction({}, form(change));
  assert.match(unreachable.error ?? "", /인증 서버에 연결/);
  assert.equal(unreachable.fieldErrors, undefined, "an outage is not reported as a wrong password");
});

test("social-only accounts are rejected on the server, matching the hidden profile form", async () => {
  for (const user of [
    { id: "member", email: "member@example.invalid", identities: [{ provider: "kakao" }], app_metadata: { provider: "kakao", providers: ["kakao"] } },
    { id: "member", email: null, identities: [{ provider: "custom:naver" }], app_metadata: { provider: "custom:naver", hasPassword: true } },
  ]) {
    const auth = await fixture();
    auth.state.user = user;
    const result = await auth.updatePasswordAction({}, form(change));
    assert.match(result.error ?? "", /소셜 로그인 계정/);
    assert.equal(auth.calls.length, 0);
  }
  const anonymous = await fixture();
  anonymous.state.user = null;
  assert.equal((await anonymous.updatePasswordAction({}, form(change))).error, "로그인이 필요합니다.");
});

test("profile form asks for the current password", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/features/profile/profile-form.tsx", "utf8");
  assert.match(source, /name="currentPassword"/);
  assert.match(source, /autoComplete="current-password"/);
});
