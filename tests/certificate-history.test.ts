import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const submissionId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";

async function fixture() {
  const bundle = await build({
    stdin: { contents: "export {POST} from './src/app/api/admin/submissions/[id]/certificate/route'; export {GET} from './src/app/api/admin/submissions/[id]/mv-certificate/route'; export {state,calls} from 'certificate-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "certificate-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(certificate-fixture|@\/lib\/(?:b2|download-response|supabase\/server|supabase\/admin|admin\/submission-notifications))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls} from 'certificate-fixture';";
        const modules: Record<string, string> = {
          "certificate-fixture": `export const state={isAdmin:true,rpcFailure:false,committedFailure:false,notificationWarning:undefined,submission:{id:'${submissionId}',type:'MV_DISTRIBUTION',certificate_b2_path:'submissions/legacy/certificate.pdf',certificate_original_name:'이전 필증.pdf',certificate_mime:'application/pdf'}};export const calls=[];`,
          "@/lib/supabase/server": `${shared} export const createServerSupabase=async()=>({auth:{getUser:async()=>({data:{user:{id:'${actorId}'}}})},rpc:async()=>({data:state.isAdmin})});`,
          "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>({from(){const chain={select(){return chain},eq(){return chain},maybeSingle:async()=>({data:state.submission})};return chain},rpc:async(name,args)=>{calls.push({kind:'rpc',name,args});if(state.rpcFailure)return{error:{code:'42883'}};state.submission.certificate_b2_path=args.p_object_key;state.submission.certificate_original_name=args.p_original_name;return state.committedFailure?{error:{code:'FETCH_ERROR'}}:{data:{ok:true},error:null}}});`,
          "@/lib/b2": `${shared} export class B2ConfigError extends Error{};export const getB2Config=()=>({prefix:'custom/prefix/',bucket:'fixture',client:{send:async(command)=>{calls.push({kind:'put',input:command.input});return {}}}});export const sanitizeFileName=name=>name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120);export const deleteObject=async(key)=>calls.push({kind:'delete',key});export const presignGetUrl=async(key)=>{calls.push({kind:'sign',key});return 'https://fixture.invalid/short-lived?signature=fixture-secret'};`,
          "@/lib/download-response": `${shared} export const createAttachmentResponseFromUrl=async()=>new Response('certificate fixture',{headers:{'Content-Type':'application/pdf'}});`,
          "@/lib/admin/submission-notifications": `${shared} export const sendSubmissionUpdateNotificationById=async(input)=>{calls.push({kind:'notice',args:input});return {warning:state.notificationWarning}};`,
        };
        return { loader: "js", contents: modules[path] };
      });
    } }],
  });
  type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
  const output = { exports: {} as { POST: Handler; GET: Handler; state: { notificationWarning?: string; isAdmin: boolean; rpcFailure: boolean; committedFailure: boolean; submission: { certificate_b2_path: string; type: string } }; calls: Array<{ kind: string; name?: string; key?: string; input?: { Key: string }; args?: Record<string, unknown> }> } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}

const context = { params: Promise.resolve({ id: submissionId }) };
function request(contents = "%PDF-1.7 fixture", filename = "필증.pdf") {
  const body = new FormData();
  body.set("file", new File([contents], filename, { type: "application/pdf" }));
  return new Request("https://fixture.invalid/api/admin/certificate", { method: "POST", body });
}

test("certificate replacement respects configured prefix, uses unique keys and commits through the audit RPC", async () => {
  const api = await fixture();
  for (let index = 0; index < 2; index++) {
    const response = await api.POST(request(), context);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.certificate.objectKey, new RegExp(`^custom/prefix/${submissionId}/certificate/[0-9a-f-]{36}_`));
  }
  const puts = api.calls.filter(call => call.kind === "put");
  assert.equal(new Set(puts.map(call => call.input?.Key)).size, 2);
  const calls = api.calls.filter(call => call.kind === "rpc");
  assert.equal(calls.length, 2);
  const notices = api.calls.filter(call => call.kind === "notice");
  assert.equal(notices.length, 2);
  assert.ok(api.calls.findIndex(call => call.kind === "rpc") < api.calls.findIndex(call => call.kind === "notice"));
  assert.doesNotMatch(JSON.stringify(notices), /objectKey|custom\/prefix|필증\.pdf/);
  assert.equal(calls[1].name, "record_submission_certificate");
  assert.equal(calls[1].args?.p_actor_user_id, actorId);
  assert.equal(calls[1].args?.p_object_key, puts[1].input?.Key);
  assert.equal(calls[1].args?.p_original_name, "필증.pdf");
  assert.doesNotMatch(JSON.stringify(calls), /https?:\/\/|signature=/);
  assert.equal(api.calls.some(call => call.kind === "delete"), false);
  const download = await api.GET(new Request("https://fixture.invalid/download"), context);
  assert.equal(download.status, 200);
  assert.equal(api.calls.find(call => call.kind === "sign")?.key, puts[1].input?.Key);
});

test("unconfirmed persistence never deletes a previous result or a newly committed certificate", async () => {
  for (const committed of [false, true]) {
    const api = await fixture();
    api.state.rpcFailure = !committed;
    api.state.committedFailure = committed;
    const previous = api.state.submission.certificate_b2_path;
    const response = await api.POST(request(), context);
    assert.equal(response.status, 500);
    assert.equal(api.calls.some(call => call.kind === "notice"), false, "unconfirmed writes cannot notify customers");
    assert.equal(api.calls.some(call => call.kind === "delete"), false);
    assert.equal(api.state.submission.certificate_b2_path, committed ? api.calls.find(call => call.kind === "put")?.input?.Key : previous);
  }
});

test("certificate permission, result type and actual content guards run before writes", async () => {
  const api = await fixture();
  api.state.isAdmin = false;
  assert.equal((await api.POST(request(), context)).status, 403);
  assert.equal((await api.GET(new Request("https://fixture.invalid/download"), context)).status, 403);
  api.state.isAdmin = true;
  api.state.submission.type = "ALBUM";
  assert.equal((await api.POST(request(), context)).status, 400);
  api.state.submission.type = "MV_DISTRIBUTION";
  assert.equal((await api.POST(request("renamed plain text"), context)).status, 400);
  assert.deepEqual(api.calls, []);
});


test("certificate upload keeps a committed file successful while reporting email failure", async () => {
  const api = await fixture();
  api.state.notificationWarning = "이메일 발송에 실패했습니다.";
  const response = await api.POST(request(), context);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.certificate.objectKey);
  assert.equal(body.warning, api.state.notificationWarning);
});
