import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

const sid = "11111111-1111-4111-8111-111111111111";
const stationId = "33333333-3333-4333-8333-333333333333";
const revision = "2026-10-25T00:00:00.000Z";
async function fixture() {
  const bundle = await build({
    stdin: { contents: `export {updateStationReviewAction,updateStationReviewsBulkAction} from './src/features/admin/actions';export {state,calls} from 'station-fixture';`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "station-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(station-fixture|@\/lib\/(?:supabase\/(?:server|admin)|admin\/(?:action-auth|submission-notifications|review-management))|next\/(?:server|cache|navigation))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls} from 'station-fixture';";
        const files: Record<string, string> = {
          "station-fixture": `export const calls=[];export const state={admin:true,changed:true,error:null,warning:undefined};`,
          "@/lib/supabase/admin": `export const createAdminClient=()=>({from(){throw Error('split writes not allowed')}});`,
          "@/lib/supabase/server": `export const createServerSupabase=async()=>({});`,
          "@/lib/admin/action-auth": `${shared} export const requireAdminAction=async()=>{if(!state.admin)throw Error('forbidden');return {id:'22222222-2222-4222-8222-222222222222'}};`,
          "@/lib/admin/review-management": `${shared} export const saveManagedStationReviews=async(_db,input)=>{calls.push({name:"bulk-save",input});return state.error?{ok:false,error:state.error}:{ok:true,changed:true,savedCount:input.stations.length}};export const saveManagedStationReview=async(_db,input)=>{calls.push({name:'save',input});return state.error?{ok:false,error:state.error}:{ok:true,changed:state.changed,row:{id:'review',status:'APPROVED',age_rating:'12'},stationName:'KBS',submissionStatus:'RESULT_READY',changeKey:'fixture-revision'}};`,
          "@/lib/admin/submission-notifications": `${shared} export const sendSubmissionUpdateNotificationById=async input=>{calls.push({name:'notice',input});return {warning:state.warning}};export const sendReviewSummaryNotificationById=async()=>{throw Error("Summary send is forbidden during save")};export const sendSubmissionResultNotificationById=async()=>({});export const sendOnlineMvResultNotificationById=async()=>{throw Error("Online bundle is unexpected in this station/track fixture")};`,
          "next/server": "export const after=()=>{};",
          "next/cache": "export const revalidatePath=()=>{};export const updateTag=()=>{};",
          "next/navigation": "export const redirect=url=>{throw Error('redirect:'+url)};",
        };
        return { contents: files[path], loader: "js" };
      });
    } }],
  });
  type Actions = typeof import("../src/features/admin/actions");
  const output = { exports: {} as Pick<Actions, "updateStationReviewAction" | "updateStationReviewsBulkAction"> & {
    state: { admin: boolean; changed: boolean; error: string | null; warning?: string };
    calls: Array<{ name: string; input: Record<string, unknown> }>;
  } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}

test("administrator station saves pass the exact revision and never notify while saving a station result", async () => {
  const f = await fixture();
  const input = { submissionId: sid, stationId, expectedUpdatedAt: revision, status: "APPROVED" as const, ageRating: "12" as const };
  f.state.admin = false;
  await assert.rejects(f.updateStationReviewAction(input), /forbidden/);
  assert.equal(f.calls.length, 0);
  f.state.admin = true;
  f.state.changed = false;
  await f.updateStationReviewAction(input);
  assert.equal(f.calls.filter(c => c.name === "notice").length, 0);
  f.state.changed = true;
  f.state.warning = "자동 재시도 예정";
  const saved = await f.updateStationReviewAction(input);
  assert.equal(saved.warning, undefined);
  assert.equal(f.calls.find(c => c.name === "save")?.input.expectedUpdatedAt, revision);
  assert.equal(f.calls.filter(c => c.name === "notice").length, 0);
  f.state.error = "다른 화면에서 변경되었습니다.";
  assert.ok((await f.updateStationReviewAction(input)).error);
  assert.equal(f.calls.filter(c => c.name === "notice").length, 0);
});


test("web bulk action derives actor, preserves station revisions and never queues a summary", async () => {
  const f=await fixture();const input={submissionId:sid,stations:[{stationId,expectedUpdatedAt:revision}],status:"SENT" as const};
  f.state.admin=false;await assert.rejects(f.updateStationReviewsBulkAction(input),/forbidden/);assert.equal(f.calls.length,0);
  f.state.admin=true;const saved=await f.updateStationReviewsBulkAction(input);assert.match(saved.message??"",/1개 방송사/);
  const call=f.calls.find(c=>c.name==="bulk-save")!;assert.equal(call.input.actorUserId,"22222222-2222-4222-8222-222222222222");assert.deepEqual(call.input.stations,input.stations);assert.equal(f.calls.filter(c=>c.name==="notice").length,0);
});
