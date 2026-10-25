import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

type Fixture = {
  submission: Record<string, unknown> | null;
  memberEmail: string | null;
  memberError: boolean;
  emailResult: { ok: boolean; skipped?: boolean; queued?: boolean; status?: string };
  mode: string;
  isAdmin: boolean;
  completionError: string | null;
  recordError: boolean;
  throwEmail: boolean;
  attachmentError: boolean;
};
type Call = { name: string; input?: Record<string, unknown> };

async function fixture() {
  const result = await build({
    stdin: { contents: `export * from './src/lib/admin/submission-notifications'; export {PATCH} from './src/app/api/admin/submissions/[id]/mv-rating/route'; export {state,calls} from 'notice-fixture';`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "notice-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(notice-fixture|@\/lib\/(?:supabase\/(?:server|admin)|email|email-attachments|email-delivery-mode|kakao|admin\/review-management)|next\/(?:server|cache))$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls,db} from 'notice-fixture';";
        const files: Record<string, string> = {
          "notice-fixture": `export const calls=[]; export const state={submission:{id:'11111111-1111-4111-8111-111111111111',user_id:'member',type:'MV_DISTRIBUTION',title:'Fixture',artist_name:'Artist',guest_token:'legacy-secret',guest_email:'legacy@example.invalid',applicant_email:'untrusted@example.invalid',status:'PRE_REVIEW',updated_at:'2026-10-24T00:00:00Z'},memberEmail:'Personal@example.invalid',memberError:false,emailResult:{ok:true},mode:'transactional',isAdmin:true,completionError:null,recordError:false,throwEmail:false,attachmentError:false};
            export const db={auth:{admin:{getUserById:async()=>({data:{user:{email:state.memberEmail}},error:state.memberError?{message:'lookup failed'}:null})}},from(table){let update;const chain={select(){return chain},eq(){return chain},update(value){update=value;calls.push({name:'record',input:value});return chain},async maybeSingle(){return {data:table==='profiles'?{phone:null}:state.submission,error:null}},then(resolve){resolve({error:state.recordError?{message:'record failed'}:null,data:update})}};return chain}};`,
          "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>db;`,
          "@/lib/supabase/server": `${shared} export const createServerSupabase=async()=>({auth:{getUser:async()=>({data:{user:{id:'admin'}}})},rpc:async()=>({data:state.isAdmin})});`,
          "@/lib/email": `${shared} export const sendSubmissionUpdateEmail=async input=>{calls.push({name:'email',input});if(state.throwEmail)throw Error('transport failure');return state.emailResult}; export const sendResultEmail=async input=>{calls.push({name:'result',input});return state.emailResult};`,
          "@/lib/email-attachments": `${shared}
            export {inspectOnlineMvBundleReadiness,EmailAttachmentError} from '${process.cwd()}/src/lib/email-attachments';
            export const prepareOnlineMvAttachmentRefs=async submission=>{calls.push({name:'prepare'});if(state.attachmentError)throw Error('fixture asset unavailable');return ['rating-image','usage-guide','certificate'].map(kind=>({kind,objectKey:kind==='certificate'?submission.certificate_b2_path:kind,sha256:kind,submissionId:submission.id,rating:submission.mv_desired_rating,certificateKey:submission.certificate_b2_path}));};`,
          "@/lib/email-delivery-mode": `${shared} export const getEmailDeliveryMode=()=>state.mode;`,
          "@/lib/kakao": `${shared} export const sendKakaoOfficialNotification=async input=>{calls.push({name:'kakao',input});return {ok:false,skipped:true}};`,
          "@/lib/admin/review-management": `${shared} export const saveManagedOnlineReview=async(_db,input)=>{calls.push({name:'commit',input});if(state.completionError)return {ok:false,error:state.completionError,errorCode:state.completionError==='conflict'?'CONFLICT':'SAVE_FAILED'};const changed=state.submission.mv_desired_rating!==input.rating||state.submission.status!=='RESULT_READY';const resultStatus=input.rating==='REJECT'?'REJECTED':'APPROVED';Object.assign(state.submission,{mv_desired_rating:input.rating,result_status:resultStatus,status:'RESULT_READY'});return {ok:true,changed,resultStatus}};`,
          "next/server": "export const NextResponse={json:(body,init)=>Response.json(body,init)};",
          "next/cache": "export const revalidatePath=()=>{};",
        };
        return { contents: files[path], loader: "js", resolveDir: process.cwd() };
      });
    } }],
  });
  type Api = typeof import("../src/lib/admin/submission-notifications") & {
    PATCH: typeof import("../src/app/api/admin/submissions/[id]/mv-rating/route").PATCH;
    state: Fixture; calls: Call[];
  };
  const output = { exports: {} as Api };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}

