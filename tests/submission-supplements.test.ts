import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { isSupplementFilenameAllowed, matchesSupplementSignature, supplementActionSchema, SUPPLEMENT_MAX_BYTES, supplementMimeType } from "../src/lib/submission-supplements/model";

test("supplement boundaries reject empty/oversize files, paths, duplicate parts and missing rejection reasons", () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  const base = { action: "init", requestId, filename: "한글 파일.wav", mimeType: "audio/wav", sizeBytes: 1 };
  assert.equal(supplementActionSchema.safeParse(base).success, true);
  for (const sizeBytes of [0, -1, SUPPLEMENT_MAX_BYTES + 1]) assert.equal(supplementActionSchema.safeParse({ ...base, sizeBytes }).success, false);
  for (const filename of ["../file.wav", "file\u0000.wav", "sub\\file.wav"]) assert.equal(supplementActionSchema.safeParse({ ...base, filename }).success, false);
  assert.equal(supplementActionSchema.safeParse({ action: "presign", fileId: requestId, partNumbers: [1, 1] }).success, false);
  assert.equal(supplementActionSchema.safeParse({ action: "review", requestId, decision: "REJECTED", note: " " }).success, false);
  assert.equal(supplementActionSchema.safeParse({ action: "review", requestId, decision: "REJECTED", note: "전체 버전 필요" }).success, true);
  assert.equal(isSupplementFilenameAllowed("movie.mp4", "audio"), false);
  assert.equal(isSupplementFilenameAllowed("movie.mxf", "video"), true);
  assert.equal(supplementMimeType("notes.txt"), "text/plain");
  assert.equal(matchesSupplementSignature("fake.wav", new TextEncoder().encode("this is not wave")), false);
  assert.equal(matchesSupplementSignature("real.wav", new TextEncoder().encode("RIFF1234WAVEdata")), true);
  assert.equal(matchesSupplementSignature("document.docx", Uint8Array.from([0x50, 0x4b, 3, 4])), true);
});

