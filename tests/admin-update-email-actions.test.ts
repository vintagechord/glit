import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

const submissionId = "11111111-1111-4111-8111-111111111111";

async function fixture() {
  const bundle = await build({
    stdin: { contents: `export {updatePaymentStatusAction,updateSubmissionMvRatingAction,updateSubmissionStatusAction,updateSubmissionBasicInfoAction,updateSubmissionResultFormAction,saveSubmissionAdminFormAction,notifySubmissionResultAction,notifySubmissionProgressAction} from './src/features/admin/actions';export {state,calls} from 'actions-fixture';`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "actions-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(actions-fixture|@\/lib\/(?:supabase\/(?:server|admin)|payments\/notifications|admin\/(?:action-auth|submission-notifications|mv-review-flow))|next\/(?:server|cache|navigation))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls,db} from 'actions-fixture';";
        const files: Record<string, string> = {
          "actions-fixture": `export const calls=[];export const state={isAdmin:true,failUpdate:false,failEvent:false,warning:undefined,submission:{id:'${submissionId}',type:'ALBUM',status:'PRE_REVIEW',payment_status:'PAID',current_order_id:null,title:'Original',artist_name:'Artist',admin_memo:null,result_status:null,result_memo:null}};
            export const db={auth:{getUser:async()=>({data:{user:{id:'admin'}}})},from(table){let payload=null;const chain={select(){return chain},eq(){return chain},update(value){payload=value;return chain},async maybeSingle(){if(payload){calls.push({name:'write',input:payload});if(state.failUpdate)return {data:null,error:{message:'write failed'}};Object.assign(state.submission,payload)}return {data:{...state.submission},error:null}},async insert(value){calls.push({name:'event',input:value});return {error:state.failEvent?{message:'event rejected'}:null}},then(resolve){chain.maybeSingle().then(resolve)}};return chain}};`,
          "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>db;`,
          "@/lib/supabase/server": `${shared} export const createServerSupabase=async()=>db;`,
          "@/lib/payments/notifications": `${shared} export const sendPaidSubmissionNotificationsById=async input=>{if(state.submission.payment_status!=='PAID')throw Error('payment not committed');calls.push({name:'paid-notice',input});return {recorded:true,warning:state.warning}};`,
          "@/lib/admin/action-auth": `${shared} export const requireAdminAction=async()=>{if(!state.isAdmin)throw Error('forbidden');return {id:'admin'}};`,
          "@/lib/admin/submission-notifications": `${shared} export const sendReviewSummaryNotificationById=async input=>{calls.push({name:"summary",input});return {warning:state.warning}}; export const sendOnlineMvResultNotificationById=async input=>{calls.push({name:'bundle',input});return {warning:state.warning}}; export const sendSubmissionUpdateNotificationById=async input=>{calls.push({name:'notice',input});return {warning:state.warning}};export const sendSubmissionResultNotificationById=async input=>{calls.push({name:'result',input});return {warning:state.warning}};`,
          "@/lib/admin/mv-review-flow": `${shared} export const completeMvReviewFlow=async(_db,id,input)=>{if(state.failUpdate)return {completed:false,error:'atomic write failed'};const changed=state.submission.status!=='RESULT_READY'||state.submission.result_status!==input.resultStatus||(state.submission.result_memo??'')!==(input.resultMemo??'');if(changed){Object.assign(state.submission,{status:'RESULT_READY',result_status:input.resultStatus,result_memo:input.resultMemo});calls.push({name:'atomic',input})}return {completed:true,changed,resultStatus:input.resultStatus,changeKey:'fixture-revision'}};export const resolveMvFallbackStationId=async()=>({stationId:'fixture'});`,
          "next/server": "export const after=()=>{};",
          "next/cache": "export const revalidatePath=()=>{};export const updateTag=()=>{};",
          "next/navigation": "export const redirect=url=>{throw Error('redirect:'+url)};",
        };
        return { contents: files[path], loader: "js" };
      });
    } }],
  });
  type Actions = typeof import("../src/features/admin/actions");
  const output = { exports: {} as Pick<Actions, "updatePaymentStatusAction" | "updateSubmissionMvRatingAction" | "updateSubmissionStatusAction" | "updateSubmissionBasicInfoAction" | "updateSubmissionResultFormAction" | "saveSubmissionAdminFormAction" | "notifySubmissionResultAction" | "notifySubmissionProgressAction"> & {
    state: { isAdmin: boolean; failUpdate: boolean; failEvent: boolean; warning?: string; submission: Record<string, unknown> };
    calls: Array<{ name: string; input: Record<string, unknown> }>;
  } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}

