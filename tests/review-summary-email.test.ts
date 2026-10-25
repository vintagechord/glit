import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

const id = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
async function fixture() {
  const bundle = await build({ stdin: { contents: "export {getReviewSummaryEmailPreviewById,sendReviewSummaryNotificationById} from './src/lib/admin/submission-notifications';export {renderReviewSummaryEmail} from './src/lib/email';export {state,calls} from 'summary-fixture';", resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "summary-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(summary-fixture|@\/lib\/(?:supabase\/admin|email-transport|email-delivery-mode|email-attachments|kakao)|\.\/review-desk)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls,db} from 'summary-fixture';";
        const files: Record<string, string> = {
          "summary-fixture": `export const calls=[];export const state={email:'artist@example.invalid',mode:'transactional',result:{ok:true,status:'accepted'},receipt:null,changeRecipientDuringPrepare:false,submission:{id:'${id}',type:'ALBUM',title:'봄의 기록',artist_name:'예시 아티스트',user_id:'member',guest_token:'fictional-guest-link',guest_email:'guest@example.invalid',status:'IN_PROGRESS',result_status:null,updated_at:'2026-10-25T03:00:00Z',certificate_b2_path:null},stations:[{id:'kbs',code:'KBS',name:'KBS',trackIds:['track1'],review:{status:'APPROVED',track_results:[{track_id:'track1',status:'APPROVED'}],updated_at:'2026-10-25T03:00:00Z',age_rating:null}},{id:'mbc',code:'MBC',name:'MBC',trackIds:['track1'],review:{status:'SENT',track_results:[],updated_at:null,age_rating:null}},{id:'sbs',code:'SBS',name:'SBS',trackIds:['track1'],review:{status:'NOT_SENT',track_results:[],updated_at:null,age_rating:null}}]};export const db={auth:{admin:{getUserById:async()=>({data:{user:{email:state.email}},error:null})}},from(table){const chain={select(){return chain},eq(){return chain},order(){return chain},async range(){return{data:state.receipt?[state.receipt]:[],error:null}},async maybeSingle(){return{data:table==='profiles'?{phone:null}:structuredClone(state.submission),error:null}}};return chain}};`,
          "@/lib/supabase/admin": `${shared}export const createAdminClient=()=>db;`,
          "@/lib/email-delivery-mode": `${shared}export const getEmailDeliveryMode=()=>state.mode;`,
          "@/lib/email-transport": `${shared}import{createHash}from'node:crypto';export const sendTransactionalEmail=async mail=>{calls.push({kind:'send',mail});state.receipt={status:state.result.status,idempotency_key:createHash('sha256').update(mail.operation+'\\0'+mail.to.toLowerCase()+'\\0'+mail.idempotencyKey).digest('hex'),recipient_email:mail.to};return state.result;};`,
          "@/lib/email-attachments": `${shared}export {inspectOnlineMvBundleReadiness,EmailAttachmentError} from '${process.cwd()}/src/lib/email-attachments';export const prepareOnlineMvAttachmentRefs=async()=>{calls.push({kind:'prepare'});if(state.changeRecipientDuringPrepare)state.email='changed@example.invalid';return[{kind:'rating-image'},{kind:'usage-guide'},{kind:'certificate'}]};`,
          "@/lib/kakao": `${shared}export const sendKakaoOfficialNotification=async()=>{calls.push({kind:'kakao'});return{ok:true}};`,
          "./review-desk": `${shared}export const loadDeskResults=async()=>{const{certificate_b2_path,...submission}=structuredClone(state.submission);return{type:submission.type,revision:'fixture-revision',submission,stations:structuredClone(state.stations),tracks:[{id:'track1',track_no:1,track_title:'예시 곡',broadcast_selected:true}],assets:{}}};`,
        };
        return { contents: files[path], loader: "js", resolveDir: process.cwd() };
      });
    } }],
  });
  type Api = Pick<typeof import("../src/lib/admin/submission-notifications"), "getReviewSummaryEmailPreviewById" | "sendReviewSummaryNotificationById"> & Pick<typeof import("../src/lib/email"), "renderReviewSummaryEmail"> & {
    state: { email: string; mode: string; result: {ok:boolean;status:string;queued?:boolean};receipt:Record<string,unknown>|null;changeRecipientDuringPrepare:boolean;submission:Record<string,unknown>;stations:Array<{id:string;code:string;name:string;trackIds:string[];review:{status:string;track_results:unknown[];updated_at:string|null;age_rating:string|null}}> };
    calls:Array<{kind:string;mail?:{html:string;subject:string;to:string;idempotencyKey:string;markResultNotified:boolean;attachmentRefs?:unknown[]}}>;
  };
  const output = { exports: {} as Api };new Function("require","module","exports",bundle.outputFiles[0].text)(createRequire(import.meta.url),output,output.exports);return output.exports;
}
const previewInput = { submissionId: id };

