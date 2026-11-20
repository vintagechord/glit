import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

// The guest "cart saved" mail carries the lookup link. Anyone holding one guest
// draft could save it back as a draft and submit it again with another address,
// mailing any inbox in a loop from Onside's sender. The mail must go out once
// per submission, under shared per-address and per-recipient limits, and a
// mail that is refused must never fail the save.

type SaveResult = { error?: string; submissionId?: string };
type Fixture = {
  saveAlbumSubmissionAction: (payload: Record<string, unknown>) => Promise<SaveResult>;
  saveMvSubmissionAction: (payload: Record<string, unknown>) => Promise<SaveResult>;
  state: {
    status: string;
    events: Array<{ event_type: string }>;
    mails: Array<{ email: string }>;
    limits: Array<{ namespace: string; identifier: string; limit: number; windowMs: number }>;
    deny: string[];
    eventReadFails: boolean;
  };
};

const submissionId = "6f1d4a2e-3b5c-4d7e-8f90-a1b2c3d4e5f6";
const guestToken = "5a7c9e1b-2d4f-4a6c-8e0b-1d3f5a7c9e1b";
const packageId = "0c2e4a6b-8d0f-4b2d-9f4a-6c8e0a2c4e6b";
const stationId = "1d3f5b7c-9e1a-4c3e-8a5b-7d9f1b3d5f7a";

// A guest row the save can edit, a package with one active station, and a
// submission_events table the action writes to and reads back.
const adminClient = `
const row=()=>({id:'${submissionId}',user_id:null,guest_token:'${guestToken}',status:state.status,payment_status:'UNPAID',current_order_id:null,updated_at:state.updatedAt,package_id:null,amount_krw:0,album_base_price_krw:null,album_price_tier:null,is_oneclick:false,archive_review_context:null});
const answer=q=>{
  if(q.table==='submission_events'){
    if(q.op==='insert'){state.events.push(q.values);return {data:null,error:null};}
    if(state.eventReadFails)return {data:null,count:null,error:{message:'unavailable'}};
    const rows=state.events.filter(event=>q.filters.every(([method,column,value])=>method!=='eq'||event[column]===value));
    return {data:q.head?null:rows,count:rows.length,error:null};
  }
  if(q.table==='submissions')return {data:row(),error:null};
  if(q.table==='packages')return {data:{price_krw:100000,station_count:1},error:null};
  if(q.table==='package_stations')return {data:[{station_id:'${stationId}'}],error:null};
  if(q.table==='stations')return {data:q.filters.some(([method,column])=>method==='in'&&column==='code')?[]:[{id:'${stationId}'}],error:null};
  return {data:[],error:null};
};
const query=table=>{
  const q={table,op:'select',filters:[],head:false};
  const builder=new Proxy({},{get(_,prop){
    if(prop==='then')return (resolve,reject)=>Promise.resolve(answer(q)).then(resolve,reject);
    if(prop==='maybeSingle'||prop==='single')return async()=>answer(q);
    return (...args)=>{
      if(['insert','update','upsert','delete'].includes(prop)){q.op=prop;q.values=args[0];}
      else if(prop==='select'){q.head=Boolean(args[1]&&args[1].head);}
      else q.filters.push([prop,...args]);
      return builder;
    };
  }});
  return builder;
};
export const createAdminClient=()=>({from:query,rpc:async(name,args)=>{
  if(name==='claim_submission_save_lease_v2')return {data:[{lease_token:args.p_lease_token,staged_updated_at:state.updatedAt}],error:null};
  if(name==='commit_submission_save_v2'){state.status=args.p_final_status;state.updatedAt=new Date(Date.parse(state.updatedAt)+1000).toISOString();return {data:[{submission_id:args.p_submission_id}],error:null};}
  return {data:null,error:null};
}});`;