const update = { submissionId: "11111111-1111-4111-8111-111111111111", headline: "심의 변경", summary: "신청 내역을 확인해주세요." };

test("admin notices use the member's personal email and never expose a legacy guest token", async () => {
  const api = await fixture();
  const outcome = await api.sendSubmissionUpdateNotificationById(update);
  assert.equal(outcome.deliveredCount, 1);
  const emails = api.calls.filter((call) => call.name === "email");
  assert.equal(emails.length, 1);
  assert.equal(emails[0].input?.email, "personal@example.invalid");
  assert.match(String(emails[0].input?.link), /\/dashboard\/submissions\//);
  assert.doesNotMatch(JSON.stringify(emails), /legacy-secret|untrusted@example|legacy@example/);
  assert.match(String(emails[0].input?.idempotencyKey), /^submission-update-[a-f0-9]{64}$/);

  api.state.memberError = true; api.calls.length = 0;
  const failedLookup = await api.sendSubmissionUpdateNotificationById(update);
  assert.match(failedLookup.warning ?? "", /수신 이메일/);
  assert.equal(api.calls.filter((call) => call.name === "email").length, 0, "never fall back to an applicant address for a member");
});

test("guest notices use the stored guest email and access link", async () => {
  const api = await fixture();
  api.state.submission!.user_id = null;
  const outcome = await api.sendSubmissionUpdateNotificationById(update);
  assert.equal(outcome.deliveredCount, 1);
  const email = api.calls.find((call) => call.name === "email")?.input;
  assert.equal(email?.email, "legacy@example.invalid");
  assert.match(String(email?.link), /\/track\/legacy-secret$/);
});

test("manual mode, provider skips, rejection and thrown transport errors return truthful save warnings", async () => {
  const api = await fixture();
  api.state.mode = "manual";
  let outcome = await api.sendSubmissionUpdateNotificationById(update);
  assert.equal(outcome.skippedCount, 1);
  assert.match(outcome.warning ?? "", /보류/);
  assert.equal(api.calls.filter((call) => call.name === "email").length, 0);
  api.state.mode = "transactional";
  for (const result of [{ ok: false, skipped: true }, { ok: false }]) {
    api.state.emailResult = result;
    outcome = await api.sendSubmissionUpdateNotificationById(update);
    assert.equal(outcome.deliveredCount, 0);
    assert.match(outcome.warning ?? "", /변경사항은 저장/);
  }
  api.state.throwEmail = true;
  outcome = await api.sendSubmissionUpdateNotificationById(update);
  assert.equal(outcome.failedCount, 1);
  assert.match(outcome.warning ?? "", /발송에 실패/);
});

test("result emails omit notes and delegate acceptance audit metadata to the durable outbox", async () => {
  const api = await fixture();
  api.state.emailResult = { ok: false };
  await api.sendSubmissionResultNotificationById({ ...update, resultStatus: "APPROVED", resultMemo: "private internal note" });
  assert.equal(api.calls.filter((call) => call.name === "record").length, 0);
  assert.doesNotMatch(JSON.stringify(api.calls), /private internal note/);
  api.state.emailResult = { ok: true }; api.calls.length = 0;
  assert.equal((await api.sendSubmissionResultNotificationById({ ...update, resultStatus: "APPROVED" })).deliveredCount, 1);
  assert.equal(api.calls.filter((call) => call.name === "record").length, 0);
  assert.equal(api.calls.find(call => call.name === "result")?.input?.markResultNotified, true);
  assert.equal(api.calls.find(call => call.name === "result")?.input?.submissionId, update.submissionId);
});

test("active MV rating API authorizes, notifies only a committed change once, and reports delivery warnings", async () => {
  const api = await fixture();
  const request = () => new Request("https://fixture.invalid/api", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: "REJECT", expectedUpdatedAt: "2026-10-25T00:00:00Z" }) });
  const invoke = () => api.PATCH(request() as Parameters<typeof api.PATCH>[0], { params: Promise.resolve({ id: update.submissionId }) });
  api.state.isAdmin = false;
  assert.equal((await invoke()).status, 403);
  assert.equal(api.calls.length, 0);
  api.state.isAdmin = true; api.state.completionError = "저장 실패";
  assert.equal((await invoke()).status, 500);
  assert.equal(api.calls.filter((call) => call.name === "result").length, 0);
  api.state.completionError = null; api.state.emailResult = { ok: false }; api.calls.length = 0;
  const response = await invoke();
  assert.equal(response.status, 200);
  assert.match((await response.json()).warning, /발송에 실패/);
  assert.equal(api.calls.filter((call) => call.name === "result").length, 1);
  assert.equal(api.calls.find((call) => call.name === "commit")?.input?.rating, "REJECT");
  assert.equal(api.calls.find(call => call.name === "result")?.input?.markResultNotified, true);
  assert.equal(api.calls.find(call => call.name === "result")?.input?.submissionId, update.submissionId);
  assert.ok(api.calls.findIndex((call) => call.name === "commit") < api.calls.findIndex((call) => call.name === "result"));
  const initialNoticeKey = api.calls.find(call => call.name === "result")?.input?.idempotencyKey;
  api.calls.length = 0;
  assert.equal((await (await invoke()).json()).unchanged, true);
  assert.equal(api.calls.filter((call) => call.name === "result").length, 1, "unchanged saves retry the same durable notification key");
  assert.equal(api.calls.find(call => call.name === "result")?.input?.idempotencyKey, initialNoticeKey);
  assert.equal(api.calls.filter((call) => call.name === "commit").length, 1, "atomic RPC verifies station state before declaring a no-op");
});


