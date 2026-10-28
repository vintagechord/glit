import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

type FixtureUser = { id: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown>; identities: { provider: string }[] };
type Harness = {
  state: { user: FixtureUser | null; sessionUser: FixtureUser | null; settingsCalls: number };
  LoginPageView: (props: object) => Promise<unknown>;
  SignupPageView: (props: object) => Promise<unknown>;
  ProfilePageView: (props?: object) => Promise<unknown>;
  CompleteSignupView: (props: object) => Promise<unknown>;
};
const compiled = build({
  stdin: { resolveDir: process.cwd(), loader: "ts", contents: `export {LoginPageView} from './src/features/auth/login-page-view';export {SignupPageView} from './src/features/auth/signup-page-view';export {CompleteSignupView} from './src/features/auth/complete-signup-view';export {ProfilePageView} from './src/app/dashboard/profile/view';export {state} from 'page-fixture';` },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  plugins: [{ name: "page-streaming-fixture", setup(plugin) {
    plugin.onResolve({ filter: /^(page-fixture|next\/navigation|\.\/(login-form|signup-form|complete-signup-form|social-auth-buttons|social)|@\/features\/auth\/social|@\/features\/profile\/profile-form|\.\/profile-social-accounts|@\/lib\/supabase\/(server|server-user)|@\/components\/dashboard\/dashboard-shell)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: {
      "page-fixture": "export const state={user:null,sessionUser:null,settingsCalls:0};",
      "next/navigation": "export function redirect(location){throw Object.assign(new Error('test redirect'),{location});}",
      "./login-form": "export function LoginForm(){return null;}",
      "./signup-form": "export function SignupForm(){return null;}",
      "./complete-signup-form": "export function CompleteSignupForm(){return null;}",
      "./social-auth-buttons": "export function SocialAuthButtons(){return null;}",
      "./profile-social-accounts": "export function ProfileSocialAccounts(){return null;}",
      "@/features/profile/profile-form": "export function ProfileForm(){return null;}",
      "./social": "import {state} from 'page-fixture';export function getSocialAvailability(){state.settingsCalls++;return new Promise(()=>{});}",
      "@/features/auth/social": "import {state} from 'page-fixture';export function getSocialAvailability(){state.settingsCalls++;return new Promise(()=>{});}",
      "@/components/dashboard/dashboard-shell": "export function DashboardShell(){return null;}export const defaultDashboardTabs=[];",
      "@/lib/supabase/server-user": "import {state} from 'page-fixture';export async function getServerSessionUser(){return state.user;}",
      "@/lib/supabase/server": "import {state} from 'page-fixture';export async function createServerSupabase(){return {auth:{getUser:async()=>({data:{user:state.user},error:null}),getSession:async()=>({data:{session:state.sessionUser?{user:state.sessionUser}:null}})},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null})})};}",
    }[path]! }));
  } }],
});

async function harness() {
  const result = await compiled;
  const fixtureModule = { exports: {} as Harness };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), fixtureModule, fixtureModule.exports);
  fixtureModule.exports.state.user = { id: "social-user", app_metadata: { providers: ["custom:naver"] }, user_metadata: {}, identities: [{ provider: "custom:naver" }] };
  return fixtureModule.exports;
}

test("login, signup and profile shells resolve while provider settings are deliberately unavailable", { timeout: 2000 }, async () => {
  const h = await harness();
  for (const page of [h.LoginPageView, h.SignupPageView, h.ProfilePageView]) {
    assert.ok(await page({ searchParams: Promise.resolve({ next: "/dashboard/new?draft=saved" }) }));
  }
  assert.equal(h.state.settingsCalls, 0, "provider settings must start inside independent Suspense children, never block page forms");
});

test("verified consent plus stale session metadata renders retry instead of looping through protected navigation", async () => {
  const h = await harness();
  h.state.sessionUser = { ...h.state.user!, app_metadata: { providers: ["custom:naver"] } };
  h.state.user!.app_metadata.signupConsent = { age14OrOlder: true, terms: true, privacy: true, refund: true, acceptedAt: "2026-10-29T00:00:00Z" };
  assert.ok(await h.CompleteSignupView({ searchParams: Promise.resolve({ next: "/dashboard/new?draft=saved" }) }));
  h.state.sessionUser = h.state.user;
  await assert.rejects(h.CompleteSignupView({ english: true, searchParams: Promise.resolve({ next: "/dashboard/new?draft=saved" }) }), (error: unknown) => (error as { location: string }).location === "/en/dashboard/new?draft=saved");
});

test("completion view verifies identity and removes auth-loop return destinations", async () => {
  const h = await harness(); h.state.user = null;
  await assert.rejects(h.CompleteSignupView({ english: true, searchParams: Promise.resolve({ next: "/auth/social/google" }) }), (error: unknown) => (error as { location: string }).location === "/en/login?next=%2Fen%2Fmypage");
});
