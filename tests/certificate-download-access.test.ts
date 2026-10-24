import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const submissionId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const defaultKey = `submissions/${submissionId}/certificate/current.pdf`;
const customKey = `custom/private/${submissionId}/certificate/현재 필증.pdf`;

async function fixture() {
  const bundle = await build({
    stdin: { contents: "export {GET as legacy} from './src/app/api/b2/download/route'; export {GET as customer} from './src/app/api/submissions/[id]/mv-certificate/route'; export {GET as admin} from './src/app/api/admin/submissions/[id]/mv-certificate/route'; export {state,calls} from 'certificate-access-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "certificate-access-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(certificate-access-fixture|@\/lib\/(?:b2|download-response|payments\/submission|supabase\/server|supabase\/admin))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls} from 'certificate-access-fixture';";
        const modules: Record<string, string> = {
          "certificate-access-fixture": `export const state={prefix:'submissions/',user:true,isAdmin:false,ownerError:null,loadFailure:false,submission:{id:'${submissionId}',type:'MV_DISTRIBUTION',status:'RESULT_READY',result_status:null,result_notified_at:null,certificate_b2_path:'${defaultKey}',certificate_original_name:'current.pdf',certificate_mime:'application/pdf'}};export const calls=[];`,
          "@/lib/payments/submission": `${shared} export const ensureSubmissionOwner=async(id,token)=>{calls.push({kind:'owner',id,token});return {submission:state.ownerError?null:state.submission,error:state.ownerError}};`,
          "@/lib/supabase/server": `${shared} export const createServerSupabase=async()=>({auth:{getUser:async()=>({data:{user:state.user?{id:'${actorId}'}:null}})},rpc:async()=>({data:state.isAdmin})});`,
          "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>({from(){const chain={select(fields){calls.push({kind:'database',fields});return chain},eq(){return chain},maybeSingle:async()=>({data:state.submission,error:state.loadFailure?{code:'MOCK_FAILURE'}:null})};return chain}});`,
          "@/lib/b2": `${shared} export class B2ConfigError extends Error{};export const getB2Config=()=>({prefix:state.prefix,bucket:'fixture'});export const headObject=async(key)=>{calls.push({kind:'head',key});return{}};export const presignGetUrl=async(key)=>{calls.push({kind:'sign',key});return 'https://fixture.invalid/short-lived?signature=synthetic'};export const sanitizeFileName=name=>name;`,
          "@/lib/download-response": "export const createAttachmentResponseFromUrl=async()=>new Response('synthetic certificate',{headers:{'content-type':'application/pdf'}});",
        };
        return { loader: "js", contents: modules[path] };
      });
    } }],
  });
  type Handler = (request: Request, context?: { params: Promise<{ id: string }> }) => Promise<Response>;
  type Submission = { id: string; type: string; status: string; result_status: string | null; result_notified_at: string | null; certificate_b2_path: string };
  const output = { exports: {} as { legacy: Handler; customer: Handler; admin: Handler; state: { prefix: string; user: boolean; isAdmin: boolean; ownerError: string | null; loadFailure: boolean; submission: Submission | null }; calls: Array<{ kind: string; key?: string; token?: string; id?: string }> } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}

const context = { params: Promise.resolve({ id: submissionId }) };
const request = (key: string, token?: string) => new Request(`https://fixture.invalid/api/b2/download?${new URLSearchParams({ filePath: key })}`, { headers: token ? { "x-submission-guest-token": token } : {} });
const storageCalls = (api: Awaited<ReturnType<typeof fixture>>) => api.calls.filter(call => ["head", "sign"].includes(call.kind));

test("legacy download accepts only the published current certificate for owners and guest-token owners with configured or historical keys", async () => {
  for (const key of [defaultKey, customKey]) {
    const api = await fixture();
    api.state.prefix = "custom/private/";
    api.state.submission!.certificate_b2_path = key;
    const response = await api.legacy(request(key, "synthetic-guest-token"));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("location") ?? "", /^https:\/\/fixture\.invalid\//);
    assert.equal(api.calls.find(call => call.kind === "owner")?.id, submissionId);
    assert.equal(api.calls.find(call => call.kind === "owner")?.token, "synthetic-guest-token");
    assert.deepEqual(storageCalls(api).map(call => call.key), [key, key]);
  }
});

test("legacy and dedicated customer routes both block unpublished certificates before any storage access", async () => {
  const api = await fixture();
  api.state.submission!.status = "PRE_REVIEW";
  assert.equal((await api.legacy(request(defaultKey))).status, 403);
  assert.equal((await api.customer(request(defaultKey), context)).status, 403);
  assert.deepEqual(storageCalls(api), []);
  for (const signal of ["result_status", "result_notified_at"] as const) {
    api.state.submission![signal] = signal === "result_status" ? "APPROVED" : "2026-10-24T00:00:00Z";
    assert.equal((await api.legacy(request(defaultKey))).status, 302);
    assert.equal((await api.customer(request(defaultKey), context)).status, 200);
    api.state.submission![signal] = null;
  }
});

test("a known replaced certificate or foreign namespace cannot be signed even by its owner", async () => {
  const api = await fixture();
  for (const key of [defaultKey.replace("current.pdf", "old.pdf"), `foreign/${submissionId}/certificate/current.pdf`, `submissions/${submissionId}/certificate/../current.pdf`]) {
    assert.ok([403, 404].includes((await api.legacy(request(key))).status));
  }
  api.state.submission!.type = "MV_BROADCAST";
  assert.equal((await api.legacy(request(defaultKey))).status, 403);
  assert.deepEqual(storageCalls(api), []);
});

test("other users, missing authentication and missing submissions stay denied; admin fallback still checks the current published pointer", async () => {
  const api = await fixture();
  for (const [ownerError, expected] of [["UNAUTHORIZED", 401], ["NOT_FOUND", 404], ["FORBIDDEN", 403]] as const) {
    api.state.ownerError = ownerError;
    assert.equal((await api.legacy(request(defaultKey))).status, expected);
  }
  assert.deepEqual(storageCalls(api), []);
  api.state.isAdmin = true;
  assert.equal((await api.legacy(request(defaultKey.replace("current.pdf", "old.pdf")))).status, 404);
  api.state.submission!.status = "PRE_REVIEW";
  assert.equal((await api.legacy(request(defaultKey))).status, 403);
  assert.deepEqual(storageCalls(api), []);
  assert.equal((await api.admin(request(defaultKey), context)).status, 200, "explicit administrator endpoint retains pre-publication inspection");
  api.state.submission!.status = "RESULT_READY";
  assert.equal((await api.legacy(request(defaultKey))).status, 302);
  api.state.loadFailure = true;
  const signs = storageCalls(api).length;
  assert.equal((await api.legacy(request(defaultKey))).status, 503);
  assert.equal(storageCalls(api).length, signs);
});

test("admin-free downloads remain administrator-only in configured and historical namespaces", async () => {
  const api = await fixture();
  api.state.prefix = "custom/private/";
  for (const key of ["custom/private/admin-free/free-upload/file.pdf", "submissions/admin-free/free-upload/file.pdf"]) {
    api.state.isAdmin = false;
    assert.equal((await api.legacy(request(key))).status, 403);
    api.state.isAdmin = true;
    api.state.user = false;
    assert.equal((await api.legacy(request(key))).status, 403);
    api.state.user = true;
    assert.equal((await api.legacy(request(key))).status, 302);
  }
  assert.equal(api.calls.some(call => call.kind === "owner"), false);
  assert.equal(storageCalls(api).filter(call => call.kind === "sign").length, 2);
});
