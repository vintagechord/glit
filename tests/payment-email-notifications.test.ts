import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import type { NextRequest } from "next/server";

const submissionId = "20000000-0000-4000-8000-000000000001";
const memberId = "10000000-0000-4000-8000-000000000001";
type Row = Record<string, unknown>;
type Fixture = {
  markPaymentSuccess: (orderId: string, payload: object) => Promise<{ ok: boolean }>;
  POST: (request: NextRequest) => Promise<Response>;
  state: { rows: Row[]; orders: Row[]; orderItems: Row[]; nextOrderId: string; paymentStatus: string; user: { id: string; email: string } | null; memberEmail: string | null; mailOk: boolean; userError: unknown };
  calls: Array<{ method: string; input?: Row }>;
};

async function fixture(): Promise<Fixture> {
  const built = await build({
    stdin: { contents: "export {markPaymentSuccess} from './src/lib/payments/submission';export {POST} from './src/app/api/cart/bank/route';export {state,calls} from 'payment-email-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "payment-email-infrastructure", setup(plugin) {
      plugin.onResolve({ filter: /^(payment-email-fixture|next\/cache|@\/lib\/(?:supabase\/(?:admin|server|server-user)|email|kakao|dashboard-status|request-rate-limit|submission-payment-(?:files|stations|pricing)|inicis\/(?:stdpay|config)))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls,client} from 'payment-email-fixture';";
        const modules: Record<string, string> = {
          "payment-email-fixture": `
            export const calls=[];
            export const state={rows:[],orders:[],orderItems:[],nextOrderId:'30000000-0000-4000-8000-000000000001',paymentStatus:'REQUESTED',user:{id:'${memberId}',email:'member@example.invalid'},memberEmail:'member@example.invalid',mailOk:true,userError:null};
            function query(table){
              const filters=[];const q={};
              for(const method of ['select','eq','in','is','or']) q[method]=(...args)=>{filters.push({method,args});return q};
              const result=()=>{
                if(table==='submission_payments')return {data:{submission_id:'${submissionId}',status:state.paymentStatus,raw_response:null},error:null};
                if(table==='profiles')return {data:{phone:null},error:null};
                if(table==='paid_submission_notification_events')return {data:[],error:null};
                let rows=(table==='submission_orders'?state.orders:table==='submission_order_items'?state.orderItems:state.rows).filter(row=>filters.every(({method,args:[key,value]})=>method==='eq'||method==='is'?row[key]===value:method==='in'?value.includes(row[key]):method==='or'&&key==='payment_status.is.null,payment_status.eq.UNPAID'?row.payment_status===null||row.payment_status==='UNPAID':true));
                return {data:structuredClone(rows),error:null};
              };
              q.maybeSingle=async()=>{const value=result();return {...value,data:Array.isArray(value.data)?value.data[0]??null:value.data}};
              q.then=(resolve,reject)=>Promise.resolve(result()).then(resolve,reject);
              return q;
            }
            export const client={from:query,auth:{admin:{getUserById:async id=>{calls.push({method:'auth-user',input:{id}});return {data:{user:state.memberEmail?{id,email:state.memberEmail}:null},error:state.userError}}}},rpc:async(name,args)=>{
              calls.push({method:'rpc',input:{name,...args}});
              if(name==='approve_submission_payment_order'){
                const already=state.paymentStatus==='APPROVED';state.paymentStatus='APPROVED';for(const row of state.rows){row.payment_status='PAID';if(!already)row.status='PRE_REVIEW';}
                return {data:[{primary_submission_id:'${submissionId}',submission_ids:state.rows.map(row=>row.id),already_approved:already}],error:null};
              }
              if(name==='begin_submission_bank_payment'){
                for(const row of state.rows)if(args.p_submission_ids.includes(row.id)){row.payment_status='PAYMENT_PENDING';row.payment_method='BANK';row.status='WAITING_PAYMENT';row.current_order_id=state.nextOrderId;}state.orders.push({id:state.nextOrderId,user_id:args.p_user_id,payment_method:'BANK',status:'BANK_PENDING'});state.orderItems.push(...args.p_submission_ids.map(submission_ref=>({order_id:state.nextOrderId,submission_ref})));
                return {data:args.p_submission_ids.map(submission_id=>({submission_id})),error:null};
              }
              throw Error('Unexpected fixture RPC');
            }};`,
          "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>client;`,
          "@/lib/supabase/server": "export const createServerSupabase=async()=>({});",
          "@/lib/supabase/server-user": `${shared} export const getServerSessionUser=async()=>state.user;`,
          "@/lib/email": `${shared} const send=(method,input)=>{calls.push({method,input});return Promise.resolve({ok:state.mailOk,queued:!state.mailOk,status:state.mailOk?'accepted':'retry'});};export const sendSubmissionUpdateEmail=input=>send('payment-email',input);export const sendSubmissionBankRequestEmail=input=>send('bank-email',input);export const sendAdminSubmissionReceiptEmail=input=>send('admin-receipt-email',input);`,
          "@/lib/kakao": `${shared} export const sendKakaoOfficialNotification=async input=>{calls.push({method:'kakao',input});return {ok:true}};`,
          "@/lib/dashboard-status": "export const clearDashboardStatusCache=()=>{};",
          "@/lib/request-rate-limit": "export const consumeRateLimit=()=>({allowed:true});export const getRequestIdentifier=()=> 'fixture';",
          "@/lib/submission-payment-files": "export const validateReleasedAlbumPaymentFiles=async()=>null;",
          "@/lib/submission-payment-stations": "export const validateMvPaymentStations=async()=>null;",
          "@/lib/submission-payment-pricing": "export const validateAlbumPaymentPricing=async()=>null;",
          "@/lib/inicis/stdpay": "export const buildStdPayRequest=()=>{throw Error('Unexpected payment init')};",
          "@/lib/inicis/config": "export const getInicisMode=()=> 'test';export const getStdPayConfig=()=>({});",
          "next/cache": "export const revalidatePath=()=>{};",
        };
        return { contents: modules[path], loader: "js" };
      });
    } }],
  });
  const loaded = { exports: {} as Fixture };
  new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports;
}

