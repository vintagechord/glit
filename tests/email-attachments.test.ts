import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

async function fixture() {
  const result = await build({ stdin: { contents: "export * from './src/lib/email-attachments';export {sendEmailAttempt} from './src/lib/email-transport';export {state,calls,db} from 'attachment-fixture';", resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "attachment-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(attachment-fixture|@\/lib\/(?:b2|supabase\/admin|mv-assets|email-config|email-outbox|config)|nodemailer)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls,db} from 'attachment-fixture';";
        const files: Record<string, string> = {
          "attachment-fixture": `import {Readable} from 'node:stream';export const calls=[];export const state={submission:{id:'11111111-1111-4111-8111-111111111111',type:'MV_DISTRIBUTION',status:'RESULT_READY',result_status:'APPROVED',mv_desired_rating:'12',certificate_b2_path:'submissions/11111111-1111-4111-8111-111111111111/certificate/original.pdf',certificate_original_name:'발급 필증.pdf'},imageSource:'submissions/assets/rating.png',provider:'supabase-smtp',objects:new Map(),broken:false};state.objects.set(state.imageSource,Buffer.from([137,80,78,71,13,10,26,10,1,2,3]));state.objects.set('submissions/assets/guide.pdf',Buffer.from('%PDF-guide'));state.objects.set(state.submission.certificate_b2_path,Buffer.from('%PDF-certificate'));const chain={select(){return chain},eq(){return chain},maybeSingle:async()=>({data:state.submission,error:null})};export const db={from(){return chain}};export const client={async send(command){const input=command.input;calls.push({kind:input.Body?'put':'get',key:input.Key});if(state.broken)throw Error('provider secret must not leak');if(input.Body){state.objects.set(input.Key,Buffer.from(input.Body));return{}}const bytes=state.objects.get(input.Key);if(!bytes)throw Error('missing');return{Body:Readable.from([bytes]),ContentLength:bytes.length}}};`,
          "@/lib/b2": `${shared} import {client} from 'attachment-fixture';export const getB2Config=()=>({client,bucket:'fixture',prefix:'submissions/'});`,
          "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>db;`,
          "@/lib/mv-assets": `${shared} export const RATING_LABELS={ALL:'전체관람가','12':'12세이상관람가','15':'15세이상관람가','18':'청소년관람불가','19':'청소년관람불가',REJECT:'심의불가'};export const LABEL_GUIDE_KEY='submissions/assets/guide.pdf';export const RATING_IMAGE_MAP={};export const isRatingCode=value=>Object.hasOwn(RATING_LABELS,value);export const resolveRatingImageSource=async()=>({source:state.imageSource});`,
          "@/lib/config": "export const APP_CONFIG={supportEmail:'help@example.invalid'};",
          "@/lib/email-outbox": "export const enqueueAndSendEmail=()=>{throw Error('not called')};",
          "@/lib/email-config": `${shared}export const isEmailRecipient=v=>v.includes('@');export const classifyEmailProviderFailure=()=>({reason:'delivery',diagnostic:'fixture'});export const getEmailDeliveryConfiguration=()=>({ok:true,mode:'transactional',provider:state.provider,from:'sender@daum.net',sender:{ok:true,senderDomain:'daum.net'},relay:{url:'https://fixture.supabase.co/functions/v1/send-transactional-email',secret:'dedicated'},smtp:{host:'smtp.daum.net',port:465,secure:true,user:'fixture',pass:'secret'},gmail:{clientId:'id',clientSecret:'secret',refreshToken:'refresh'},apiKey:'resend-test'});`,
          nodemailer: `${shared}export function createTransport(options){return{async sendMail(mail){calls.push({kind:options.streamTransport?'mime':'smtp',mail});return options.streamTransport?{message:Buffer.from('mime')}:{accepted:[mail.to],rejected:[]}},close(){}}}`,
        };
        return { contents: files[path], loader: "js" };
      });
    } }],
  });
  type Api = typeof import("../src/lib/email-attachments") & { sendEmailAttempt: typeof import("../src/lib/email-transport").sendEmailAttempt; state: { submission: Record<string, string>; imageSource: string; provider: string; objects: Map<string, Buffer>; broken: boolean }; calls: { kind: string; key?: string; mail?: { attachments?: { filename: string; content: Buffer; contentType: string }[] } }[]; db: unknown };
  const output = { exports: {} as Api }; new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports); return output.exports;
}

