import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import type { EmailMessage, EmailSendResult } from "../src/lib/email-transport";

const submissionId = "11111111-1111-4111-8111-111111111111";
async function fixture() {
  const built = await build({
    stdin: { contents: "export {sendPaidSubmissionNotificationsById} from './src/lib/payments/notifications';export {sendAdminSubmissionReceiptEmail} from './src/lib/email';export {state,messages,receipts} from 'paid-notice-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "paid-notices", setup(plugin) {
      plugin.onResolve({ filter: /^(paid-notice-fixture|@\/lib\/(?:supabase\/admin|email-transport|kakao))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,messages,receipts} from 'paid-notice-fixture';";
        const files: Record<string, string> = {
          "paid-notice-fixture": `export const state={submission:{id:'${submissionId}',user_id:'member',guest_token:'legacy-private-token',guest_email:'guest@example.invalid',applicant_email:'wrong@example.invalid',type:'ALBUM',title:'Title<script>',artist_name:'Artist<&',payment_status:'PAID',amount_krw:1000,current_order_id:null},order:null,orderItems:[],orderFlags:[],event:null,eventLookupError:false,email:'Owner@example.invalid',lookupError:false,lookupThrow:false,loadError:false,failedOperation:null,queuedOperation:null,throwOperation:null};export const messages=[];export const receipts=new Map();`,
          "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>({auth:{admin:{getUserById:async()=>{if(state.lookupThrow)throw Error('lookup unavailable');return {data:{user:{email:state.email}},error:state.lookupError?{}:null}}}},from(table){const q={select(){return q},eq(){return q},in(){return q},maybeSingle:async()=>({data:table==='paid_submission_notification_events'?state.event:table==='profiles'?{phone:null}:table==='submission_orders'?state.order:state.submission,error:(table==='paid_submission_notification_events'?state.eventLookupError:state.loadError)?{}:null}),then(resolve,reject){return Promise.resolve({data:table==='submission_order_items'?state.orderItems:table==='submissions'?state.orderFlags:[],error:null}).then(resolve,reject)}};return q;}});`,
          "@/lib/email-transport": `${shared} export const sendTransactionalEmail=async message=>{messages.push(message);if(state.throwOperation===message.operation)throw Error('fixture failure');if(state.failedOperation===message.operation)return {ok:false};const key=message.operation+':'+message.to+':'+message.idempotencyKey;if(!receipts.has(key))receipts.set(key,{ok:state.queuedOperation!==message.operation,status:state.queuedOperation===message.operation?'retry':'accepted',queued:state.queuedOperation===message.operation,outboxId:'receipt-'+receipts.size});return receipts.get(key);};`,
          "@/lib/kakao": "export const sendKakaoOfficialNotification=async()=>({ok:true});",
        };
        return { loader: "js", contents: files[path] };
      });
    } }],
  });
  const loaded = { exports: {} as Pick<typeof import("../src/lib/payments/notifications"), "sendPaidSubmissionNotificationsById"> & Pick<typeof import("../src/lib/email"), "sendAdminSubmissionReceiptEmail"> & {
    state: { submission: Record<string, unknown> | null; order: Record<string, unknown> | null; orderItems: Record<string, unknown>[]; orderFlags: Record<string, unknown>[]; event: { payment_key: string; enqueued_at: string | null } | null; eventLookupError: boolean; email: string | null; lookupError: boolean; lookupThrow: boolean; loadError: boolean; failedOperation: string | null; queuedOperation: string | null; throwOperation: string | null };
    messages: EmailMessage[]; receipts: Map<string, EmailSendResult>;
  } };
  new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports;
}
const input = { submissionId, paymentKey: "SUBP-fixture-order" };

test("all review types send one customer receipt and one designated administrator receipt with separate access links", async () => {
  for (const [type, label] of [["ALBUM", "음반"], ["MV_DISTRIBUTION", "온라인 뮤직비디오"], ["MV_BROADCAST", "방송용 뮤직비디오"]]) {
    const h = await fixture(); h.state.submission!.type = type;
    const result = await h.sendPaidSubmissionNotificationsById(input);
    assert.equal(result.recorded, true);
    assert.equal(result.eligible, true);
    const admin = h.messages.find(message => message.operation === "admin submission receipt")!;
    const customer = h.messages.find(message => message.operation === "submission update")!;
    assert.equal(admin.to, "iamonside@daum.net");
    assert.match(admin.subject, new RegExp(label));
    assert.match(admin.html, /\/admin\/submissions\/detail\?id=/);
    assert.match(admin.html, /결제 완료/);
    assert.match(admin.html, /접수예정/);
    assert.match(admin.html, /Title&lt;script&gt;/);
    assert.match(admin.html, /Artist&lt;&amp;/);
    assert.doesNotMatch(admin.html, /legacy-private|wrong@example|guest@example|<script>/);
    assert.equal(admin.markResultNotified, undefined);
    assert.equal(customer.to, "owner@example.invalid");
    assert.match(customer.html, /\/dashboard\/submissions\//);
    assert.doesNotMatch(customer.html, /legacy-private/);
    assert.equal(customer.idempotencyKey, `payment-approved:SUBP-fixture-order:${submissionId}:owner@example.invalid`);
  }
});

test("callbacks and workers reuse durable keys; different payment keys never duplicate the admin receipt", async () => {
  const h = await fixture();
  await h.sendPaidSubmissionNotificationsById(input);
  await h.sendPaidSubmissionNotificationsById(input);
  assert.equal(h.receipts.size, 2);
  await h.sendPaidSubmissionNotificationsById({ ...input, paymentKey: "bank:changed-order" });
  assert.equal([...h.receipts.keys()].filter(key => key.startsWith("admin submission receipt:")).length, 1);
});

test("missing customer address never blocks admin; failed member lookup retries without using applicant contact", async () => {
  for (const condition of ["missing", "error", "throw"]) {
    const h = await fixture();
    if (condition === "missing") h.state.email = null;
    else if (condition === "error") h.state.lookupError = true;
    else h.state.lookupThrow = true;
    const result = await h.sendPaidSubmissionNotificationsById(input);
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].to, "iamonside@daum.net");
    assert.equal(result.recorded, condition === "missing");
  }
});

