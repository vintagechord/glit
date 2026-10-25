import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
const sid = "11111111-1111-4111-8111-111111111111";
const requestId = "33333333-3333-4333-8333-333333333333";
const revision = "2026-10-25T00:00:00Z";
async function fixture() {
  const bundle = await build({
    stdin: { contents: "export {GET,POST} from './src/app/api/admin/submissions/[id]/result-email/route';export {PATCH} from './src/app/api/admin/submissions/[id]/mv-rating/route';export {state,calls} from 'fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(fixture|next\/cache|@\/lib\/(?:supabase\/(?:server|admin)|admin\/submission-notifications))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls} from 'fixture';";
        const modules: Record<string, string> = {
          fixture: "export const state={admin:true,changed:true,conflict:false,previewMissing:false};export const calls=[];",
          "next/cache": "export const revalidatePath=()=>{};",
          "@/lib/supabase/server": `${shared}export const createServerSupabase=async()=>({auth:{getUser:async()=>({data:{user:{id:'22222222-2222-4222-8222-222222222222'}}})},rpc:async()=>({data:state.admin,error:null})});`,
          "@/lib/supabase/admin": `${shared}export const createAdminClient=()=>({from(){const query={select(){return query},eq(){return query},maybeSingle:async()=>({data:{id:'${sid}',type:'MV_DISTRIBUTION'},error:null})};return query},rpc:async(name,args)=>{calls.push({name:'save',args});return {data:{completed:true,changed:state.changed,resultStatus:'APPROVED'},error:null}}});`,
          "@/lib/admin/submission-notifications": `${shared}export const getReviewSummaryEmailPreviewById=async input=>{calls.push({name:'preview',input});return {subject:'현재 결과',html:'<p>KBS: 적격, MBC: 심의중</p>',recipientMasked:'te***@example.test',revision:'${"a".repeat(64)}',updatedAt:'${revision}',canSend:!state.previewMissing,attachmentCount:0,missingAssets:[],warnings:[]}};export const sendReviewSummaryNotificationById=async input=>{if(state.conflict)return {errorCode:'CONFLICT',error:'결과가 변경되었습니다.'};calls.push({name:'send',input});return {queuedCount:1}};`,
        };
        return { contents: modules[path], loader: "js" };
      });
    } }],
  });
  type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
  const output = { exports: {} as { GET: Handler; POST: Handler; PATCH: Handler; state: { admin: boolean; changed: boolean; conflict: boolean }; calls: Array<{ name: string; input?: Record<string, unknown> }> } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}
const context = { params: Promise.resolve({ id: sid }) };
const request = (body: unknown, method = "POST") => new Request(`https://fixture.invalid/api/admin/submissions/${sid}/result-email`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("public grade save has zero mail side effects; preview only reads and explicit approved send uses shared summary", async () => {
  const f = await fixture();
  await f.PATCH(request({ rating: "15", expectedUpdatedAt: revision }, "PATCH"), context);
  f.state.changed = false;
  await f.PATCH(request({ rating: "15", expectedUpdatedAt: revision }, "PATCH"), context);
  assert.equal(f.calls.filter(call => call.name === "send").length, 0);
  const preview = await (await f.GET(new Request("https://fixture.invalid/preview"), context)).json();
  assert.equal(f.calls.filter(call => call.name === "send").length, 0);
  const sent = await f.POST(request({ requestId, expectedRevision: preview.revision, expectedUpdatedAt: preview.updatedAt }), context);
  assert.equal(sent.status, 200);
  assert.equal(f.calls.filter(call => call.name === "send").length, 1);
  assert.equal(f.calls.find(call => call.name === "send")?.input?.requestId, requestId);
});

test("public result email denies non-admins, missing preview versions and stale previews before delivery", async () => {
  const f = await fixture();
  f.state.admin = false;
  assert.equal((await f.GET(new Request("https://fixture.invalid/preview"), context)).status, 403);
  assert.equal((await f.POST(request({}), context)).status, 403);
  assert.equal(f.calls.length, 0);
  f.state.admin = true;
  assert.equal((await f.POST(request({ requestId }), context)).status, 400);
  f.state.conflict = true;
  assert.equal((await f.POST(request({ requestId, expectedRevision: "a".repeat(64), expectedUpdatedAt: revision }), context)).status, 409);
  assert.equal(f.calls.length, 0);
});
