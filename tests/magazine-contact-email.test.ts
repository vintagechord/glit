import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";

type Fixture = {
  createMagazineRequestAction: typeof import("../src/features/magazine/actions").createMagazineRequestAction;
  state: { user: { id: string; email?: string; user_metadata: object } | null };
  calls: { method: string; args?: Record<string, unknown> }[];
};

async function fixture(): Promise<Fixture> {
  const result = await build({
    stdin: { contents: `export {createMagazineRequestAction} from './src/features/magazine/actions'; export {state,calls} from 'magazine-fixture';`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "magazine-contact-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(magazine-fixture|next\/(cache|navigation)|@\/lib\/supabase\/(server|admin)|@\/lib\/credits)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: {
        "magazine-fixture": `export const state={user:{id:'verified-member',user_metadata:{}}}; export const calls=[];`,
        "next/cache": `export const revalidatePath=()=>{};`,
        "next/navigation": `export const redirect=()=>{throw Error('Unexpected redirect')};`,
        "@/lib/supabase/server": `import {state,calls} from 'magazine-fixture';export async function createServerSupabase(){return {auth:{getUser:async()=>({data:{user:state.user},error:null})},rpc:async(method,args)=>{calls.push({method,args});return {data:{id:'request-1'},error:null};}};}`,
        "@/lib/supabase/admin": `export const createAdminClient=()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{name:'Member',phone:'01012345678'},error:null})})})})});`,
        "@/lib/credits": `export const getUserCreditSummary=async()=>({available:100,magazineRequestsReady:true});export const MAGAZINE_REQUEST_CREDIT_COST=1;export const MAGAZINE_REQUEST_UNAVAILABLE_MESSAGE='Unavailable';export const MAGAZINE_CREDIT_INSUFFICIENT_MESSAGE='Insufficient credits';`,
      }[path]! }));
    } }],
  });
  const bundled = { exports: {} as Fixture };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  return bundled.exports;
}

function request(email?: string) {
  const data = new FormData();
  data.set("targetChannel", "DOMESTIC_NEWS");
  if (email !== undefined) data.set("requesterEmail", email);
  return data;
}

test("a verified member without Auth email can submit a validated request contact email", async () => {
  const f = await fixture();
  const result = await f.createMagazineRequestAction(request("  contact@example.com  "));
  assert.equal(result.error, undefined);
  assert.equal(f.calls[0]?.method, "create_magazine_request");
  assert.equal(f.calls[0]?.args?.p_requester_email, "contact@example.com");
  assert.equal(f.calls[0]?.args?.p_requester_name, "Member");
});

test("existing Auth email remains the request address with no field and with a forged alternate field", async () => {
  const f = await fixture();
  f.state.user!.email = "member@example.com";
  for (const contact of [undefined, "alternate@example.com"]) {
    const result = await f.createMagazineRequestAction(request(contact));
    assert.equal(result.error, undefined);
  }
  assert.deepEqual(f.calls.map(call => call.args?.p_requester_email), ["member@example.com", "member@example.com"]);
});

test("missing or malformed contact email cannot create a request for a no-email member", async () => {
  const f = await fixture();
  for (const contact of [undefined, "", "not-an-email"]) {
    assert.ok((await f.createMagazineRequestAction(request(contact))).error);
  }
  assert.equal(f.calls.length, 0);
});

test("a supplied contact email cannot replace verified authentication", async () => {
  const f = await fixture();
  f.state.user = null;
  assert.ok((await f.createMagazineRequestAction(request("contact@example.com"))).error);
  assert.equal(f.calls.length, 0);
});