test("guest receipt retains customer access code but administrator only gets login-protected admin link", async () => {
  const h = await fixture(); h.state.submission!.user_id = null;
  await h.sendPaidSubmissionNotificationsById(input);
  const customer = h.messages.find(message => message.operation === "submission update")!;
  const admin = h.messages.find(message => message.operation === "admin submission receipt")!;
  assert.equal(customer.to, "guest@example.invalid");
  assert.match(customer.html, /\/track\/legacy-private-token/);
  assert.doesNotMatch(admin.html, /legacy-private-token/);
});

test("registration failures are retryable independently; queued mail has a durable receipt", async () => {
  for (const operation of ["admin submission receipt", "submission update"]) {
    const h = await fixture(); h.state.failedOperation = operation;
    assert.equal((await h.sendPaidSubmissionNotificationsById(input)).recorded, false);
    assert.equal(h.messages.length, 2, "one failure does not suppress the other notification");
    h.state.failedOperation = null;
    h.state.queuedOperation = operation;
    assert.equal((await h.sendPaidSubmissionNotificationsById(input)).recorded, true);
    assert.equal(h.receipts.size, 2);
    h.state.throwOperation = operation;
    assert.equal((await h.sendPaidSubmissionNotificationsById(input)).recorded, false);
  }
});

test("only committed paid submissions can notify; failed lookups remain retryable", async () => {
  const h = await fixture();
  for (const status of ["UNPAID", "PAYMENT_PENDING", "REFUNDED"]) {
    h.state.submission!.payment_status = status;
    const result = await h.sendPaidSubmissionNotificationsById(input);
    assert.equal(result.eligible, false);
    assert.equal(result.recorded, true);
  }
  assert.equal(h.messages.length, 0);
  h.state.loadError = true;
  assert.equal((await h.sendPaidSubmissionNotificationsById(input)).recorded, false);
  assert.equal(h.messages.length, 0);
});

test("committed event key overrides different callback and manual-confirmation keys", async () => {
  const h = await fixture();
  h.state.event = { payment_key: `paid:${submissionId}`, enqueued_at: null };
  await h.sendPaidSubmissionNotificationsById({ ...input, paymentKey: `bank:${submissionId}` });
  await h.sendPaidSubmissionNotificationsById({ ...input, paymentKey: "historical-approved-order" });
  assert.equal(h.receipts.size, 2);
  const customers = h.messages.filter(message => message.operation === "submission update");
  assert.equal(customers.length, 2);
  assert.equal(customers[0].idempotencyKey, customers[1].idempotencyKey);
  assert.equal(customers[0].idempotencyKey, `payment-approved:paid:${submissionId}:${submissionId}:owner@example.invalid`);
});

test("event lookup failure remains retryable without sending with an unverified dedupe key", async () => {
  const h = await fixture(); h.state.eventLookupError = true;
  const result = await h.sendPaidSubmissionNotificationsById(input);
  assert.equal(result.eligible, true);
  assert.equal(result.recorded, false);
  assert.equal(h.messages.length, 0);
});

test("completed durable event suppresses old callback replay after outbox retention cleanup", async () => {
  const h = await fixture();
  h.state.event = { payment_key: "SUBP-fixture-order", enqueued_at: "2026-09-01T00:00:00Z" };
  const result = await h.sendPaidSubmissionNotificationsById(input);
  assert.equal(h.receipts.size, 0, "simulate messages that have already been cleaned up");
  assert.equal(result.recorded, true);
  assert.equal(result.eligible, true);
  assert.equal(h.messages.length, 0);
});