test("supplement API authorization and B2 reconciliation preserve original locks", async () => {
  const result = await build({ stdin: { contents: "export * from './src/lib/submission-supplements/server'; export {state,calls} from 'supplement-fixture';", resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "supplement-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(supplement-fixture|@\/lib\/(?:supabase\/(?:server|admin)|b2|multipart-upload-grants|email|kakao))$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls,db} from 'supplement-fixture';";
        const files: Record<string, string> = {
          "supplement-fixture": `export const calls=[]; export const state={user:null,isAdmin:false,rows:{},grant:null,headSize:16,bytes:new TextEncoder().encode('RIFF1234WAVEdata'),notice:{notificationId:'fixture-notice',leaseToken:'fixture-lease',state:'OPEN',outcome:{}},emailResult:{ok:true,messageId:'email-id'},kakaoResult:{ok:false,skipped:true}};
            export const db={from(table){const filters=[];const chain={select(){return chain},eq(k,v){filters.push(r=>r[k]===v);return chain},is(k,v){filters.push(r=>r[k]===v);return chain},async maybeSingle(){return {data:(state.rows[table]||[]).find(r=>filters.every(f=>f(r)))||null,error:null}},async single(){return chain.maybeSingle()}};return chain},async rpc(name,args){calls.push({name,args});return {data:args.p_action==='notify_claim'?state.notice:{ok:true},error:null}}};`,
          "@/lib/supabase/server": `${shared} export async function createServerSupabase(){return {auth:{getUser:async()=>({data:{user:state.user}})},rpc:async()=>({data:state.isAdmin})}}`,
          "@/lib/supabase/admin": `${shared} export function createAdminClient(){return db}`,
          "@/lib/b2": `${shared} export const getB2Config=()=>({prefix:'configured/',bucket:'fixture',client:{send:async()=>({ContentLength:state.bytes.length,Body:{transformToByteArray:async()=>state.bytes}})}}); export const headObject=async()=>({ContentLength:state.headSize}); export const presignGetUrl=async key=>{calls.push({name:'download',key});return 'https://signed.fixture.invalid'}; export const presignUploadPart=async()=>{calls.push({name:'presign'});return 'https://part.fixture.invalid'}; export const completeMultipartUpload=async()=>{calls.push({name:'complete'})}; export const abortMultipartUpload=async()=>{}; export const createMultipartUpload=async()=> 'fixture-upload'; export const sanitizeFileName=s=>s;`,
          "@/lib/multipart-upload-grants": `${shared} export const getMultipartOwnerKey=({submissionUserId,guestToken})=>submissionUserId?'user:'+submissionUserId:'guest:'+guestToken; export const getMultipartGrant=async()=>state.grant; export const getMultipartPartSize=()=>16; export const abortClaimedMultipartGrant=async()=>{calls.push({name:'abort'});return true}; export const cleanupExpiredMultipartGrants=async()=>{}; export const createMultipartGrant=async()=>state.grant;`,
          "@/lib/email": `${shared} export const sendSubmissionUpdateEmail=async input=>{calls.push({name:'email',args:input});return state.emailResult};`,
          "@/lib/kakao": `${shared} export const sendKakaoOfficialNotification=async input=>{calls.push({name:'kakao',args:input});return state.kakaoResult};`,
        };
        return { loader: "js", contents: files[path] };
      });
    } }],
  });
  type State = { user: { id: string } | null; isAdmin: boolean; rows: Record<string, Record<string, unknown>[]>; grant: Record<string, unknown>; headSize: number; bytes: Uint8Array; notice: Record<string, unknown> };
  type Context = Awaited<ReturnType<typeof import("../src/lib/submission-supplements/server").getSupplementContext>>;
  const bundled = { exports: {} as { state: State; calls: { name: string; args?: { p_action?: string }; key?: string }[]; getSupplementContext: typeof import("../src/lib/submission-supplements/server").getSupplementContext; performSupplementAction: typeof import("../src/lib/submission-supplements/server").performSupplementAction } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  const api = bundled.exports, state = api.state;
  state.rows = {
    submissions: [{ id: "submission-a", user_id: "user-a", guest_token: null, payment_status: "PAID", type: "ALBUM", applicant_email: "fixture@example.invalid", applicant_phone: "01000000000" }, { id: "guest-submission", user_id: null, guest_token: "fixture-token", payment_status: "PAID", type: "ALBUM" }],
    submission_supplement_requests: [{ id: "request-a", submission_id: "submission-a", status: "OPEN" }, { id: "request-b", submission_id: "another-submission", status: "OPEN" }],
    submission_supplement_revisions: [{ id: "revision-a", request_id: "request-a", status: "DRAFT" }, { id: "revision-b", request_id: "request-b", status: "DRAFT" }],
    submission_supplement_files: [{ id: "file-a", revision_id: "revision-a", grant_id: "grant-a", original_name: "fixture.wav", size_bytes: 16, object_key: "supplements/fixture", status: "PENDING" }, { id: "file-b", revision_id: "revision-b", status: "VERIFIED", object_key: "private-other" }],
  };
  const request = new Request("https://fixture.invalid/api");
  await assert.rejects(api.getSupplementContext("submission-a", request), /로그인/);
  state.user = { id: "user-b" };
  await assert.rejects(api.getSupplementContext("submission-a", request), /접근 권한/);
  state.user = null;
  await assert.rejects(api.getSupplementContext("guest-submission", new Request(request, { headers: { "X-Submission-Guest-Token": "wrong-token" } })), /접근 권한/);
  assert.equal((await api.getSupplementContext("guest-submission", new Request(request, { headers: { "X-Submission-Guest-Token": "fixture-token" } }))).submission.id, "guest-submission");
  state.user = { id: "user-a" };
  const owner: Context = await api.getSupplementContext("submission-a", request);
  await assert.rejects(api.performSupplementAction(owner, { action: "request", note: "admin only" }), /관리자/);
  await assert.rejects(api.performSupplementAction(owner, { action: "notify", requestId: "request-a" }), /관리자/);
  await assert.rejects(api.performSupplementAction(owner, { action: "download", fileId: "file-b" }), /보완 요청/);
  assert.equal(api.calls.some((call) => call.name === "download"), false);
  state.grant = { id: "grant-a", submission_id: "submission-a", owner_key: "user:user-a", object_key: "supplements/fixture", status: "COMPLETING", declared_size_bytes: 16, expires_at: new Date(Date.now() + 60000).toISOString() };
  await api.performSupplementAction(owner, { action: "recheck", fileId: "file-a" });
  assert.equal(api.calls.at(-1)?.args?.p_action, "verify");
  assert.equal(api.calls.some((call) => call.name === "complete"), false, "recheck never repeats B2 completion");
  state.headSize = 99;
  await assert.rejects(api.performSupplementAction(owner, { action: "recheck", fileId: "file-a" }), /크기/);
  assert.equal(api.calls.at(-1)?.args?.p_action, "invalidate");
  state.headSize = 16; state.bytes = new TextEncoder().encode("invalid file");
  await assert.rejects(api.performSupplementAction(owner, { action: "recheck", fileId: "file-a" }), /확장자/);
  assert.equal(api.calls.at(-1)?.args?.p_action, "invalidate");
  await api.performSupplementAction(owner, { action: "abort", fileId: "file-a" });
  assert.equal(api.calls.at(-2)?.args?.p_action, "abort");
  assert.equal(api.calls.at(-1)?.name, "abort");
  state.grant.owner_key = "user:user-b";
  await assert.rejects(api.performSupplementAction(owner, { action: "recheck", fileId: "file-a" }), /업로드 권한/);
  state.user = { id: "admin" }; state.isAdmin = true;
  const admin = await api.getSupplementContext("submission-a", request);
  await assert.rejects(api.performSupplementAction(admin, { action: "submit", requestId: "request-a" }), /신청자만/);
  api.calls.length = 0;
  await api.performSupplementAction(admin, { action: "notify", requestId: "request-a" });
  assert.equal(api.calls.filter((call) => ["email", "kakao"].includes(call.name)).length, 2);
  assert.equal(api.calls.at(-1)?.args?.p_action, "notify_finish");
  api.calls.length = 0;
  state.notice.outcome = { email: "API_ACCEPTED", emailMessageId: "email-id", kakao: "SKIPPED" };
  await api.performSupplementAction(admin, { action: "notify", requestId: "request-a" });
  assert.equal(api.calls.filter((call) => call.name === "email").length, 0, "accepted email must not resend while optional Kakao is retried");
  assert.equal(api.calls.filter((call) => call.name === "kakao").length, 1);
  api.calls.length = 0; state.notice.alreadyAccepted = true;
  await api.performSupplementAction(admin, { action: "notify", requestId: "request-a" });
  assert.equal(api.calls.length, 1, "already accepted notice only reads its claim result");
});