test("admin status/basic actions notify once for actual changes, preserve saved outcomes, and exclude memo-only changes", async () => {
  const api = await fixture();
  api.state.isAdmin = false;
  await assert.rejects(api.updateSubmissionStatusAction({ submissionId, status: "PRE_REVIEW" }), /forbidden/);
  assert.equal(api.calls.length, 0);
  api.state.isAdmin = true;
  await api.updateSubmissionStatusAction({ submissionId, status: "PRE_REVIEW", adminMemo: "private staff note" });
  assert.equal(api.calls.filter(call => call.name === "notice").length, 0);
  api.state.warning = "이메일 발송 보류";
  const status = await api.updateSubmissionStatusAction({ submissionId, status: "IN_PROGRESS" });
  assert.equal(status.error, undefined);
  assert.equal(status.warning, api.state.warning);
  assert.equal(api.state.submission.status, "IN_PROGRESS");
  assert.equal(api.calls.filter(call => call.name === "notice").length, 1);
  await api.updateSubmissionStatusAction({ submissionId, status: "IN_PROGRESS" });
  assert.equal(api.calls.filter(call => call.name === "notice").length, 1);
  await api.updateSubmissionBasicInfoAction({ submissionId, title: "Changed", artistName: "Artist" });
  await api.updateSubmissionBasicInfoAction({ submissionId, title: "Changed", artistName: "Artist" });
  assert.equal(api.calls.filter(call => call.name === "notice").length, 2);
  assert.doesNotMatch(JSON.stringify(api.calls.filter(call => call.name === "notice")), /private staff note/);
  api.state.failUpdate = true;
  assert.ok((await api.updateSubmissionBasicInfoAction({ submissionId, title: "Rejected write" })).error);
  assert.equal(api.calls.filter(call => call.name === "notice").length, 2);
});

test("main admin form distinguishes saved changes from delivery failure and sends nothing for private notes", async () => {
  const api = await fixture();
  const form = new FormData();
  for (const [key, value] of Object.entries({ submissionId, status: "PRE_REVIEW", paymentStatus: "PAID", title: "Original", artistName: "Artist", adminMemo: "private staff note" })) form.set(key, value);
  await assert.rejects(api.saveSubmissionAdminFormAction(form), /redirect:/);
  assert.equal(api.calls.filter(call => call.name === "notice").length, 0);
  form.set("title", "Updated"); api.state.warning = "이메일 발송 실패";
  await assert.rejects(api.saveSubmissionAdminFormAction(form), error => error instanceof Error && error.message.includes("saved=status_warning") && decodeURIComponent(error.message.replace(/\+/g, " ")).includes(api.state.warning!));
  assert.equal(api.state.submission.title, "Updated");
  assert.equal(api.calls.filter(call => call.name === "notice").length, 1);
  await assert.rejects(api.saveSubmissionAdminFormAction(form), /redirect:/);
  assert.equal(api.calls.filter(call => call.name === "notice").length, 1);
});

test("result form saves never enqueue email, including unchanged retries", async () => {
  const api = await fixture();
  const form = new FormData();
  form.set("submissionId", submissionId); form.set("resultStatus", "APPROVED"); form.set("resultMemo", "result details");
  api.state.warning = "이메일 발송 보류";
  await assert.rejects(api.updateSubmissionResultFormAction(form), error => error instanceof Error && error.message.includes("saved=result"));
  assert.equal(api.calls.filter(call => call.name === "result").length, 0);
  assert.equal(api.state.submission.result_status, "APPROVED");
  await assert.rejects(api.updateSubmissionResultFormAction(form), /redirect:/);
  assert.equal(api.calls.filter(call => call.name === "result").length, 0);
});


test("audit insert failures are reported without hiding a committed change or skipping its email", async () => {
  const api = await fixture();
  api.state.failEvent = true;
  const result = await api.updateSubmissionStatusAction({ submissionId, status: "IN_PROGRESS" });
  assert.equal(result.error, undefined);
  assert.match(result.warning ?? "", /처리 기록 저장에 실패/);
  assert.equal(api.calls.filter(call => call.name === "notice").length, 1);
});

test("explicit result send requires admin permission and a preview revision plus stable request ID", async () => {
  const api = await fixture();
  const preview = { expectedRevision: "a".repeat(64), expectedUpdatedAt: "2026-10-25T00:00:00Z", requestId: "22222222-2222-4222-8222-222222222222" };
  api.state.isAdmin = false;
  await assert.rejects(api.notifySubmissionResultAction(submissionId, preview), /forbidden/);
  api.state.isAdmin = true;
  assert.ok((await api.notifySubmissionResultAction(submissionId)).error);
  assert.equal(api.calls.length, 0);
  api.state.warning = "자동 재시도 예정";
  assert.equal((await api.notifySubmissionResultAction(submissionId, preview)).warning, api.state.warning);
  await api.notifySubmissionResultAction(submissionId, preview);
  const attempts = api.calls.filter(call => call.name === "summary");
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].input.requestId, attempts[1].input.requestId);
  assert.equal(attempts[0].input.expectedRevision, preview.expectedRevision);
});