test("queued and uncertain administrator notices remain distinguishable from provider acceptance", async () => {
  const api = await fixture();
  api.state.emailResult = { ok: false, queued: true, status: "retry" };
  const queued = await api.sendSubmissionUpdateNotificationById(update);
  assert.equal(queued.deliveredCount, 0);
  assert.equal(queued.queuedCount, 1);
  assert.match(queued.warning ?? "", /자동 재시도 예정/);
  api.state.emailResult = { ok: false, status: "uncertain" };
  const uncertain = await api.sendSubmissionUpdateNotificationById(update);
  assert.match(uncertain.warning ?? "", /접수 여부/);
  assert.equal(uncertain.deliveredCount, 0);
});

test("online result waits for the complete bundle then deduplicates grade and certificate events", async () => {
  const api = await fixture();
  Object.assign(api.state.submission!, { status: "RESULT_READY", result_status: "APPROVED", mv_desired_rating: "12" });
  const pending = await api.sendOnlineMvResultNotificationById({ submissionId: update.submissionId });
  assert.equal(pending.pendingAssets, true);
  assert.match(pending.warning ?? "", /필증/);
  assert.equal(api.calls.length, 0, "no partial mail or Kakao notice before the certificate is available");
  api.state.submission!.certificate_b2_path = `submissions/${update.submissionId}/certificate/first.pdf`;
  assert.equal((await api.sendOnlineMvResultNotificationById({ submissionId: update.submissionId })).deliveredCount, 1);
  await api.sendOnlineMvResultNotificationById({ submissionId: update.submissionId });
  const emails = api.calls.filter(call => call.name === "email");
  assert.equal(emails.length, 2);
  assert.equal(emails[0].input?.idempotencyKey, emails[1].input?.idempotencyKey, "the durable outbox deduplicates identical assets across both save events");
  assert.equal((emails[0].input?.attachmentRefs as unknown[]).length, 3);
  assert.match(String(emails[0].input?.headline), /12세이상관람가/);
  assert.equal(emails[0].input?.markResultNotified, true);
  assert.equal(emails[0].input?.email, "personal@example.invalid");
  api.state.submission!.certificate_b2_path = `submissions/${update.submissionId}/certificate/replacement.pdf`;
  await api.sendOnlineMvResultNotificationById({ submissionId: update.submissionId });
  const replacement = api.calls.filter(call => call.name === "email").at(-1)!;
  assert.notEqual(replacement.input?.idempotencyKey, emails[0].input?.idempotencyKey);
  await api.sendOnlineMvResultNotificationById({ submissionId: update.submissionId, forceResendKey: "authorized-resend" });
  assert.notEqual(api.calls.filter(call => call.name === "email").at(-1)?.input?.idempotencyKey, replacement.input?.idempotencyKey);
});

