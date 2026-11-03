import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { isSupplementFilenameAllowed, matchesSupplementSignature, supplementActionSchema, SUPPLEMENT_MAX_BYTES, supplementMimeType } from "../src/lib/submission-supplements/model";
import { isTransientFailure, retryTransient, supplementResumeKey } from "../src/lib/submission-supplements/upload-retry";
import { multipartCompletionManifest } from "../src/lib/multipart-upload-completion";

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
          "supplement-fixture": `export const calls=[]; export const state={user:null,isAdmin:false,memberEmail:'owner@example.invalid',memberError:false,failMutation:false,failFinish:false,rows:{},grant:null,headSize:16,bytes:new TextEncoder().encode('RIFF1234WAVEdata'),notice:{notificationId:'fixture-notice',leaseToken:'fixture-lease',state:'OPEN',outcome:{}},emailResult:{ok:true,messageId:'email-id'},kakaoResult:{ok:false,skipped:true}};
            export const db={auth:{admin:{getUserById:async()=>({data:{user:{email:state.memberEmail}},error:state.memberError?{message:'lookup failed'}:null})}},from(table){const filters=[];const chain={select(){return chain},eq(k,v){filters.push(r=>r[k]===v);return chain},is(k,v){filters.push(r=>r[k]===v);return chain},async maybeSingle(){return {data:(state.rows[table]||[]).find(r=>filters.every(f=>f(r)))||null,error:null}},async single(){return chain.maybeSingle()}};return chain},async rpc(name,args){calls.push({name,args});return {data:args.p_action==='notify_claim'?state.notice:args.p_action==='request'?{requestId:'request-a'}:{ok:true},error:(state.failMutation&&args.p_action!=='notify_claim')||(state.failFinish&&args.p_action==='notify_finish')?{message:'write failed'}:null}}};`,
          "@/lib/supabase/server": `${shared} export async function createServerSupabase(){return {auth:{getUser:async()=>({data:{user:state.user}})},rpc:async()=>({data:state.isAdmin})}}`,
          "@/lib/supabase/admin": `${shared} export function createAdminClient(){return db}`,
          "@/lib/b2": `${shared} export const getB2Config=()=>({prefix:'configured/',bucket:'fixture',client:{send:async()=>({ContentLength:state.bytes.length,Body:{transformToByteArray:async()=>state.bytes}})}}); export const headObject=async()=>({ContentLength:state.headSize}); export const presignGetUrl=async key=>{calls.push({name:'download',key});return 'https://signed.fixture.invalid'}; export const presignUploadPart=async()=>{calls.push({name:'presign'});return 'https://part.fixture.invalid'}; export const completeMultipartUpload=async()=>{calls.push({name:'complete'})}; export const abortMultipartUpload=async()=>{}; export const createMultipartUpload=async()=> 'fixture-upload'; export const sanitizeFileName=s=>s; export const listMultipartUploadParts=async()=>null;`,
          "@/lib/multipart-upload-grants": `${shared} export const getMultipartOwnerKey=({submissionUserId,guestToken})=>submissionUserId?'user:'+submissionUserId:'guest:'+guestToken; export const getMultipartGrant=async()=>state.grant; export const getMultipartPartSize=()=>16; export const abortClaimedMultipartGrant=async()=>{calls.push({name:'abort'});return true}; export const cleanupExpiredMultipartGrants=async()=>{}; export const createMultipartGrant=async()=>state.grant; export const abortFailedMultipartGrant=async()=>{calls.push({name:'retire'});return true};`,
          "@/lib/email": `${shared} export const sendSubmissionUpdateEmail=async input=>{calls.push({name:'email',args:input});return state.emailResult};`,
          "@/lib/kakao": `${shared} export const sendKakaoOfficialNotification=async input=>{calls.push({name:'kakao',args:input});return state.kakaoResult};`,
        };
        return { loader: "js", contents: files[path] };
      });
    } }],
  });
  type State = { user: { id: string } | null; isAdmin: boolean; memberEmail: string; memberError: boolean; failMutation: boolean; failFinish: boolean; emailResult: Record<string, unknown>; rows: Record<string, Record<string, unknown>[]>; grant: Record<string, unknown>; headSize: number; bytes: Uint8Array; notice: Record<string, unknown> };
  type Context = Awaited<ReturnType<typeof import("../src/lib/submission-supplements/server").getSupplementContext>>;
  const bundled = { exports: {} as { state: State; calls: { name: string; args?: { p_action?: string; email?: string }; key?: string }[]; getSupplementContext: typeof import("../src/lib/submission-supplements/server").getSupplementContext; performSupplementAction: typeof import("../src/lib/submission-supplements/server").performSupplementAction } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  const api = bundled.exports, state = api.state;
  state.rows = {
    submissions: [{ id: "submission-a", user_id: "user-a", guest_token: null, payment_status: "PAID", type: "ALBUM", applicant_email: "fixture@example.invalid", applicant_phone: "01000000000" }, { id: "guest-submission", user_id: null, guest_token: "fixture-token", payment_status: "PAID", type: "ALBUM", guest_email: "guest@example.invalid", applicant_email: "stale@example.invalid" }],
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
  assert.equal(api.calls.at(-2)?.args?.p_action, "invalidate");
  state.headSize = 16; state.bytes = new TextEncoder().encode("invalid file");
  await assert.rejects(api.performSupplementAction(owner, { action: "recheck", fileId: "file-a" }), /확장자/);
  assert.equal(api.calls.at(-2)?.args?.p_action, "invalidate");
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
  assert.equal(api.calls.find(call => call.name === "email")?.args?.email, "owner@example.invalid");
  for (const input of [{ action: "request", note: "추가 자료 요청" }, { action: "review", requestId: "request-a", decision: "ACCEPTED", note: "확인 완료" }, { action: "review", requestId: "request-a", decision: "REJECTED", note: "추가 수정 필요" }] as const) {
    api.calls.length = 0;
    await api.performSupplementAction(admin, input);
    assert.equal(api.calls.filter(call => call.name === "email").length, 1, "committed supplement change automatically sends one notice");
    assert.ok(api.calls.findIndex(call => call.name === "email") > api.calls.findIndex(call => call.name === "mutate_submission_supplement"));
  }
  state.failMutation = true; api.calls.length = 0;
  await assert.rejects(api.performSupplementAction(admin, { action: "request", note: "실패 요청" }));
  assert.equal(api.calls.filter(call => call.name === "email").length, 0);
  state.failMutation = false; state.memberError = true; api.calls.length = 0;
  await api.performSupplementAction(admin, { action: "notify", requestId: "request-a" });
  assert.equal(api.calls.filter(call => call.name === "email").length, 0, "member lookup failure must never use applicant_email");
  state.memberError = false;
  const guestAdmin = await api.getSupplementContext("guest-submission", request);
  api.calls.length = 0;
  await api.performSupplementAction(guestAdmin, { action: "notify", requestId: "guest-request" });
  assert.equal(api.calls.find(call => call.name === "email")?.args?.email, "guest@example.invalid");
  for (const [emailResult, warning] of [
    [{ ok: false, queued: true, status: "retry", outboxId: "outbox-fixture" }, /자동 재시도/],
    [{ ok: false, status: "uncertain", outboxId: "outbox-fixture" }, /접수 여부/],
  ] as const) {
    state.emailResult = emailResult;
    const result = await api.performSupplementAction(admin, { action: "request", note: "후속 안내" }) as { warning?: string; notification: { email: string; emailStatus: string } };
    assert.match(result.warning ?? "", warning);
    assert.equal(result.notification.email, "FAILED", "queued/uncertain are not provider acceptance");
    assert.equal(result.notification.emailStatus, emailResult.status);
  }
  state.emailResult = { ok: true, messageId: "email-id" };
  state.failFinish = true;
  const savedWithoutAudit = await api.performSupplementAction(admin, { action: "request", note: "감사 기록 실패" }) as { requestId?: string; warning?: string };
  assert.equal(savedWithoutAudit.requestId, "request-a");
  assert.match(savedWithoutAudit.warning ?? "", /저장되었지만/);
  state.failFinish = false;
  api.calls.length = 0;
  state.notice.outcome = { email: "API_ACCEPTED", emailMessageId: "email-id", kakao: "SKIPPED" };
  await api.performSupplementAction(admin, { action: "notify", requestId: "request-a" });
  assert.equal(api.calls.filter((call) => call.name === "email").length, 0, "accepted email must not resend while optional Kakao is retried");
  assert.equal(api.calls.filter((call) => call.name === "kakao").length, 1);
  api.calls.length = 0; state.notice.alreadyAccepted = true;
  await api.performSupplementAction(admin, { action: "notify", requestId: "request-a" });
  assert.equal(api.calls.length, 1, "already accepted notice only reads its claim result");
});

