import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";

test("guest recovery preflights delivery and only emails complete matching guest identities without exposing codes", async () => {
  const result = await build({
    stdin: { contents: "export * from './src/app/api/track/lookup-code/route'; export {state,calls} from 'lookup-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "lookup-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(lookup-fixture|@\/lib\/(?:email|email-config|email-delivery-mode|supabase\/admin|request-rate-limit))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls} from 'lookup-fixture';";
        const files: Record<string, string> = {
          "lookup-fixture": "export const state={configured:true,rows:[],sendResult:{ok:true},limited:false};export const calls=[];",
          "@/lib/email-config": `${shared} export const getEmailDeliveryConfiguration=()=>({ok:state.configured});`,
          "@/lib/email-delivery-mode": "export const getEmailDeliveryMode=()=> 'transactional';",
          "@/lib/email": `${shared} export async function sendGuestSubmissionLookupEmail(payload){calls.push({type:'email',payload});return state.sendResult;}`,
          "@/lib/request-rate-limit": `${shared} export const consumeRateLimit=()=>({allowed:!state.limited,retryAfterSeconds:60});export const getRequestIdentifier=()=> 'fixture';`,
          "@/lib/supabase/admin": `${shared} export function createAdminClient(){calls.push({type:'database'});return {from(){const q={select(){return q},is(...args){calls.push({type:'filter',args});return q},not(){return q},ilike(...args){calls.push({type:'pattern',args});return q},order(){return q},limit(){return Promise.resolve({data:state.rows,error:null})}};return q}};}`,
        };
        return { loader: "js", contents: files[path] };
      });
    } }],
  });
  const bundled = { exports: {} as {
    POST: (request: NextRequest) => Promise<Response>;
    state: { configured: boolean; rows: Record<string, unknown>[]; sendResult: { ok: boolean; reason?: string }; limited: boolean };
    calls: { type: string; args?: unknown[]; payload?: { email: string; items: { token: string; link: string }[] } }[];
  } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  const api = bundled.exports;
  const request = () => new NextRequest("https://app.example.invalid/api/track/lookup-code", { method: "POST", body: JSON.stringify({ name: "신청자", email: "guest_name@example.invalid" }) });

  api.state.configured = false;
  let response = await api.POST(request());
  assert.equal(response.status, 503);
  assert.equal(api.calls.length, 0);
  api.state.configured = true;
  api.state.limited = true;
  response = await api.POST(request());
  assert.equal(response.status, 429);
  assert.equal(api.calls.length, 0);
  api.state.limited = false;

  response = await api.POST(request());
  const noMatchBody = await response.text();
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(api.calls.filter(call => call.type === "email").length, 0);

  api.calls.length = 0;
  api.state.rows = [
    { id: "correct", guest_token: "private-guest-code", title: "Private title", guest_name: "신청자", guest_email: "guest_name@example.invalid" },
    { id: "cross-pair", guest_token: "do-not-send-cross-pair", guest_name: "신청자", guest_email: "different@example.invalid", applicant_name: "다른사람", applicant_email: "guest_name@example.invalid" },
  ];
  response = await api.POST(request());
  assert.equal(await response.text(), noMatchBody);
  assert.equal(api.calls.filter(call => call.type === "email").length, 1);
  const mail = api.calls.find(call => call.type === "email")?.payload;
  assert.equal(mail?.email, "guest_name@example.invalid");
  assert.deepEqual(mail?.items.map(item => item.token), ["private-guest-code"]);
  assert.ok(mail?.items[0].link.endsWith("/track/private-guest-code"));
  assert.ok(api.calls.filter(call => call.type === "filter").every(call => JSON.stringify(call.args) === JSON.stringify(["user_id", null])));
  assert.ok(api.calls.filter(call => call.type === "pattern").every(call => call.args?.[1] === "guest\\_name@example.invalid"));

  // A recipient-specific rejection must not reveal whether a submission exists.
  api.state.sendResult = { ok: false, reason: "delivery" };
  const originalWarn = console.warn;
  const logs: unknown[] = [];
  console.warn = (...args: unknown[]) => { logs.push(args); };
  try {
    response = await api.POST(request());
    assert.equal(response.status, 202);
    assert.equal(await response.text(), noMatchBody);
    assert.doesNotMatch(JSON.stringify(logs), /private-guest|guest_name|Private title|do-not-send/);
  } finally { console.warn = originalWarn; }
});