const row = (userId: string | null = memberId): Row => ({
  id: submissionId, user_id: userId, guest_token: "legacy-private-guest-token", title: "Fixture title", artist_name: "Fixture artist", type: "MV",
  applicant_email: "third-party@example.invalid", guest_email: "guest@example.invalid", applicant_phone: null, guest_phone: null,
  status: "SUBMITTED", payment_status: "UNPAID", payment_method: "CARD", amount_krw: 1000, current_order_id: null, album_draft_group_id: null,
});
const bankRequest = (guest = false, ids = [submissionId]) => new Request("https://app.example.invalid/api/cart/bank", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://app.example.invalid" },
  body: JSON.stringify({ submissionIds: ids, ...(guest ? { guestTokensBySubmissionId: { [submissionId]: "legacy-private-guest-token" } } : {}) }),
}) as unknown as NextRequest;

test("payment approval retries email registration with the same key and never repeats Kakao or exposes legacy guest credentials to members", async () => {
  const h = await fixture();
  h.state.rows = [row()];
  h.state.mailOk = false;
  assert.equal((await h.markPaymentSuccess("fixture-order", {})).ok, true);
  h.state.mailOk = true;
  assert.equal((await h.markPaymentSuccess("fixture-order", {})).ok, true);
  const emails = h.calls.filter(call => call.method === "payment-email");
  assert.equal(emails.length, 2, "the second callback repairs registration; transport-level dedupe owns SMTP acceptance");
  assert.equal(emails[0].input?.idempotencyKey, emails[1].input?.idempotencyKey);
  assert.equal(emails[0].input?.email, "member@example.invalid");
  assert.equal(emails[0].input?.submissionId, submissionId);
  assert.equal(emails[0].input?.guestToken, undefined);
  assert.doesNotMatch(String(emails[0].input?.link), /track|legacy-private/);
  assert.equal(h.calls.filter(call => call.method === "kakao").length, 1);
  const adminNotices = h.calls.filter(call => call.method === "admin-receipt-email");
  assert.equal(adminNotices.length, 2);
  assert.equal(adminNotices[0].input?.idempotencyKey, `admin-submission-received:${submissionId}`);
  assert.equal(adminNotices[0].input?.idempotencyKey, adminNotices[1].input?.idempotencyKey);
  assert.equal(h.state.rows[0].payment_status, "PAID");
  assert.equal(h.state.rows[0].status, "PRE_REVIEW");
});

test("guest payment email uses the recorded guest mailbox and code while missing member auth email never falls back to an applicant mailbox", async () => {
  const guest = await fixture();
  guest.state.rows = [row(null)];
  assert.equal((await guest.markPaymentSuccess("fixture-order", {})).ok, true);
  const email = guest.calls.find(call => call.method === "payment-email")?.input;
  assert.equal(email?.email, "guest@example.invalid");
  assert.equal(email?.guestToken, "legacy-private-guest-token");
  assert.ok(String(email?.link).endsWith("/track/legacy-private-guest-token"));
  const member = await fixture();
  member.state.rows = [row()];
  member.state.memberEmail = null;
  assert.equal((await member.markPaymentSuccess("fixture-order", {})).ok, true);
  assert.equal(member.calls.some(call => call.method === "payment-email"), false);
  assert.equal(member.calls.filter(call => call.method === "admin-receipt-email").length, 1, "administrator intake notice is independent of customer mailbox lookup");
});