test("preview is read-only, masked, includes all requested stations, and exactly matches the sent HTML", async () => {
  const api = await fixture();const preview = await api.getReviewSummaryEmailPreviewById(previewInput);
  assert.equal(preview.canSend,true);assert.equal(preview.recipientMasked,'ar***@example.invalid');assert.equal(api.calls.length,0);
  for(const value of ['KBS','MBC','SBS','결과대기','접수대기','전체 심의 현황 확인','1곡 적격'])assert.ok(preview.html.includes(value),value);
  assert.doesNotMatch(preview.html,/artist@example\.invalid|fictional-guest-link/);
  assert.match(preview.html,/\/dashboard\/submissions\//);
  const outcome=await api.sendReviewSummaryNotificationById({...previewInput,requestId,expectedRevision:preview.revision,expectedUpdatedAt:preview.updatedAt});
  assert.equal(outcome.deliveredCount,1);const mail=api.calls.find(call=>call.kind==='send')!.mail!;
  assert.equal(mail.html,preview.html);assert.equal(mail.subject,preview.subject);assert.equal(mail.markResultNotified,false);
  assert.equal(api.calls.filter(call=>call.kind==='send').length,1);assert.equal(api.calls.some(call=>call.kind==='kakao'),false);
});

test("changed recipient, link, row content, or displayed revision invalidates the preview before sending", async () => {
  for(const change of ['recipient','link','row','revision']){
    const api=await fixture();if(change==='link')api.state.submission.user_id=null;
    const preview=await api.getReviewSummaryEmailPreviewById(previewInput);
    if(change==='recipient')api.state.email='new@example.invalid';
    if(change==='link')api.state.submission.guest_token='changed-guest-link';
    if(change==='row')api.state.stations[1].review.status='REJECTED';
    if(change==='revision')api.state.submission.updated_at='2026-10-25T04:00:00Z';
    const outcome=await api.sendReviewSummaryNotificationById({...previewInput,requestId,expectedRevision:preview.revision,expectedUpdatedAt:preview.updatedAt});
    assert.equal(outcome.errorCode,'CONFLICT',change);assert.equal(api.calls.length,0,change);
  }
});

test("known request replay returns its durable receipt after notification timestamp or recipient changes", async () => {
  for(const status of ['accepted','retry','uncertain']){
    const api=await fixture();api.state.result={ok:status==='accepted',status,queued:status==='retry'};
    const preview=await api.getReviewSummaryEmailPreviewById(previewInput);const input={...previewInput,requestId,expectedRevision:preview.revision,expectedUpdatedAt:preview.updatedAt};
    await api.sendReviewSummaryNotificationById(input);api.state.submission.updated_at='2026-10-25T05:00:00Z';api.state.email='changed@example.invalid';
    const replay=await api.sendReviewSummaryNotificationById(input);
    assert.equal(replay.replayed,true);assert.equal(replay.errorCode,undefined);assert.equal(api.calls.filter(call=>call.kind==='send').length,1);
    assert.equal(status==='accepted'?replay.deliveredCount:status==='retry'?replay.queuedCount:replay.uncertainCount,1);
    if(status==='uncertain')assert.equal(replay.failedCount,0);
  }
});

test("online sends keep three attachments, reject missing files, and revalidate after preparing files", async () => {
  const api=await fixture();Object.assign(api.state.submission,{type:'MV_DISTRIBUTION',status:'RESULT_READY',result_status:'APPROVED',mv_desired_rating:'12'});
  let preview=await api.getReviewSummaryEmailPreviewById(previewInput);assert.equal(preview.canSend,false);assert.ok(preview.missingAssets.length);
  assert.equal((await api.sendReviewSummaryNotificationById({...previewInput,requestId,expectedRevision:preview.revision})).errorCode,'NOT_READY');assert.equal(api.calls.length,0);
  api.state.submission.certificate_b2_path=`submissions/${id}/certificate/fixture.pdf`;
  preview=await api.getReviewSummaryEmailPreviewById(previewInput);assert.equal(preview.canSend,true);assert.match(preview.html,/1 \/ 1 완료/);assert.match(preview.html,/함께 보내드리는 파일 · 3개/);
  api.state.changeRecipientDuringPrepare=true;
  assert.equal((await api.sendReviewSummaryNotificationById({...previewInput,requestId,expectedRevision:preview.revision})).errorCode,'CONFLICT');assert.equal(api.calls.some(call=>call.kind==='send'),false);
  api.state.changeRecipientDuringPrepare=false;preview=await api.getReviewSummaryEmailPreviewById(previewInput);
  assert.equal((await api.sendReviewSummaryNotificationById({...previewInput,requestId,expectedRevision:preview.revision})).deliveredCount,1);
  const mail=api.calls.find(call=>call.kind==='send')!.mail!;assert.equal(mail.html,preview.html);assert.equal(mail.attachmentRefs?.length,3);
});

test("broadcast summary includes each age rating and online rejection has no approval attachments", async () => {
  const api=await fixture();api.state.submission.type='MV_BROADCAST';api.state.stations[0].review.age_rating='15';
  let preview=await api.getReviewSummaryEmailPreviewById(previewInput);assert.match(preview.html,/15세 이상 시청가/);assert.match(preview.html,/접수대기/);
  Object.assign(api.state.submission,{type:'MV_DISTRIBUTION',status:'RESULT_READY',result_status:'REJECTED',mv_desired_rating:'REJECT'});
  preview=await api.getReviewSummaryEmailPreviewById(previewInput);assert.equal(preview.canSend,true);assert.equal(preview.attachmentCount,0);
  await api.sendReviewSummaryNotificationById({...previewInput,requestId,expectedRevision:preview.revision});assert.equal(api.calls.some(call=>call.kind==='prepare'),false);assert.equal(api.calls.find(call=>call.kind==='send')!.mail!.attachmentRefs,undefined);
});

test("structured template escapes all customer fields and refuses unsafe links", async () => {
  const api=await fixture();api.state.submission.title='<img src=x onerror=alert(1)>';api.state.submission.artist_name='<script>private</script>';api.state.stations[0].name='<svg onload=alert(1)>';
  const preview=await api.getReviewSummaryEmailPreviewById(previewInput);assert.doesNotMatch(preview.html,/<script>|<img src=x|<svg onload/);assert.match(preview.html,/&lt;img/);
  assert.throws(()=>api.renderReviewSummaryEmail({title:'fixture',kind:'ALBUM',updatedAt:preview.updatedAt,link:'javascript:alert(1)',rows:[],completedCount:0,attachmentCount:0}),/valid review-status link/);
});
