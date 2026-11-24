import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";

test("guest recovery preflights delivery, emails only complete matching guest identities and tells the customer what happened", async () => {
  const result = await build({
    stdin: { contents: "export * from './src/app/api/track/lookup-code/route'; export {state,calls} from 'lookup-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "lookup-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(lookup-fixture|@\/lib\/(?:email|email-config|email-delivery-mode|supabase\/admin|request-rate-limit))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls} from 'lookup-fixture';";
        const files: Record<string, string> = {
          "lookup-fixture": "export const state={configured:true,rows:[],memberRows:[],sendResult:{ok:true},limited:false,queryFails:false};export const calls=[];",
          "@/lib/email-config": `${shared} export const getEmailDeliveryConfiguration=()=>({ok:state.configured});`,
          "@/lib/email-delivery-mode": "export const getEmailDeliveryMode=()=> 'transactional';",
          "@/lib/email": `${shared} export async function sendGuestSubmissionLookupEmail(payload){calls.push({type:'email',payload});return state.sendResult;}`,
          "@/lib/request-rate-limit": `${shared} export const consumePersistentRateLimit=()=>({allowed:!state.limited,retryAfterSeconds:60});export const getRequestIdentifier=()=> 'fixture';`,
          "@/lib/supabase/admin": `${shared} export function createAdminClient(){calls.push({type:'database'});return {from(){const q={select(){return q},is(...args){calls.push({type:'filter',args});return q},not(...args){if(args[0]==='user_id')q.member=true;return q},ilike(...args){calls.push({type:'pattern',args});return q},order(){return q},range(start,end){q.start=start;q.end=end;calls.push({type:'page',args:[start,end]});return q},abortSignal(signal){if(!(signal instanceof AbortSignal))throw Error('missing deadline');return Promise.resolve({data:(q.member?state.memberRows:state.rows).slice(q.start,q.end+1),error:state.queryFails?{code:'fixture'}:null})}};return q}};}`,
        };
        return { loader: "js", contents: files[path] };
      });
    } }],
  });
  const bundled = { exports: {} as {
    POST: (request: NextRequest) => Promise<Response>;
    state: { configured: boolean; rows: Record<string, unknown>[]; memberRows: Record<string, unknown>[]; sendResult: { ok: boolean; reason?: string }; limited: boolean; queryFails: boolean };
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

  // Nothing matches: the customer is told so instead of waiting for a mail
  // that was never sent.
  response = await api.POST(request());
  let body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual({ ok: body.ok, result: body.result }, { ok: false, result: "no_match" });
  assert.match(body.error, /일치하는 비회원 접수가 없습니다/);
  assert.equal(api.calls.filter(call => call.type === "email").length, 0);

  // A guest application later paid from a logged-in cart belongs to that
  // account and has no code: point the customer at login, send nothing.
  api.calls.length = 0;
  api.state.memberRows = [
    { id: "other-member", guest_name: "다른사람", guest_email: "guest_name@example.invalid" },
    { id: "claimed", guest_token: null, title: "Private title", guest_name: "신청자", guest_email: "guest_name@example.invalid" },
  ];
  response = await api.POST(request());
  body = await response.json();
  assert.equal(response.status, 404);
  assert.deepEqual({ ok: body.ok, result: body.result }, { ok: false, result: "member_account" });
  assert.match(body.error, /로그인/);
  assert.doesNotMatch(JSON.stringify(body), /Private title|claimed/);
  assert.equal(api.calls.filter(call => call.type === "email").length, 0);

  api.calls.length = 0;
  api.state.rows = [
    { id: "correct", guest_token: "private-guest-code", title: "Private title", guest_name: "신청자", guest_email: "guest_name@example.invalid" },
    { id: "cross-pair", guest_token: "do-not-send-cross-pair", guest_name: "신청자", guest_email: "different@example.invalid", applicant_name: "다른사람", applicant_email: "guest_name@example.invalid" },
  ];
  response = await api.POST(request());
  body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual({ ok: body.ok, result: body.result }, { ok: true, result: "sent" });
  assert.match(body.message, /조회 코드를 발송했습니다/);
  // The code itself only ever travels by mail.
  assert.doesNotMatch(JSON.stringify(body), /private-guest-code|Private title|do-not-send/);
  assert.equal(api.calls.filter(call => call.type === "email").length, 1);
  const mail = api.calls.find(call => call.type === "email")?.payload;
  assert.equal(mail?.email, "guest_name@example.invalid");
  assert.deepEqual(mail?.items.map(item => item.token), ["private-guest-code"]);
  assert.ok(mail?.items[0].link.endsWith("/track/private-guest-code"));
  assert.ok(api.calls.filter(call => call.type === "filter").every(call => JSON.stringify(call.args) === JSON.stringify(["user_id", null])));
  assert.ok(api.calls.filter(call => call.type === "pattern").every(call => call.args?.[1] === "guest\\_name@example.invalid"));

  // Hundreds of newer submissions for a different name must not hide the
  // owner's older matching submission behind an email-only result limit.
  api.calls.length = 0;
  api.state.rows = Array.from({ length: 205 }, (_, index) => ({
    id: `other-${index}`, guest_token: `other-code-${index}`, guest_name: "다른사람", guest_email: "guest_name@example.invalid",
  }));
  api.state.rows.push({ id: "older-match", guest_token: "private-older-code", guest_name: "  신청자  ", guest_email: "GUEST_NAME@example.invalid" });
  response = await api.POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(api.calls.find(call => call.type === "email")?.payload?.items.map(item => item.token), ["private-older-code"]);
  assert.ok(api.calls.some(call => call.type === "page" && call.args?.[0] === 200));

  api.calls.length = 0;
  api.state.queryFails = true;
  response = await api.POST(request());
  assert.equal(response.status, 503, "an incomplete search cannot report a successful no-match");
  assert.equal(api.calls.some(call => call.type === "email"), false);
  api.state.queryFails = false;

  // A mail the provider did not accept is never reported as sent.
  api.state.sendResult = { ok: false, reason: "delivery" };
  const originalWarn = console.warn;
  const logs: unknown[] = [];
  console.warn = (...args: unknown[]) => { logs.push(args); };
  try {
    response = await api.POST(request());
    body = await response.json();
    assert.equal(response.status, 502);
    assert.deepEqual({ ok: body.ok, result: body.result }, { ok: false, result: "send_failed" });
    assert.match(body.error, /보내지 못했습니다/);
    assert.doesNotMatch(JSON.stringify(body), /private-guest|private-older|Private title|do-not-send/);
    assert.doesNotMatch(JSON.stringify(logs), /private-guest|private-older|guest_name|Private title|do-not-send/);
  } finally { console.warn = originalWarn; }
});