test("bank instructions use one owner mailbox, stable keys, and owner-appropriate links", async () => {
  for (const guest of [false, true]) {
    const h = await fixture();
    h.state.rows = [row(guest ? null : memberId)];
    if (guest) h.state.user = null;
    const response = await h.POST(bankRequest(guest));
    assert.equal(response.status, 200);
    const emails = h.calls.filter(call => call.method === "bank-email");
    assert.equal(emails.length, 1);
    const email = emails[0].input;
    assert.equal(email?.email, guest ? "guest@example.invalid" : "member@example.invalid");
    assert.match(String(email?.idempotencyKey), /^bank-request:/);
    if (guest) assert.ok(String(email?.link).endsWith("/track/legacy-private-guest-token"));
    else assert.doesNotMatch(String(email?.link), /track|legacy-private/);
  }
});

test("payment email template includes escaped submission/code details and omits guest codes for a member payload", async () => {
  const built = await build({
    stdin: { contents: "export {sendSubmissionUpdateEmail} from './src/lib/email';export {messages} from 'template-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "template-infrastructure", setup(plugin) {
      plugin.onResolve({ filter: /^(template-fixture|@\/lib\/email-transport)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "template-fixture" ? "export const messages=[];" : "import {messages} from 'template-fixture';export const sendTransactionalEmail=async input=>{messages.push(input);return {ok:true}};" }));
    } }],
  });
  const loaded = { exports: {} as { sendSubmissionUpdateEmail: (input: Row) => Promise<unknown>; messages: Array<{ html: string }> } };
  new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  const input = { email: "owner@example.invalid", title: "Title<script>", kind: "MV", headline: "Payment", summary: "Paid", submissionId: "sub<&", link: "https://app.example.invalid/track/token" };
  await loaded.exports.sendSubmissionUpdateEmail(input);
  assert.match(loaded.exports.messages[0].html, /접수 번호: sub&lt;&amp;/);
  assert.doesNotMatch(loaded.exports.messages[0].html, /비회원 조회 코드|<script>/);
  await loaded.exports.sendSubmissionUpdateEmail({ ...input, guestToken: "code<&" });
  assert.match(loaded.exports.messages[1].html, /비회원 조회 코드/);
  assert.match(loaded.exports.messages[1].html, /code&lt;&amp;/);
});


test("bank email registration can be repaired without creating another payment order", async () => {
  const h = await fixture();
  h.state.rows = [row()];
  h.state.mailOk = false;
  assert.equal((await h.POST(bankRequest())).status, 200);
  h.state.mailOk = true;
  assert.equal((await h.POST(bankRequest())).status, 200);
  const emails = h.calls.filter(call => call.method === "bank-email");
  assert.equal(emails.length, 2);
  assert.equal(emails[0].input?.idempotencyKey, emails[1].input?.idempotencyKey);
  assert.match(String(emails[0].input?.idempotencyKey), /30000000-0000-4000-8000-000000000001/);
  assert.equal(h.calls.filter(call => call.method === "rpc").length, 1);
  assert.equal(h.state.orders.length, 1);

  // A genuinely new checkout after reopening has a different idempotency key.
  h.state.rows = [row()];
  h.state.nextOrderId = "30000000-0000-4000-8000-000000000002";
  assert.equal((await h.POST(bankRequest())).status, 200);
  const next = h.calls.filter(call => call.method === "bank-email").at(-1)?.input;
  assert.notEqual(next?.idempotencyKey, emails[0].input?.idempotencyKey);
});

test("bank replay rejects partial orders, mixed payment states, and a different payment method before sending", async () => {
  const otherId = "20000000-0000-4000-8000-000000000002";
  for (const scenario of ["partial", "mixed", "card", "closed-order"]) {
    const h = await fixture();
    h.state.rows = [row()];
    assert.equal((await h.POST(bankRequest())).status, 200);
    h.calls.length = 0;
    if (scenario === "partial") h.state.orderItems.push({ order_id: h.state.nextOrderId, submission_ref: otherId });
    if (scenario === "mixed") h.state.rows.push({ ...row(), id: otherId });
    if (scenario === "card") h.state.rows[0].payment_method = "CARD";
    if (scenario === "closed-order") h.state.orders[0].status = "PAID";
    const response = await h.POST(bankRequest(false, scenario === "mixed" ? [submissionId, otherId] : [submissionId]));
    assert.equal(response.status, 409, scenario);
    assert.equal(h.calls.some(call => call.method === "bank-email" || call.method === "rpc"), false, scenario);
  }
});
