import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

const submissionId = "11111111-1111-4111-8111-111111111111";
const trackId = "22222222-2222-4222-8222-222222222222";

async function fixture() {
  const bundle = await build({
    stdin: { contents: "export {createTrackForSubmissionAction,deleteTrackForSubmissionAction} from './src/features/admin/actions';export {state,calls} from 'track-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "track-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(track-fixture|@\/lib\/(?:supabase\/(?:server|admin)|admin\/(?:action-auth|submission-notifications))|next\/(?:server|cache|navigation))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls,db} from 'track-fixture';";
        const files: Record<string, string> = {
          "track-fixture": `export const calls=[];export const state={isAdmin:true,failWrite:false,failAudit:false,track:{id:'${trackId}',track_no:1}};
            export const db={auth:{getUser:async()=>({data:{user:{id:'admin'}}})},from(table){let mode='read',payload;const run=()=>{if(table==='submission_events'){calls.push({name:'audit',input:payload});return {error:state.failAudit?{message:'fixture audit failure'}:null}}if(table==='station_reviews')return {data:[],error:null};if(table==='album_tracks'){if(mode==='read')return {data:state.track,error:null};if(state.failWrite)return {data:null,error:{message:'fixture write failure'}};calls.push({name:mode,input:payload});if(mode==='insert'){state.track={id:'${trackId}',track_no:1};return {data:state.track,error:null}}const rows=state.track?[state.track]:[];state.track=null;return {data:rows,error:null}}return {data:{artist_name:'Artist'},error:null}};const chain={select(){return chain},eq(){return chain},order(){return chain},limit(){return chain},insert(value){mode='insert';payload=value;return chain},delete(){mode='delete';return chain},async single(){return run()},async maybeSingle(){return run()},then(resolve){resolve(run())}};return chain}};`,
          "@/lib/supabase/admin": `${shared}export const createAdminClient=()=>db;`,
          "@/lib/supabase/server": `${shared}export const createServerSupabase=async()=>db;`,
          "@/lib/admin/action-auth": `${shared}export const requireAdminAction=async()=>{if(!state.isAdmin)throw Error('forbidden');return {id:'admin'}};`,
          "@/lib/admin/submission-notifications": `${shared}export const sendSubmissionUpdateNotificationById=async input=>{calls.push({name:'notice',input});return {warning:undefined}};export const sendSubmissionResultNotificationById=async()=>({});`,
          "next/server": "export const after=()=>{};",
          "next/cache": "export const revalidatePath=()=>{};export const updateTag=()=>{};",
          "next/navigation": "export const redirect=url=>{throw Error('redirect:'+url)};",
        };
        return { contents: files[path], loader: "js" };
      });
    } }],
  });
  type Actions = typeof import("../src/features/admin/actions");
  const output = { exports: {} as Pick<Actions, "createTrackForSubmissionAction" | "deleteTrackForSubmissionAction"> & {
    state: { isAdmin: boolean; failWrite: boolean; failAudit: boolean; track: object | null };
    calls: Array<{ name: string; input?: Record<string, unknown> }>;
  } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}
const form = () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ submissionId, trackId, trackTitle: "Track", trackNo: "1", performer: "Artist", composer: "", lyricist: "", arranger: "" })) data.set(key, value);
  return data;
};

test("track additions notify only after saved writes and preserve audit failure warnings", async () => {
  const api = await fixture();
  api.state.isAdmin = false;
  await assert.rejects(api.createTrackForSubmissionAction(form()), /forbidden/);
  assert.equal(api.calls.length, 0);
  api.state.isAdmin = true; api.state.failWrite = true;
  await assert.rejects(api.createTrackForSubmissionAction(form()), /saved=error/);
  assert.equal(api.calls.filter(call => call.name === "notice").length, 0);
  api.state.failWrite = false; api.state.failAudit = true;
  await assert.rejects(api.createTrackForSubmissionAction(form()), error => error instanceof Error && decodeURIComponent(error.message.replace(/\+/g, " ")).includes("처리 기록 저장에 실패"));
  assert.equal(api.calls.filter(call => call.name === "notice").length, 1);
  assert.ok(api.calls.findIndex(call => call.name === "insert") < api.calls.findIndex(call => call.name === "notice"));
  assert.equal(api.calls.find(call => call.name === "notice")?.input?.changeKey, `track-added-${trackId}`);
});

test("track deletions notify once, never on failed writes or already-deleted retries", async () => {
  const api = await fixture();
  api.state.failWrite = true;
  await assert.rejects(api.deleteTrackForSubmissionAction(form()), /saved=error/);
  assert.equal(api.calls.filter(call => call.name === "notice").length, 0);
  api.state.failWrite = false;
  await assert.rejects(api.deleteTrackForSubmissionAction(form()), /saved=track_deleted/);
  assert.equal(api.calls.filter(call => call.name === "notice").length, 1);
  await assert.rejects(api.deleteTrackForSubmissionAction(form()), /saved=track_unchanged/);
  assert.equal(api.calls.filter(call => call.name === "notice").length, 1);
});
