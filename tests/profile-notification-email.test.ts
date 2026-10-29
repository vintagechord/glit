import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

async function fixture() {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: `export {updateProfileAction} from './src/features/auth/actions';export {resolveMemberNotificationEmail} from './src/lib/member-notification-email';export {state,calls,db} from 'profile-fixture';` },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "profile-notification-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(profile-fixture|@\/lib\/supabase\/(server|admin|env)|@\/lib\/email|@\/lib\/request-rate-limit|next\/(navigation|headers)|.*account-lookup)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: {
        "profile-fixture": `export const calls=[];export const state={user:{id:'owner',email:null,identities:[{provider:'custom:naver'}]},userError:null,saveError:null,profileError:null,profile:{notification_email:null}};export const db={auth:{getUser:async()=>({data:{user:state.user},error:state.userError})},from(table){if(table!=='profiles')throw Error('Unexpected table');return{async upsert(input,options){calls.push({input,options});if(!state.saveError)state.profile={...state.profile,...input};return{error:state.saveError}},select(){return{eq(key,value){if(key!=='user_id'||value!=='owner')throw Error('Wrong owner');return{maybeSingle:async()=>({data:state.profile,error:state.profileError})}}}}}}};`,
        "@/lib/supabase/server": "import{db}from'profile-fixture';export const createServerSupabase=async()=>db;",
        "@/lib/supabase/admin": "export const createAdminClient=()=>{throw Error('Unexpected privileged write')};",
        "@/lib/supabase/env": "export const getServiceRoleKey=()=> 'fixture-signing-key';",
        "@/lib/email": "export const sendWelcomeEmail=()=>{throw Error('Unexpected mail')};export const sendSignupVerificationEmail=sendWelcomeEmail;export const sendPasswordResetEmail=sendWelcomeEmail;",
        "@/lib/request-rate-limit": "export const consumePersistentRateLimit=async()=>({allowed:true});export const getRequestIdentifier=()=> 'fixture';",
        "next/navigation": "export const redirect=()=>{throw Error('Unexpected redirect')};",
        "next/headers": "export const headers=async()=>new Headers();",
        "./account-lookup": "export const SIGNUP_VERIFICATION_FLOW='fixture';export const findAccountByEmail=()=>null;",
      }[path]! }));
    } }],
  });
  const output = { exports: {} as {
    updateProfileAction: typeof import("../src/features/auth/actions").updateProfileAction;
    resolveMemberNotificationEmail: typeof import("../src/lib/member-notification-email").resolveMemberNotificationEmail;
    db: Parameters<typeof import("../src/lib/member-notification-email").resolveMemberNotificationEmail>[0];
    state: { user: { id: string; email: string | null; identities: { provider: string }[] } | null; userError: unknown; saveError: unknown; profileError: unknown; profile: { notification_email: string | null } };
    calls: { input: Record<string, unknown> }[];
  } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}

const form = (email?: string) => {
  const data = new FormData();
  data.set("name", "회원 이름"); data.set("phone", "01012345678");
  if (email !== undefined) data.set("notificationEmail", email);
  data.set("user_id", "someone-else"); data.set("role", "admin");
  return data;
};

test("Naver and Kakao members save an owner-bound contact and subsequent notices resolve to it", async () => {
  for (const provider of ["custom:naver", "kakao"]) {
    const f = await fixture(); f.state.user!.identities = [{ provider }];
    const saved = await f.updateProfileAction({}, form(" Saved@Example.invalid "));
    assert.ok(saved.message); assert.equal(saved.error, undefined);
    assert.equal(f.calls[0].input.user_id, "owner");
    assert.equal(f.calls[0].input.notification_email, "saved@example.invalid");
    assert.equal(f.calls[0].input.role, undefined);
    assert.equal(f.calls[0].input.email, undefined);
    assert.equal(await f.resolveMemberNotificationEmail(f.db, f.state.user, "old@example.invalid"), "saved@example.invalid");
    await f.updateProfileAction({}, form("new@example.invalid"));
    assert.equal(await f.resolveMemberNotificationEmail(f.db, f.state.user, "old@example.invalid"), "new@example.invalid");
  }
});

test("clearing uses the application contact, old forms preserve the saved contact, and lookup errors do not use stale contacts", async () => {
  const f = await fixture(); f.state.profile.notification_email = "saved@example.invalid";
  await f.updateProfileAction({}, form());
  assert.equal(f.calls[0].input.notification_email, undefined);
  assert.equal(f.state.profile.notification_email, "saved@example.invalid");
  await f.updateProfileAction({}, form(""));
  assert.equal(f.state.profile.notification_email, null);
  assert.equal(await f.resolveMemberNotificationEmail(f.db, f.state.user, "old@example.invalid"), "old@example.invalid");
  f.state.profileError = { message: "unavailable" };
  await assert.rejects(f.resolveMemberNotificationEmail(f.db, f.state.user, "old@example.invalid"), /lookup unavailable/);
});

test("invalid input, unauthenticated users, and Auth-email accounts cannot overwrite the notification contact", async () => {
  const f = await fixture();
  for (const email of ["invalid", "member@example.invalid\r\nBcc:other@example.invalid", "x".repeat(255) + "@example.invalid"]) {
    assert.ok((await f.updateProfileAction({}, form(email))).fieldErrors?.notificationEmail);
  }
  assert.equal(f.calls.length, 0);
  f.state.user = null;
  assert.match((await f.updateProfileAction({}, form("new@example.invalid"))).error!, /로그인/);
  f.state.user = { id: "owner", email: "account@example.invalid", identities: [{ provider: "email" }] };
  assert.match((await f.updateProfileAction({}, form("new@example.invalid"))).error!, /계정 이메일/);
  assert.equal(f.calls.length, 0);
  assert.ok((await f.updateProfileAction({}, form())).message);
  f.state.user.email = null; f.state.user.identities = [{ provider: "kakao" }]; f.state.saveError = { message: "write failed" };
  const failed = await f.updateProfileAction({}, form("new@example.invalid"));
  assert.ok(failed.error); assert.equal(failed.message, undefined);
});
