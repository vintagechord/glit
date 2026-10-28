import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import type { User } from "@supabase/supabase-js";
import { SIGNUP_POLICY_VERSIONS } from "../src/features/auth/policy";
import { getProfileAuthDetails } from "../src/features/profile/profile-auth";

type Fixture = {
  state: { user: User | null; authError: object | null; updateError: object | null; refreshError: object | null; refreshDifferentUser: boolean };
  calls: { method: string; id?: string; input?: Record<string, unknown> }[];
  completeSignupAction: (state: object, form: FormData) => Promise<{ error?: string }>;
};
const compilation = build({
  stdin: { contents: "export * from './src/features/auth/complete-signup-action';export {state,calls} from 'consent-fixture';", resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "consent-fixture", setup(plugin) {
    plugin.onResolve({ filter: /^(consent-fixture|@\/lib\/supabase\/(server|admin)|next\/navigation)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: {
      "consent-fixture": "export const state={user:null,authError:null,updateError:null,refreshError:null,refreshDifferentUser:false};export const calls=[];",
      "@/lib/supabase/server": `import {state,calls} from 'consent-fixture';export async function createServerSupabase(options){calls.push({method:'client',input:options});return {auth:{getUser:async()=>({data:{user:state.user},error:state.authError}),refreshSession:async()=>{calls.push({method:'refresh'});const user=state.refreshDifferentUser?{...state.user,id:'different-user'}:state.user;return {data:{user,session:state.refreshError?null:{user}},error:state.refreshError};}}};}`,
      "@/lib/supabase/admin": `import {state,calls} from 'consent-fixture';export function createAdminClient(){return {auth:{admin:{updateUserById:async(id,input)=>{calls.push({method:'update',id,input});if(!state.updateError)state.user={...state.user,app_metadata:{...state.user.app_metadata,...input.app_metadata}};return {error:state.updateError};}}}};}`,
      "next/navigation": "export function redirect(location){throw Object.assign(new Error('test redirect'),{location});}",
    }[path]! }));
  } }],
});

async function harness() {
  const result = await compilation;
  const fixtureModule = { exports: {} as Fixture };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), fixtureModule, fixtureModule.exports);
  fixtureModule.exports.state.user = { id: "verified-social-user", email: "", aud: "authenticated", created_at: "2026-10-29T00:00:00Z", app_metadata: { provider: "custom:naver", providers: ["custom:naver"], role: "existing-role", retained: "keep-me" }, user_metadata: {}, identities: [{ provider: "custom:naver", id: "naver-identity", identity_id: "naver-identity", user_id: "verified-social-user" }] };
  return fixtureModule.exports;
}
function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ agreeAge: "on", agreeTerms: "on", agreePrivacy: "on", agreeRefund: "on", ...values })) data.set(key, value);
  return data;
}
const redirectTo = (location: string) => (error: unknown) => (error as { location: string }).location === location;

test("completion writes only verified user's consent, preserves metadata, refreshes session, and localizes safe draft return", async () => {
  const h = await harness();
  await assert.rejects(h.completeSignupAction({}, form({ locale: "en", next: "/dashboard/new/album?draft=saved#tracks", userId: "forged", role: "admin" })), redirectTo("/en/dashboard/new/album?draft=saved#tracks"));
  assert.deepEqual(h.calls.map((call) => call.method), ["client", "update", "refresh"]);
  assert.deepEqual(h.calls[0].input, { allowIncompleteSocialSignup: true });
  const updated = h.calls[1];
  assert.equal(updated.id, "verified-social-user");
  assert.deepEqual(Object.keys(updated.input!), ["app_metadata"]);
  const metadata = updated.input!.app_metadata as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(metadata), ["signupConsent"]);
  assert.deepEqual(metadata.signupConsent.versions, SIGNUP_POLICY_VERSIONS);
  assert.equal(metadata.signupConsent.marketing, false);
  assert.equal(metadata.signupConsent.age14OrOlder, true);
  assert.ok(Number.isFinite(Date.parse(String(metadata.signupConsent.acceptedAt))));
  assert.equal(h.state.user?.app_metadata.role, "existing-role");
  assert.equal(h.state.user?.app_metadata.retained, "keep-me");
  assert.equal(h.state.user?.email, "", "completion must not invent an email");
});

test("each required consent is validated server-side and editable metadata is ignored", async () => {
  for (const field of ["agreeAge", "agreeTerms", "agreePrivacy", "agreeRefund"]) {
    const h = await harness();
    h.state.user!.user_metadata = { signupConsent: { age14OrOlder: true, terms: true, privacy: true, refund: true, acceptedAt: "2026-10-29" } };
    const result = await h.completeSignupAction({}, form({ [field]: "false" }));
    assert.match(result.error!, /필수/);
    assert.deepEqual(h.calls.map((call) => call.method), ["client"]);
  }
});

test("unauthenticated submission cannot write and receives a safe login return", async () => {
  const h = await harness(); h.state.user = null;
  await assert.rejects(h.completeSignupAction({}, form({ locale: "en", next: "https://external.invalid" })), redirectTo("/en/login?next=%2Fen%2Fmypage"));
  assert.equal(h.calls.filter((call) => call.method === "update").length, 0);
});

test("failed save cannot claim success or refresh session", async () => {
  const h = await harness(); h.state.updateError = { message: "internal details" };
  const result = await h.completeSignupAction({}, form({ locale: "en" }));
  assert.match(result.error!, /Could not save/);
  assert.doesNotMatch(result.error!, /internal details/);
  assert.equal(h.calls.some((call) => call.method === "refresh"), false);
});

test("a failed session refresh can be retried without rewriting consent or marketing", async () => {
  const h = await harness(); h.state.refreshError = { message: "offline" };
  assert.match((await h.completeSignupAction({}, form({ agreeMarketing: "on" }))).error!, /갱신/);
  h.state.refreshError = null;
  await assert.rejects(h.completeSignupAction({}, form({ next: "/complete-signup" })), redirectTo("/mypage"));
  assert.equal(h.calls.filter((call) => call.method === "update").length, 1);
  assert.equal(h.state.user?.app_metadata.signupConsent.marketing, true);
});

test("a different user returned during refresh cannot complete the previous account's navigation", async () => {
  const h = await harness(); h.state.refreshDifferentUser = true;
  assert.match((await h.completeSignupAction({}, form())).error!, /갱신/);
});

test("legacy email accounts bypass new social consent without rewriting metadata", async () => {
  const h = await harness(); h.state.user!.app_metadata.providers = ["email", "google"];
  await assert.rejects(h.completeSignupAction({}, new FormData()), redirectTo("/mypage"));
  assert.deepEqual(h.calls.map((call) => call.method), ["client", "refresh"]);
});

test("profile distinguishes no-email social identity, linked email, and server-configured password", async () => {
  const h = await harness(); const user = h.state.user!;
  assert.deepEqual(getProfileAuthDetails(user), { email: null, hasEmailIdentity: false, canChangePassword: false, linkedProviders: ["naver"] });
  user.email = "contact@example.invalid";
  assert.equal(getProfileAuthDetails(user).canChangePassword, false, "social-provided email alone is not a password identity");
  user.app_metadata.providers = ["email", "custom:naver"];
  assert.equal(getProfileAuthDetails(user).canChangePassword, true);
  user.app_metadata.providers = ["custom:naver"];
  user.app_metadata.hasPassword = true;
  assert.equal(getProfileAuthDetails(user).canChangePassword, true);
});