test("failed, expired and uncertain durable receipts request operator review instead of claiming they are queued", async () => {
  for (const status of ["failed", "expired", "uncertain"] as const) {
    const h = await fixture();
    await h.sendPaidSubmissionNotificationsById(input);
    for (const [key, receipt] of h.receipts) {
      if (key.startsWith("submission update:")) h.receipts.set(key, { ...receipt, ok: false, status, queued: false });
    }
    const result = await h.sendPaidSubmissionNotificationsById(input);
    assert.equal(result.recorded, true, "the event must not recreate a message held for manual review");
    assert.doesNotMatch(result.warning ?? "", /발송 대기열에 등록/);
    assert.match(result.warning ?? "", status === "uncertain" ? /자동 재발송을 보류/ : /실패·만료 사유/);
  }
});

const orderFixture = async (paymentMethod: "CARD" | "BANK" | "PAYPAL" = "CARD") => {
  const h = await fixture();
  h.state.submission!.current_order_id = "order-1";
  h.state.order = { id: "order-1", payment_method: paymentMethod, amount_krw: 80000, amount: paymentMethod === "PAYPAL" ? 61.5 : null, currency: paymentMethod === "PAYPAL" ? "USD" : "KRW", paid_at: "2026-10-26T01:00:00Z" };
  h.state.orderItems = [
    { submission_ref: submissionId, title: "Title<script>", artist_name: "Artist<&", type: "ALBUM", amount_krw: 50000 },
    { submission_ref: "22222222-2222-4222-8222-222222222222", title: "Second title", artist_name: "Second artist", type: "MV_BROADCAST", amount_krw: 30000 },
  ];
  h.state.orderFlags = [{ id: submissionId, files_submitted_by_email: true }, { id: "22222222-2222-4222-8222-222222222222", files_submitted_by_email: false }];
  return h;
};

test("paid receipts carry the whole order once per order and restate the email file choice", async () => {
  const h = await orderFixture();
  const result = await h.sendPaidSubmissionNotificationsById(input);
  assert.equal(result.recorded, true);
  const customer = h.messages.find(message => message.operation === "payment completed")!;
  assert.ok(customer, "the order-aware receipt replaces the per-application notice");
  assert.equal(h.messages.some(message => message.operation === "submission update"), false);
  assert.equal(customer.to, "owner@example.invalid");
  assert.equal(customer.idempotencyKey, "payment-approved:SUBP-fixture-order:order-1:owner@example.invalid");
  assert.match(customer.subject, /결제 완료 및 심의 접수 안내/);
  assert.match(customer.html, /결제가 완료되었습니다/);
  assert.match(customer.html, /order-1/);
  assert.match(customer.html, /카드 결제/);
  assert.match(customer.html, /80,000원/);
  assert.match(customer.html, /Title&lt;script&gt;/);
  assert.match(customer.html, /Second title/);
  assert.match(customer.html, /이메일 파일 제출 안내/);
  assert.match(customer.html, /\/mypage\/orders\?focus=/);
  assert.match(customer.html, /\/dashboard\/submissions\//);
  assert.doesNotMatch(customer.html, /<script>|legacy-private/);

  // The second application of the same order reuses the order key, so the
  // customer gets one summary while the administrator still gets one notice per application.
  h.state.submission!.id = "22222222-2222-4222-8222-222222222222";
  h.state.orderFlags = [{ id: submissionId, files_submitted_by_email: false }];
  await h.sendPaidSubmissionNotificationsById({ ...input, submissionId: "22222222-2222-4222-8222-222222222222" });
  assert.equal([...h.receipts.keys()].filter(key => key.startsWith("payment completed:")).length, 1);
  assert.equal([...h.receipts.keys()].filter(key => key.startsWith("admin submission receipt:")).length, 2);
  assert.doesNotMatch(h.messages.at(-1)!.html, /이메일 파일 제출 안내/);
});

test("bank confirmations and guest orders describe the deposit and keep the guest access code", async () => {
  const h = await orderFixture("BANK");
  h.state.submission!.user_id = null;
  await h.sendPaidSubmissionNotificationsById({ ...input, paymentKey: "bank:order-1" });
  const customer = h.messages.find(message => message.operation === "payment completed")!;
  assert.equal(customer.to, "guest@example.invalid");
  assert.match(customer.subject, /입금 확인/);
  assert.match(customer.html, /입금이 확인되었습니다/);
  assert.match(customer.html, /무통장 입금/);
  assert.match(customer.html, /\/track\/legacy-private-token/);
  assert.match(customer.html, /비회원 조회 코드/);
  assert.doesNotMatch(customer.html, /\/mypage\/orders/);
});

test("an unreadable order falls back to the per-application notice instead of blocking the receipt", async () => {
  const h = await orderFixture();
  h.state.order = null;
  const result = await h.sendPaidSubmissionNotificationsById(input);
  assert.equal(result.recorded, true);
  const customer = h.messages.find(message => message.operation === "submission update")!;
  assert.equal(customer.idempotencyKey, `payment-approved:SUBP-fixture-order:${submissionId}:owner@example.invalid`);
});