test("a claimed supplement upload whose B2 completion failed is completed again instead of waiting forever", async () => {
  const fixture = `export const calls=[]; export const state={grant:null,object:false,completeFailure:null,listed:null,bytes:new TextEncoder().encode('RIFF1234WAVEdata')};
    const rows={submission_supplement_requests:[{id:'request-a',submission_id:'submission-a',status:'OPEN'}],submission_supplement_revisions:[{id:'revision-a',request_id:'request-a',status:'DRAFT'}],
      submission_supplement_files:[{id:'file-a',revision_id:'revision-a',grant_id:'grant-a',original_name:'fixture.wav',size_bytes:16,object_key:'configured/supplements/submission-a/request-a/revision-a/u/fixture.wav',status:'PENDING'}]};
    export const db={from(table){const filters=[];let patch=null;const chain={select(){return chain},update(values){patch=values;return chain},eq(k,v){filters.push(r=>r[k]===v);return chain},is(k,v){filters.push(r=>(r[k]??null)===v);return chain},
      async maybeSingle(){if(table==='multipart_upload_grants'&&patch){const g=state.grant;if(!filters.every(f=>f(g)))return {data:null,error:null};Object.assign(g,patch);calls.push({name:'bind-manifest'});return {data:{id:g.id},error:null}}return {data:(rows[table]||[]).find(r=>filters.every(f=>f(r)))||null,error:null}},async single(){return chain.maybeSingle()}};return chain},
      async rpc(name,args){calls.push({name,args});if(name==='claim_multipart_upload_completion'){state.grant.status='COMPLETING';state.grant.completion_manifest_hash=args.p_manifest_hash}if(args.p_action==='invalidate')state.grant.status='FAILED';if(args.p_action==='verify')state.grant.status='COMPLETED';return {data:{ok:true},error:null}}};`;
  const result = await build({ stdin: { contents: "export * from './src/lib/submission-supplements/server'; export {state,calls,db} from 'recompletion-fixture';", resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "recompletion-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(recompletion-fixture|@\/lib\/(?:supabase\/(?:server|admin)|b2|multipart-upload-grants|email|kakao))$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls,db} from 'recompletion-fixture';";
        const files: Record<string, string> = {
          "recompletion-fixture": fixture,
          "@/lib/supabase/server": `export async function createServerSupabase(){return {auth:{getUser:async()=>({data:{user:{id:'user-a'}}})},rpc:async()=>({data:false})}}`,
          "@/lib/supabase/admin": `${shared} export function createAdminClient(){return db}`,
          "@/lib/b2": `${shared} export const getB2Config=()=>({prefix:'configured/',bucket:'fixture',client:{send:async()=>({ContentLength:state.bytes.length,Body:{transformToByteArray:async()=>state.bytes}})}});
            export const headObject=async()=>{calls.push({name:'head'});if(!state.object)throw Object.assign(new Error('missing'),{name:'NotFound'});return {ContentLength:16}};
            export const completeMultipartUpload=async input=>{calls.push({name:'complete',parts:input.parts});const failure=state.completeFailure;state.completeFailure=null;if(failure)throw Object.assign(new Error(failure),{name:failure});state.object=true};
            export const listMultipartUploadParts=async()=>{calls.push({name:'list-parts'});return state.listed};
            export const presignGetUrl=async()=> 'https://signed.fixture.invalid'; export const presignUploadPart=async()=> 'https://part.fixture.invalid'; export const abortMultipartUpload=async()=>{}; export const createMultipartUpload=async()=> 'fixture-upload'; export const sanitizeFileName=s=>s;`,
          "@/lib/multipart-upload-grants": `${shared} export const getMultipartOwnerKey=({submissionUserId})=>'user:'+submissionUserId; export const getMultipartGrant=async()=>({...state.grant}); export const getMultipartPartSize=()=>8; export const abortClaimedMultipartGrant=async()=>true; export const cleanupExpiredMultipartGrants=async()=>{}; export const createMultipartGrant=async()=>state.grant; export const abortFailedMultipartGrant=async()=>{calls.push({name:'retire'});state.grant.status='ABORTED';state.object=false;return true};`,
          "@/lib/email": `export const sendSubmissionUpdateEmail=async()=>({ok:true});`,
          "@/lib/kakao": `export const sendKakaoOfficialNotification=async()=>({ok:true});`,
        };
        return { loader: "js", contents: files[path] };
      });
    } }],
  });
  type Grant = { id: string; status: string; completion_manifest_hash: string | null; [key: string]: unknown };
  type Server = typeof import("../src/lib/submission-supplements/server");
  const bundled = { exports: {} as { state: { grant: Grant; object: boolean; completeFailure: string | null; listed: unknown }; calls: Array<{ name: string; args?: { p_action?: string; p_manifest_hash?: string }; parts?: Array<{ partNumber: number; etag: string }> }>; db: unknown; performSupplementAction: Server["performSupplementAction"] } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  const api = bundled.exports;
  const context = { db: api.db, submission: { id: "submission-a", user_id: "user-a", guest_token: null, payment_status: "PAID", type: "ALBUM" }, userId: "user-a", isAdmin: false, guestToken: null } as unknown as Parameters<Server["performSupplementAction"]>[0];
  const run = (input: Parameters<Server["performSupplementAction"]>[1]) => api.performSupplementAction(context, input);
  const parts = [{ partNumber: 1, etag: "fixture-etag-one" }, { partNumber: 2, etag: "fixture-etag-two" }];
  const manifest = multipartCompletionManifest(parts);
  const reset = (overrides: Partial<Grant> = {}) => {
    api.calls.length = 0; api.state.object = false; api.state.completeFailure = null; api.state.listed = null;
    api.state.grant = { id: "grant-a", submission_id: "submission-a", owner_key: "user:user-a", upload_id: "fixture-upload", object_key: "configured/supplements/submission-a/request-a/revision-a/u/fixture.wav", status: "ACTIVE", declared_size_bytes: 16, part_count: 2, part_size_bytes: 8, completion_manifest_hash: null, expires_at: new Date(Date.now() + 60_000).toISOString(), ...overrides };
  };
  const count = (name: string) => api.calls.filter((call) => call.name === name).length;
  const lastAction = () => api.calls.filter((call) => call.args?.p_action).at(-1)?.args?.p_action;

  // The first completion binds the ETag manifest, as the main multipart flow does.
  reset();
  assert.deepEqual(await run({ action: "complete", fileId: "file-a", parts }), { verified: true });
  assert.equal(api.calls.find((call) => call.name === "claim_multipart_upload_completion")?.args?.p_manifest_hash, manifest);
  assert.equal(lastAction(), "verify");

  // B2 rejected or lost the first CompleteMultipartUpload (InvalidPart, 5xx):
  // the grant stayed COMPLETING with no object. A retry completes it again.
  reset({ status: "COMPLETING", completion_manifest_hash: manifest });
  assert.deepEqual(await run({ action: "complete", fileId: "file-a", parts: [...parts].reverse() }), { verified: true });
  assert.equal(count("complete"), 1);
  assert.equal(count("claim_multipart_upload_completion"), 0, "the claim is not repeated");
  assert.equal(lastAction(), "verify");

  // A different part list cannot ride on someone else's claim.
  reset({ status: "COMPLETING", completion_manifest_hash: manifest });
  await assert.rejects(run({ action: "complete", fileId: "file-a", parts: [{ ...parts[0], etag: "tampered-etag" }, parts[1]] }), /다른 업로드 조각/);
  assert.equal(count("complete"), 0);

  // A claim from before manifests were bound takes the first complete list once.
  reset({ status: "COMPLETING", completion_manifest_hash: null });
  assert.deepEqual(await run({ action: "complete", fileId: "file-a", parts }), { verified: true });
  assert.equal(count("bind-manifest"), 1);
  assert.equal(api.state.grant.completion_manifest_hash, manifest);

  // After a reload the browser has no part list: recheck reads it back from B2.
  reset({ status: "COMPLETING", completion_manifest_hash: manifest });
  api.state.listed = parts.map((part) => ({ ...part, size: 8 }));
  assert.deepEqual(await run({ action: "recheck", fileId: "file-a" }), { verified: true });
  assert.deepEqual(api.calls.find((call) => call.name === "complete")?.parts, parts);

  // B2 parts that do not match the bound manifest are never assembled.
  reset({ status: "COMPLETING", completion_manifest_hash: manifest });
  api.state.listed = [{ partNumber: 1, etag: "other-etag", size: 8 }, { partNumber: 2, etag: "fixture-etag-two", size: 8 }];
  await assert.rejects(run({ action: "recheck", fileId: "file-a" }), /전송 확인을 완료하지 못했습니다/);
  assert.equal(count("complete"), 0);

  // A provider error that will not pass retires the file and its upload id.
  for (const failure of ["InvalidPart", "NoSuchUpload"]) {
    reset({ status: "COMPLETING", completion_manifest_hash: manifest });
    api.state.completeFailure = failure;
    await assert.rejects(run({ action: "complete", fileId: "file-a", parts }), /업로드 조각이 일치하지 않습니다/);
    assert.equal(lastAction(), "invalidate", failure);
    assert.equal(api.calls.at(-1)?.name, "retire", failure);
  }

  // A transient failure stays retryable: no invalidation, 503.
  reset({ status: "COMPLETING", completion_manifest_hash: manifest });
  api.state.completeFailure = "InternalError";
  await assert.rejects(run({ action: "complete", fileId: "file-a", parts }), (error: Error & { status?: number }) => error.status === 503);
  assert.equal(lastAction(), undefined);
  assert.equal(api.state.grant.status, "COMPLETING");

  // The upload id is gone and nothing was assembled: reselect.
  reset({ status: "COMPLETING", completion_manifest_hash: manifest });
  api.state.listed = null;
  await assert.rejects(run({ action: "recheck", fileId: "file-a" }), /업로드가 종료되어/);
  assert.equal(lastAction(), "invalidate");
});