test("online bundle file failure is truthful and rejection sends no approval attachments", async () => {
  const api = await fixture();
  Object.assign(api.state.submission!, { status: "RESULT_READY", result_status: "APPROVED", mv_desired_rating: "15", certificate_b2_path: `submissions/${update.submissionId}/certificate/cert.pdf` });
  api.state.attachmentError = true;
  const failed = await api.sendOnlineMvResultNotificationById({ submissionId: update.submissionId });
  assert.equal(failed.failedCount, 1);
  assert.equal(failed.deliveredCount, 0);
  assert.match(failed.warning ?? "", /첨부파일/);
  assert.equal(api.calls.filter(call => ["email", "result", "kakao"].includes(call.name)).length, 0);
  api.calls.length = 0;
  Object.assign(api.state.submission!, { mv_desired_rating: "REJECT", certificate_b2_path: null, result_status: "REJECTED" });
  assert.equal((await api.sendOnlineMvResultNotificationById({ submissionId: update.submissionId })).deliveredCount, 1);
  assert.equal(api.calls.filter(call => call.name === "prepare").length, 0);
  assert.equal(api.calls.find(call => call.name === "result")?.input?.resultStatus, "REJECTED");
  assert.equal(api.calls.find(call => call.name === "result")?.input?.attachmentRefs, undefined);
});

test("grade route requires the displayed revision, reports conflicts, and waits for certificate", async () => {
  const api = await fixture();
  const invoke = (body: object) => api.PATCH(new Request("https://fixture.invalid/api", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }) as Parameters<typeof api.PATCH>[0], { params: Promise.resolve({ id: update.submissionId }) });
  assert.equal((await invoke({ rating: "12" })).status, 400);
  assert.equal(api.calls.length, 0);
  api.state.completionError = "conflict";
  assert.equal((await invoke({ rating: "12", expectedUpdatedAt: "2026-10-25T00:00:00Z" })).status, 409);
  assert.equal(api.calls.filter(call => ["email", "result", "prepare"].includes(call.name)).length, 0);
  api.state.completionError = null;
  const response = await invoke({ rating: "18", expectedUpdatedAt: "2026-10-25T00:00:00Z" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.rating, "19");
  assert.equal(body.pendingAssets, true);
  assert.equal(body.deliveredCount, 0);
  assert.equal(api.calls.filter(call => ["email", "result", "prepare"].includes(call.name)).length, 0);
});
