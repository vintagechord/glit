import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import type { ActionState } from "../src/features/auth/actions";

type Action = (state: ActionState, body: FormData) => Promise<ActionState>;
type Fixture = {
  signupAction: Action; resendSignupAction: Action; confirmSignupAction: Action; findAccountIdAction: Action; resetPasswordAction: Action; completePasswordRecoveryAction: Action;
  state: {
    configured: boolean; limited: boolean; signupError: unknown; updateError: unknown; signOutError: unknown; verifyError: unknown;
    account: { id: string; email: string; email_confirmed_at?: string; signupVerificationFlow?: string } | null;
    linkType: string; linkUser: Record<string, unknown> | null; mailOk: boolean; used: boolean;
  };
  calls: Array<{ method: string; input?: Record<string, unknown> }>;
};

async function fixture(): Promise<Fixture> {
  const result = await build({
    stdin: { contents: "export * from './src/features/auth/actions'; export {state,calls} from 'verification-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "verification-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(verification-fixture|@\/lib\/supabase\/(?:server|admin|env)|@\/lib\/email(?:-config)?|@\/lib\/request-rate-limit|next\/(?:navigation|headers)|.*account-lookup)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls} from 'verification-fixture';";
        const modules: Record<string, string> = {
          "verification-fixture": `export const calls=[]; export const state={configured:true,limited:false,signupError:null,updateError:null,signOutError:null,verifyError:null,account:null,linkType:'signup',linkUser:null,mailOk:true,used:false};`,
          "@/lib/supabase/server": `export async function createServerSupabase(){throw Error('unexpected public/session client');}`,
          "@/lib/supabase/env": `export const getServiceRoleKey=()=> 'fixture-signing-key';`,
          "@/lib/supabase/admin": `${shared} export function createAdminClient(){return {auth:{
            verifyOtp:async input=>{calls.push({method:'verify',input});if(state.used||state.verifyError)return {data:{session:null},error:state.verifyError||{code:'otp_expired'}};state.used=true;return {data:{user:{id:'fixture',email:'owner@example.invalid'},session:{access_token:'private-session'}},error:null};},
            updateUser:async input=>{calls.push({method:'password',input});return {error:state.updateError};},
            admin:{createUser:async input=>{calls.push({method:'create',input});return {data:{user:{id:'fixture'}},error:state.signupError};},
            generateLink:async input=>{calls.push({method:'link',input});return {data:{user:state.linkUser||{id:state.account?.id||'fixture',email:'owner@example.invalid',email_confirmed_at:state.account?.email_confirmed_at,app_metadata:{signupVerificationFlow:'email_password_v1'}},properties:{hashed_token:'private-signup-token-0123456789',verification_type:state.linkType}},error:null};},
            signOut:async(token,scope)=>{calls.push({method:'revoke',input:{scope}});return {error:state.signOutError};}}}};}`,
          "@/lib/email-config": `${shared} export const getEmailDeliveryConfiguration=()=>({ok:state.configured,provider:'gmail'});`,
          "@/lib/email": `${shared} const send=(method,input)=>{calls.push({method,input});return Promise.resolve({ok:state.mailOk,reason:state.mailOk?undefined:'delivery'});}; export const sendWelcomeEmail=input=>send('welcome',input); export const sendSignupVerificationEmail=input=>send('confirmationMail',input); export const sendAccountIdEmail=input=>send('accountMail',input); export const sendPasswordResetEmail=input=>send('resetMail',input);`,
          "./account-lookup": `${shared} export const SIGNUP_VERIFICATION_FLOW='email_password_v1'; export async function findAccountByEmail(email){calls.push({method:'lookup',input:{email}});return state.account;}`,
          "@/lib/request-rate-limit": `${shared} export const consumePersistentRateLimit=()=>({allowed:!state.limited,retryAfterSeconds:120}); export const getRequestIdentifier=()=> 'fixture';`,
          "next/navigation": "export function redirect(){throw Error('unexpected redirect');}",
          "next/headers": "export async function headers(){return new Headers();}",
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
const signup = { email: "owner@example.invalid", password: "attacker-known", confirmPassword: "attacker-known", agreeAge: "on", agreeTerms: "on", agreePrivacy: "on", agreeRefund: "on" };
const confirmation = { token_hash: "private-signup-token-0123456789", type: "signup", newPassword: "owner-new-password", confirmPassword: "owner-new-password", signature: createHmac("sha256", "fixture-signing-key").update("onside.signup.email_password_v1\0private-signup-token-0123456789").digest("hex") };

test("transactional signup stores unknown temporary credentials and confirms only through mailed token", async () => {
  const auth = await fixture();
  const result = await auth.signupAction({}, form({ ...signup, locale: "en", next: "/dashboard/new?draft=fixture" }));
  assert.equal(result.verificationPending, true);
  assert.deepEqual(auth.calls.map(call => call.method), ["create", "link", "confirmationMail"]);
  const created = auth.calls[0].input!;
  assert.equal(created.email_confirm, false);
  assert.notEqual(created.password, signup.password);
  assert.ok(String(created.password).length >= 32);
  assert.equal((created.app_metadata as { signupConsent: { age14OrOlder: boolean } }).signupConsent.age14OrOlder, true);
  assert.equal(auth.calls[1].input?.password, "", "link generation cannot set or overwrite a password");
  assert.equal(auth.calls[1].input?.type, "signup");
  const link = new URL(String(auth.calls[2].input?.link));
  assert.equal(link.pathname, "/en/confirm-email");
  assert.equal(link.searchParams.get("next"), "/en/dashboard/new?draft=fixture");
  assert.equal(link.searchParams.has("token_hash"), false, "tokens must not appear in page requests");
  assert.equal(new URLSearchParams(link.hash.slice(1)).get("type"), "signup");
  assert.equal(new URLSearchParams(link.hash.slice(1)).get("signature"), confirmation.signature);
  assert.doesNotMatch(JSON.stringify(result), /private-signup|attacker-known/);
});

test("signup retry cannot replace pending credentials or send a confirmation to an already confirmed account", async () => {
  const auth = await fixture();
  auth.state.signupError = { code: "email_exists" };
  auth.state.account = { id: "pending", email: signup.email, signupVerificationFlow: "email_password_v1" };
  const retried = await auth.signupAction({}, form(signup));
  assert.equal(retried.verificationPending, true);
  assert.deepEqual(auth.calls.map(call => call.method), ["create", "lookup", "link", "confirmationMail"]);
  assert.equal(auth.calls.find(call => call.method === "link")?.input?.password, "");
  assert.equal(auth.calls.some(call => call.method === "password"), false);
  auth.calls.length = 0;
  auth.state.account.email_confirmed_at = "2026-01-01T00:00:00Z";
  const confirmed = await auth.signupAction({}, form(signup));
  assert.equal(confirmed.message, retried.message);
  assert.deepEqual(auth.calls.map(call => call.method), ["create", "lookup"]);
  auth.calls.length = 0;
  await auth.resendSignupAction({}, form({ email: signup.email }));
  assert.deepEqual(auth.calls.map(call => call.method), ["lookup"]);
  auth.calls.length = 0;
  auth.state.account = { id: "legacy-pending", email: signup.email };
  await auth.signupAction({}, form(signup));
  await auth.resendSignupAction({}, form({ email: signup.email }));
  assert.deepEqual(auth.calls.map(call => call.method), ["create", "lookup", "lookup"], "legacy pending credentials must never be activated by this flow");
});

test("confirmation replaces the password only after ownership proof, revokes sessions, and rejects replay and wrong token types", async () => {
  const auth = await fixture();
  for (const value of [{ ...confirmation, type: "recovery" }, { ...confirmation, token_hash: "" }, { ...confirmation, confirmPassword: "mismatch" }, { ...confirmation, signature: "" }, { ...confirmation, signature: "0".repeat(64) }, { ...confirmation, token_hash: "different-legacy-pending-token" }]) {
    const result = await auth.confirmSignupAction({}, form(value));
    assert.ok(result.error || result.fieldErrors);
    assert.equal(auth.calls.length, 0);
  }
  const result = await auth.confirmSignupAction({}, form(confirmation));
  assert.ok(result.message);
  assert.deepEqual(auth.calls.map(call => call.method), ["verify", "password", "revoke", "welcome"]);
  assert.deepEqual(auth.calls[0].input, { type: "signup", token_hash: confirmation.token_hash });
  assert.deepEqual(auth.calls[1].input, { password: confirmation.newPassword });
  assert.equal(auth.calls[2].input?.scope, "global");
  assert.equal(auth.calls[3].input?.email, signup.email);
  assert.equal(auth.calls[3].input?.idempotencyKey, "welcome:fixture");
  auth.calls.length = 0;
  const replay = await auth.confirmSignupAction({}, form(confirmation));
  assert.ok(replay.error);
  assert.equal(replay.message, undefined);
  assert.deepEqual(auth.calls.map(call => call.method), ["verify"]);
});

test("confirmation and mail failures never report signup completion", async () => {
  for (const phase of ["verifyError", "updateError", "signOutError"] as const) {
    const auth = await fixture();
    auth.state[phase] = { code: "fixture_error" };
    const result = await auth.confirmSignupAction({}, form(confirmation));
    assert.ok(result.error);
    assert.equal(result.message, undefined);
    if (phase === "verifyError") assert.deepEqual(auth.calls.map(call => call.method), ["verify"]);
    if (phase === "updateError") assert.deepEqual(auth.calls.map(call => call.method), ["verify", "password", "revoke"]);
  }
  const auth = await fixture();
  auth.state.mailOk = false;
  const failed = await auth.signupAction({}, form(signup));
  assert.ok(failed.message);
  assert.equal(failed.error, undefined);
  assert.equal(failed.verificationPending, true);
  auth.calls.length = 0;
  auth.state.linkType = "recovery";
  await auth.signupAction({}, form(signup));
  assert.equal(auth.calls.some(call => call.method === "confirmationMail"), false);
});

test("account ID lookup is generic, sends only to the existing mailbox, and never creates a token/account", async () => {
  const auth = await fixture();
  const absent = await auth.findAccountIdAction({}, form({ email: signup.email }));
  auth.state.account = { id: "member", email: signup.email };
  const found = await auth.findAccountIdAction({}, form({ email: signup.email, next: "https://evil.invalid" }));
  auth.state.mailOk = false;
  const failed = await auth.findAccountIdAction({}, form({ email: signup.email }));
  assert.deepEqual(found, absent);
  assert.deepEqual(failed, absent);
  assert.deepEqual([...new Set(auth.calls.map(call => call.method))], ["lookup", "accountMail"]);
  assert.equal(auth.calls.find(call => call.method === "accountMail")?.input?.email, signup.email);
  assert.doesNotMatch(String(auth.calls.find(call => call.method === "accountMail")?.input?.link), /evil/);
});

test("unconfigured delivery and request limits reject before account/token mutation", async () => {
  const auth = await fixture();
  auth.state.configured = false;
  for (const action of [auth.signupAction, auth.resendSignupAction, auth.findAccountIdAction, auth.resetPasswordAction]) {
    assert.ok((await action({}, form({ ...signup, resetEmail: signup.email }))).error);
  }
  assert.equal(auth.calls.length, 0);
  auth.state.configured = true;
  auth.state.limited = true;
  for (const action of [auth.signupAction, auth.resendSignupAction, auth.findAccountIdAction, auth.confirmSignupAction]) {
    assert.ok((await action({}, form({ ...signup, ...confirmation }))).error);
  }
  assert.equal(auth.calls.length, 0);
});

test("signup confirmation page never consumes the token automatically on load", async () => {
  const source = await readFile("src/features/auth/confirm-email-form.tsx", "utf8");
  assert.match(source, /<form action=\{action\}/);
  assert.doesNotMatch(source, /verifyOtp|verifyRecoverySession|\.auth\./);
});

test("recovery cannot activate legacy pending credentials; trusted pending users get signed signup instead", async () => {
  const auth = await fixture();
  const absent = await auth.resetPasswordAction({}, form({ resetEmail: signup.email }));
  auth.state.account = { id: "legacy", email: signup.email };
  auth.calls.length = 0;
  assert.deepEqual(await auth.resetPasswordAction({}, form({ resetEmail: signup.email })), absent);
  assert.deepEqual(auth.calls.map(call => call.method), ["lookup"]);
  auth.state.account.signupVerificationFlow = "email_password_v1";
  auth.calls.length = 0;
  assert.deepEqual(await auth.resetPasswordAction({}, form({ resetEmail: signup.email })), absent);
  assert.deepEqual(auth.calls.map(call => call.method), ["lookup", "link", "confirmationMail"]);
  assert.equal(auth.calls[1].input?.type, "signup");
  assert.match(String(auth.calls[2].input?.link), /confirm-email/);
  assert.equal(auth.calls.some(call => call.method === "verify" || call.method === "password"), false);
});

test("recovery signs only the same confirmed account and keeps delivery failure responses generic", async () => {
  const auth = await fixture();
  const absent = await auth.resetPasswordAction({}, form({ resetEmail: signup.email }));
  auth.state.account = { id: "member", email: signup.email, email_confirmed_at: "2026-01-01" };
  auth.state.linkType = "recovery";
  auth.calls.length = 0;
  assert.deepEqual(await auth.resetPasswordAction({}, form({ resetEmail: signup.email })), absent);
  const mailed = auth.calls.find(call => call.method === "resetMail")?.input;
  assert.ok(mailed);
  const link = new URL(String(mailed.link));
  assert.equal(link.searchParams.has("token_hash"), false);
  const fields = Object.fromEntries(new URLSearchParams(link.hash.slice(1)));
  assert.equal(fields.type, "recovery");
  assert.notEqual(fields.signature, confirmation.signature, "signup signatures cannot authorize recovery");
  auth.state.mailOk = false;
  assert.deepEqual(await auth.resetPasswordAction({}, form({ resetEmail: signup.email })), absent);
  for (const user of [
    { id: "recreated", email: signup.email, email_confirmed_at: "2026-01-01" },
    { id: "member", email: signup.email, email_confirmed_at: null },
    { id: "member", email: "other@example.invalid", email_confirmed_at: "2026-01-01" },
  ]) {
    auth.state.linkUser = user;
    auth.calls.length = 0;
    assert.deepEqual(await auth.resetPasswordAction({}, form({ resetEmail: signup.email })), absent);
    assert.equal(auth.calls.some(call => call.method === "resetMail"), false);
  }
});

test("recovery completion verifies purpose and password before OTP and rejects replay without changing credentials", async () => {
  const auth = await fixture();
  const recovery = { ...confirmation, type: "recovery", signature: createHmac("sha256", "fixture-signing-key").update(`onside.recovery.confirmed_account_v1\0${confirmation.token_hash}`).digest("hex") };
  for (const input of [confirmation, { ...recovery, signature: "" }, { ...recovery, signature: confirmation.signature }, { ...recovery, newPassword: "short" }]) {
    const result = await auth.completePasswordRecoveryAction({}, form(input));
    assert.ok(result.error || result.fieldErrors);
    assert.equal(auth.calls.length, 0);
  }
  assert.ok((await auth.completePasswordRecoveryAction({}, form(recovery))).message);
  assert.deepEqual(auth.calls.map(call => call.method), ["verify", "password", "revoke"]);
  assert.equal(auth.calls[0].input?.type, "recovery");
  auth.calls.length = 0;
  assert.ok((await auth.completePasswordRecoveryAction({}, form(recovery))).error);
  assert.deepEqual(auth.calls.map(call => call.method), ["verify"]);
  for (const phase of ["verifyError", "updateError", "signOutError"] as const) {
    const failed = await fixture();
    failed.state[phase] = { code: "fixture_failure" };
    assert.ok((await failed.completePasswordRecoveryAction({}, form(recovery))).error);
    assert.equal(failed.calls.some(call => call.method === "welcome"), false);
    if (phase === "updateError") assert.deepEqual(failed.calls.map(call => call.method), ["verify", "password", "revoke"]);
  }
});

test("signup link signing fails closed if the account changed after lookup and welcome delivery failure does not undo signup", async () => {
  const auth = await fixture();
  auth.state.linkUser = { id: "recreated", email: signup.email, app_metadata: {} };
  await auth.signupAction({}, form(signup));
  assert.equal(auth.calls.some(call => call.method === "confirmationMail"), false);
  const completion = await fixture();
  completion.state.mailOk = false;
  assert.ok((await completion.confirmSignupAction({}, form(confirmation))).message);
  assert.equal(completion.calls.filter(call => call.method === "welcome").length, 1);
});