test("supplement upload retries only transient failures, with backoff", async () => {
  const signal = new AbortController().signal;
  assert.equal(isTransientFailure(Object.assign(new Error("x"), { status: 503 })), true);
  assert.equal(isTransientFailure(Object.assign(new Error("x"), { status: 429 })), true);
  assert.equal(isTransientFailure(Object.assign(new TypeError("Failed to fetch"))), true);
  assert.equal(isTransientFailure(Object.assign(new Error("x"), { name: "TimeoutError" })), true);
  for (const status of [400, 403, 409, 410]) assert.equal(isTransientFailure(Object.assign(new Error("x"), { status })), false, String(status));

  let attempts = 0;
  assert.equal(await retryTransient(async () => { attempts++; if (attempts < 3) throw new TypeError("offline"); return "sent"; }, signal, 5, 1), "sent");
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(retryTransient(async () => { attempts++; throw Object.assign(new Error("gone"), { status: 410 }); }, signal, 5, 1), /gone/);
  assert.equal(attempts, 1, "a final error is not retried");
  attempts = 0;
  await assert.rejects(retryTransient(async () => { attempts++; throw new TypeError("offline"); }, signal, 3, 1));
  assert.equal(attempts, 3, "attempts are bounded");
  const cancelled = new AbortController(); cancelled.abort();
  attempts = 0;
  await assert.rejects(retryTransient(async () => { attempts++; throw new TypeError("offline"); }, cancelled.signal, 5, 1));
  assert.equal(attempts, 1, "a cancelled upload stops retrying");
  assert.equal(supplementResumeKey("s", "r", { name: "a.wav", size: 3, lastModified: 7 }), "supplement-multipart:s:r:a.wav:3:7");
});