test("online result readiness waits for published grade and certificate; rejection has no approval bundle", async () => {
  const api = await fixture(); assert.equal(api.inspectOnlineMvBundleReadiness(api.state.submission).ready, true);
  assert.equal(api.inspectOnlineMvBundleReadiness({ ...api.state.submission, certificate_b2_path: null }).ready, false);
  assert.equal(api.inspectOnlineMvBundleReadiness({ ...api.state.submission, status: "PRE_REVIEW", result_status: null }).ready, false);
  assert.deepEqual(api.inspectOnlineMvBundleReadiness({ ...api.state.submission, mv_desired_rating: "REJECT", certificate_b2_path: null }).attachmentCount, 0);
});
test("three original assets become bounded immutable B2 refs and each retry verifies the same bytes", async () => {
  const api = await fixture(); const refs = await api.prepareOnlineMvAttachmentRefs(api.state.submission, api.db);
  assert.equal(refs.length, 3); assert.equal(api.validateEmailAttachmentRefs(refs), true); assert.equal(api.calls.filter(c => c.kind === "put").length, 2);
  assert.ok(refs.every(ref => !JSON.stringify(ref).includes("contentBase64") && ref.bytes > 0));
  const attachments = await api.resolveEmailAttachments(refs); assert.equal(attachments.length, 3); assert.equal(attachments[2].content.toString(), "%PDF-certificate");
  api.state.objects.set(refs[0].objectKey, Buffer.from([137,80,78,71,13,10,26,10,9,9,9]));
  await assert.rejects(api.resolveEmailAttachments(refs), /첨부파일 정보/);
});
test("stale rating/certificate and arbitrary attachment sources cannot send", async () => {
  const api = await fixture(); const refs = await api.prepareOnlineMvAttachmentRefs(api.state.submission, api.db);
  api.state.submission.mv_desired_rating = "15"; await assert.rejects(api.resolveEmailAttachments(refs), /결과가 변경/);
  assert.equal(api.validateEmailAttachmentRefs([{ ...refs[0], objectKey: "https://private.invalid/file" }, ...refs.slice(1)]), false);
  assert.equal(api.validateEmailAttachmentRefs([{ ...refs[0], filename: "x\r\nBcc:test" }, ...refs.slice(1)]), false);
  assert.equal(api.validateEmailAttachmentRefs([{ ...refs[0], contentBase64: "not-durable-metadata" }, ...refs.slice(1)]), false);
  assert.equal(api.validateEmailAttachmentRefs(refs.map(ref => ({ ...ref, bytes: 18 * 1024 * 1024 }))), false);
  api.state.imageSource = "https://unconfigured.invalid/image.png"; await assert.rejects(api.prepareOnlineMvAttachmentRefs(api.state.submission, api.db), /첨부파일 정보/);
});
test("all transports receive the exact three bytes and attachment failure prevents any physical provider send", async () => {
  const api = await fixture(); const refs = await api.prepareOnlineMvAttachmentRefs(api.state.submission, api.db);
  const requests: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: init?.body instanceof URLSearchParams ? {} : JSON.parse(String(init?.body || '{}')), headers: new Headers(init?.headers) });
    if (String(url).includes('oauth2')) return Response.json({ access_token: 'token' });
    if (String(url).includes('supabase')) return Response.json({ ok: true, messageId: 'smtp-11111111-1111-4111-8111-111111111111' });
    return Response.json({ id: 'accepted' });
  };
  try {
    const message = { to: "recipient@example.invalid", subject: "심의 결과", html: "<p>첨부파일</p>", operation: "submission update", attachmentRefs: refs };
    for (const provider of ['supabase-smtp', 'smtp', 'gmail', 'resend']) { api.state.provider = provider; assert.equal((await api.sendEmailAttempt(message)).ok, true, provider); }
    const relay = requests.find(r => r.url.includes('supabase'))!; assert.equal((relay.body.attachments as unknown[]).length, 3); assert.equal(relay.headers.get('x-onside-attachment-count'), '3');
    assert.equal((requests.find(r => r.url.includes('resend'))!.body.attachments as unknown[]).length, 3);
    for (const call of api.calls.filter(c => ['smtp','mime'].includes(c.kind))) assert.equal(call.mail?.attachments?.length, 3);
    const before = requests.length; api.state.submission.mv_desired_rating = 'ALL';
    assert.equal((await api.sendEmailAttempt(message)).outcome, 'failed'); assert.equal(requests.length, before);
  } finally { globalThis.fetch = originalFetch; }
});