async function fixture(): Promise<Fixture> {
  const result = await build({
    stdin: { contents: "export {saveAlbumSubmissionAction,saveMvSubmissionAction} from './src/features/submissions/actions'; export {state} from 'cart-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false, logLevel: "silent",
    plugins: [{ name: "cart-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(cart-fixture|@\/lib\/(?:supabase\/(?:server|admin)|email|request-rate-limit|public-catalog|music-archive\/(?:review-entry|service)|admin\/released-album-hydration|kakao|submission-file-cleanup|dashboard-status|artist|b2)|next\/(?:headers|server))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state} from 'cart-fixture';";
        const modules: Record<string, string> = {
          "cart-fixture": "export const state={status:'DRAFT',updatedAt:'2026-11-21T00:00:00.000Z',events:[],mails:[],limits:[],deny:[],eventReadFails:false};",
          // What supabase-js really answers for a visitor without auth cookies.
          "@/lib/supabase/server": "import {AuthSessionMissingError} from '@supabase/supabase-js'; export const createServerSupabase=async()=>({auth:{getUser:async()=>({data:{user:null},error:new AuthSessionMissingError()})}});",
          "@/lib/supabase/admin": `${shared} ${adminClient}`,
          "@/lib/email": `${shared} const record=async payload=>{state.mails.push(payload);return {ok:true};}; export const sendSubmissionUpdateEmail=record; export const sendSubmissionReceiptEmail=record; export const sendOrderBankTransferEmail=record;`,
          "@/lib/request-rate-limit": `${shared} export const consumePersistentRateLimit=async input=>{state.limits.push(input);const allowed=!state.deny.includes(input.namespace);return {allowed,remaining:allowed?1:0,retryAfterSeconds:allowed?0:60,resetAt:0};}; export const consumeRateLimit=()=>({allowed:true,remaining:1,retryAfterSeconds:0,resetAt:0}); export const getRequestIdentifier=headers=>headers.get('x-real-ip')||'unknown';`,
          "@/lib/public-catalog": "export const getPublicProfanityTerms=async()=>[];",
          "@/lib/music-archive/review-entry": "import {z} from 'zod'; export const archiveReviewContextSchema=z.object({libraryId:z.string(),releaseId:z.string(),trackId:z.string().optional()}); export const storedArchiveReviewContextSchema=archiveReviewContextSchema.extend({trackIds:z.array(z.string()).optional()}); export const getArchiveReviewEntry=async()=>{throw new Error('not used');};",
          "@/lib/music-archive/service": "export const linkArchiveSubmission=async()=>{};",
          "@/lib/admin/released-album-hydration": "export const scheduleReleasedAlbumHydration=()=>{};",
          "@/lib/kakao": "export const sendKakaoOfficialNotification=async()=>({ok:true,skipped:true});",
          "@/lib/submission-file-cleanup": "export const cleanupUnreferencedSubmissionB2Objects=async()=>{}; export const loadSubmissionB2ObjectRefs=async()=>[];",
          "@/lib/dashboard-status": "export const clearDashboardStatusCache=()=>{};",
          "@/lib/artist": "export const ensureArtistByName=async()=>null;",
          "@/lib/b2": "export class B2ConfigError extends Error {}; export const getB2Config=()=>({prefix:'submissions/'});",
          "next/headers": "export const headers=async()=>new Headers({'x-real-ip':'198.51.100.7'}); export const cookies=async()=>({getAll:()=>[],set(){}});",
          "next/server": "export const after=()=>{};",
        };
        return { contents: modules[path], loader: "js", resolveDir: process.cwd() };
      });
    } }],
  });
  const bundled = { exports: {} as Fixture };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  return bundled.exports;
}

// The lightest cart save: the downloaded application form, files sent by email.
const albumCart = (guestEmail: string, status = "SUBMITTED") => ({
  submissionId, guestToken, status, packageId,
  applicationFormMode: "upload", filesSubmittedByEmail: true, aiUsed: false,
  title: "앨범", artistName: "아티스트", guestName: "홍길동", guestEmail, guestPhone: "010-0000-0000",
});
const mvCart = (guestEmail: string, status = "SUBMITTED") => ({
  submissionId, guestToken, status, mvType: "MV_DISTRIBUTION",
  applicationFormMode: "upload", filesSubmittedByEmail: true, aiUsed: false,
  title: "뮤직비디오", artistName: "아티스트", guestName: "홍길동", guestEmail,
});

for (const [kind, save, payload] of [
  ["album", "saveAlbumSubmissionAction", albumCart],
  ["music video", "saveMvSubmissionAction", mvCart],
] as const) {
  test(`a guest ${kind} sends the lookup mail once, however often it moves between draft and cart`, async () => {
    const cart = await fixture();
    const first = await cart[save](payload("first@example.invalid"));
    assert.equal(first.error, undefined);
    assert.equal(first.submissionId, submissionId);
    assert.equal(cart.state.status, "SUBMITTED");
    assert.deepEqual(cart.state.mails.map(mail => mail.email), ["first@example.invalid"]);
    for (const address of ["victim1@example.invalid", "victim2@example.invalid"]) {
      assert.equal((await cart[save](payload(address, "DRAFT"))).error, undefined);
      assert.equal(cart.state.status, "DRAFT");
      assert.equal((await cart[save](payload(address))).error, undefined);
      assert.equal(cart.state.status, "SUBMITTED");
    }
    assert.deepEqual(cart.state.mails.map(mail => mail.email), ["first@example.invalid"]);
    // Only the one mail that went out spent the shared limits.
    assert.equal(cart.state.limits.length, 3);
  });
}

test("the lookup mail passes shared per-address and per-recipient limits, and a refused mail keeps the save", async () => {
  const cart = await fixture();
  await cart.saveAlbumSubmissionAction(albumCart("Guest@Example.invalid"));
  assert.deepEqual(cart.state.limits.map(limit => [limit.namespace, limit.identifier]), [
    ["guest-cart-email-ip", "198.51.100.7"],
    ["guest-cart-email-ip-day", "198.51.100.7"],
    ["guest-cart-email-to", "guest@example.invalid"],
  ]);
  assert.equal(cart.state.mails.length, 1);
  for (const namespace of ["guest-cart-email-ip", "guest-cart-email-ip-day", "guest-cart-email-to"]) {
    for (const [save, payload] of [["saveAlbumSubmissionAction", albumCart], ["saveMvSubmissionAction", mvCart]] as const) {
      const limited = await fixture();
      limited.state.deny = [namespace];
      const saved = await limited[save](payload("guest@example.invalid"));
      assert.equal(saved.error, undefined, `${namespace} must not fail the ${save} save`);
      assert.equal(saved.submissionId, submissionId);
      assert.equal(limited.state.status, "SUBMITTED");
      assert.equal(limited.state.mails.length, 0, `${namespace} must stop the ${save} mail`);
    }
  }
});

test("when the cart history cannot be read, the mail is skipped and the save still stands", async () => {
  const cart = await fixture();
  cart.state.eventReadFails = true;
  const saved = await cart.saveAlbumSubmissionAction(albumCart("guest@example.invalid"));
  assert.equal(saved.error, undefined);
  assert.equal(cart.state.status, "SUBMITTED");
  assert.equal(cart.state.mails.length, 0);
  assert.equal(cart.state.limits.length, 0);
});