test("manual progress resend validates current state, reports audit and enqueue failure, and sends no private notes", async () => {
  const api = await fixture();
  api.state.isAdmin = false;
  await assert.rejects(api.notifySubmissionProgressAction(submissionId), /forbidden/);
  api.state.isAdmin = true;
  assert.ok((await api.notifySubmissionProgressAction("not-a-uuid")).error);
  api.state.submission.status = "DRAFT";
  assert.ok((await api.notifySubmissionProgressAction(submissionId)).error);
  assert.equal(api.calls.length, 0);
  api.state.submission.status = "IN_PROGRESS";
  api.state.submission.admin_memo = "private staff note";
  api.state.submission.result_memo = "private result details";
  api.state.failEvent = true;
  api.state.warning = "이메일 발송 내역 등록 실패";
  const first = await api.notifySubmissionProgressAction(submissionId);
  assert.match(first.warning ?? "", /재발송 요청 기록/);
  assert.match(first.warning ?? "", /발송 내역 등록 실패/);
  api.state.submission.status = "RESULT_READY";
  await api.notifySubmissionProgressAction(submissionId);
  const notices = api.calls.filter(call => call.name === "notice");
  assert.equal(notices.length, 2);
  assert.notEqual(notices[0].input.changeKey, notices[1].input.changeKey);
  assert.match(String(notices[0].input.summary), /심의 진행/);
  assert.match(String(notices[1].input.summary), /결과 준비/);
  assert.doesNotMatch(JSON.stringify(notices), /private staff|private result/);
  assert.equal(api.calls.filter(call => call.name === "write").length, 0);
});

test("online legacy grade and result saves never send; only the preview-confirmed action requests summary delivery", async () => {
  const api = await fixture();
  api.state.submission.type = "MV_DISTRIBUTION";
  const form = new FormData();
  form.set("submissionId", submissionId); form.set("resultStatus", "APPROVED");
  await assert.rejects(api.updateSubmissionResultFormAction(form), /redirect:/);
  await assert.rejects(api.updateSubmissionResultFormAction(form), /redirect:/);
  await api.updateSubmissionMvRatingAction({ submissionId, rating: "15" });
  assert.equal(api.calls.filter(call => ["bundle", "result", "notice", "summary"].includes(call.name)).length, 0);
  await api.notifySubmissionResultAction(submissionId, { expectedRevision: "a".repeat(64), expectedUpdatedAt: "2026-10-25T00:00:00Z", requestId: "22222222-2222-4222-8222-222222222222" });
  assert.equal(api.calls.filter(call => call.name === "summary").length, 1);
});

test("saving overall final workflow status does not send result mail", async () => {
  const api = await fixture();
  await api.updateSubmissionStatusAction({ submissionId, status: "RESULT_READY" });
  assert.equal(api.calls.filter(call => call.name === "notice").length, 0);
  const form = new FormData();
  for (const [key, value] of Object.entries({ submissionId, status: "COMPLETED", paymentStatus: "PAID", title: "Original", artistName: "Artist" })) form.set(key, value);
  await assert.rejects(api.saveSubmissionAdminFormAction(form), /redirect:/);
  assert.equal(api.calls.filter(call => call.name === "notice").length, 0);
});

test("manual bank confirmation sends the shared customer/admin receipt only after PAID is stored", async () => {
  const api = await fixture();
  api.state.submission.payment_status = "PAYMENT_PENDING";
  api.state.submission.status = "WAITING_PAYMENT";
  const result = await api.updatePaymentStatusAction({ submissionId, paymentStatus: "PAID" });
  assert.equal(result.error, undefined);
  assert.equal(api.state.submission.payment_status, "PAID");
  assert.equal(api.state.submission.status, "PRE_REVIEW");
  const notices = api.calls.filter(call => call.name === "paid-notice");
  assert.equal(notices.length, 1);
  assert.equal(notices[0].input.paymentKey, `bank:${submissionId}`);
  assert.equal(api.calls.filter(call => call.name === "notice").length, 0);
  await api.updatePaymentStatusAction({ submissionId, paymentStatus: "PAID" });
  assert.equal(api.calls.filter(call => call.name === "paid-notice").length, 1);
});

test("main form paid transition uses one receipt flow and failed saves send none", async () => {
  for (const failUpdate of [false, true]) {
    const api = await fixture();
    api.state.submission.payment_status = "PAYMENT_PENDING";
    api.state.submission.status = "WAITING_PAYMENT";
    api.state.failUpdate = failUpdate;
    const form = new FormData();
    for (const [key, value] of Object.entries({ submissionId, status: "WAITING_PAYMENT", paymentStatus: "PAID", title: "Original", artistName: "Artist" })) form.set(key, value);
    await assert.rejects(api.saveSubmissionAdminFormAction(form), /redirect:/);
    assert.equal(api.calls.filter(call => call.name === "paid-notice").length, failUpdate ? 0 : 1);
    assert.equal(api.calls.filter(call => call.name === "notice").length, 0);
  }
});
