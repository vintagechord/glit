import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { customerPaymentFeedback } from "../src/lib/customer-payment-feedback";
import type { ReactElement, ReactNode } from "react";

async function fixture() {
  const bundle=await build({stdin:{contents:`export {TrackPageView} from './src/features/track/track-page-view';export {POST} from './src/app/api/track/validate/route';export {AlbumSubmissionPageView} from './src/app/dashboard/new/album/view';export {state,calls} from 'journey-fixture';`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,
    plugins:[{name:'journey-fixture',setup(p){
      p.onResolve({filter:/^(journey-fixture|next\/(navigation|link)|@\/lib\/(supabase\/(admin|server|server-user)|public-catalog|music-archive\/review-entry|request-rate-limit)|@\/features\/(track\/(track-lookup-form|track-lookup-selector)|submissions\/(album-wizard|album-intro-panel)))$/},args=>({path:args.path,namespace:'fixture'}));
      p.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'tsx',contents:({
        'journey-fixture':`export const state={user:null,profile:null,lookupError:null,lookupMatch:null,archiveEntry:null};export const calls=[];`,
        'next/navigation':`export const redirect=url=>{throw new Error('redirect:'+url)};`,
        'next/link':`export default function Link(props){return props.children};`,
        '@/features/track/track-lookup-form':`export const TrackLookupForm=()=>null;`,
        '@/features/track/track-lookup-selector':`export const TrackLookupSelector=()=>null;`,
        '@/features/submissions/album-wizard':`export const AlbumWizard=()=>null;`,
        '@/features/submissions/album-intro-panel':`export const AlbumIntroPanel=()=>null;`,
        '@/lib/supabase/server':`import {state,calls} from 'journey-fixture';export const createServerSupabase=async()=>({auth:{getUser:async()=>({data:{user:state.user}})},from(table){if(table!=='profiles')throw Error('Unexpected profile table');const q={select(fields){calls.push(['profile-select',fields]);return q},eq(key,value){if(key!=='user_id'||value!==state.user?.id)throw Error('Wrong profile owner');calls.push(['profile-owner',value]);return q},async maybeSingle(){return {data:state.profile,error:null}}};return q;}});`,
        '@/lib/supabase/server-user':`import {state} from 'journey-fixture';export const getServerSessionUser=async()=>state.user;`,
        '@/lib/public-catalog':`export const getPublicAlbumCatalog=async()=>({packages:[],albumDiscountPercent:0,profanityTerms:[]});`,
        '@/lib/music-archive/review-entry':`import {state} from 'journey-fixture';export const getArchiveReviewEntry=async()=>{if(state.archiveEntry)return state.archiveEntry;throw Error('Fixture unavailable')};`,
        '@/lib/request-rate-limit':`export const consumeRateLimit=()=>({allowed:true});export const getRequestIdentifier=()=> 'fixture';`,
        '@/lib/supabase/admin':`import {state,calls} from 'journey-fixture';export const createAdminClient=()=>({from(table){calls.push(table);const q={select(){return q},is(k,v){calls.push([k,v]);return q},eq(k,v){calls.push([k,v]);return q},async maybeSingle(){return {data:state.lookupMatch,error:state.lookupError}}};return q;}});`,
      } as Record<string,string>)[path]}));
    }}]});
  const mod={exports:{} as {TrackPageView:typeof import('../src/features/track/track-page-view').TrackPageView;AlbumSubmissionPageView:typeof import('../src/app/dashboard/new/album/view').AlbumSubmissionPageView;POST:(request:Request)=>Promise<Response>;state:{user:null|{id:string;email?:string|null;identities?:{provider:string}[];user_metadata?:Record<string,unknown>};profile:null|{name?:string|null;phone?:string|null;notification_email?:string|null};archiveEntry:unknown;lookupError:unknown;lookupMatch:unknown};calls:unknown[]}};
  new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);return mod.exports;
}

test('payment banners reflect stored payment status instead of a stale or edited return URL',()=>{
  assert.equal(customerPaymentFeedback('success','UNPAID'),'checking');
  assert.equal(customerPaymentFeedback('success','PAYMENT_PENDING'),'checking');
  assert.equal(customerPaymentFeedback('cancel','PAID'),'paid');
  assert.equal(customerPaymentFeedback('fail','PAID'),'paid');
  assert.equal(customerPaymentFeedback('success','REFUNDED'),'refunded');
  assert.equal(customerPaymentFeedback('error','UNPAID'),'failed');
  assert.equal(customerPaymentFeedback(undefined,'PAID'),null);
});

function applicantDefaults(tree: ReactNode): unknown {
  if (Array.isArray(tree)) {
    for (const child of tree) { const value = applicantDefaults(child); if (value !== null) return value; }
    return null;
  }
  if (!tree || typeof tree !== "object" || !("props" in tree)) return null;
  const props = (tree as ReactElement<Record<string, unknown>>).props;
  return "initialApplicant" in props ? props.initialApplicant : applicantDefaults(props.children as ReactNode);
}

test('normal and archive album applications default to the signed-in member profile', async () => {
  const h = await fixture();
  h.state.user = { id: 'member-one', email: 'member@example.invalid' };
  h.state.profile = { name: '회원 이름', phone: '01012345678', notification_email: 'ignored@example.invalid' };
  const expected = { name: '회원 이름', email: 'member@example.invalid', phone: '01012345678' };
  assert.deepEqual(applicantDefaults(await h.AlbumSubmissionPageView({})), expected);
  h.state.archiveEntry = { title: '이미 불러온 앨범' };
  assert.deepEqual(applicantDefaults(await h.AlbumSubmissionPageView({ searchParams: Promise.resolve({ archiveLibrary: 'library', archiveRelease: 'release' }) })), expected);
  assert.ok(h.calls.some(call => Array.isArray(call) && call[0] === 'profile-owner' && call[1] === 'member-one'));
});

test('social member defaults use their saved notification address and leave absent information empty', async () => {
  const h = await fixture();
  for (const provider of ['kakao', 'custom:naver']) {
    h.state.user = { id: 'member-one', email: null, identities: [{ provider }] };
    h.state.profile = { name: '회원 이름', notification_email: 'saved@example.invalid' };
    assert.deepEqual(applicantDefaults(await h.AlbumSubmissionPageView({})), { name: '회원 이름', email: 'saved@example.invalid', phone: '' });
  }
  h.state.profile = null;
  assert.deepEqual(applicantDefaults(await h.AlbumSubmissionPageView({})), { name: '', email: '', phone: '' });
});

test('guest album applications never read a member profile or receive member defaults', async () => {
  const h = await fixture();
  h.state.profile = { name: '다른 회원', notification_email: 'private@example.invalid' };
  assert.equal(applicantDefaults(await h.AlbumSubmissionPageView({})), undefined);
  assert.deepEqual(h.calls, []);
});

test('signup contact details fill missing profiles while saved profile choices take priority', async () => {
  const h = await fixture();
  h.state.user = { id: 'member-one', email: 'member@example.invalid', user_metadata: { full_name: '가입 이름', phone: '01011112222' } };
  assert.deepEqual(applicantDefaults(await h.AlbumSubmissionPageView({})), { name: '가입 이름', email: 'member@example.invalid', phone: '01011112222' });
  h.state.profile = { name: '수정 이름', phone: '01033334444' };
  assert.deepEqual(applicantDefaults(await h.AlbumSubmissionPageView({})), { name: '수정 이름', email: 'member@example.invalid', phone: '01033334444' });
  h.state.profile = { name: '', phone: '' };
  assert.deepEqual(applicantDefaults(await h.AlbumSubmissionPageView({})), { name: '', email: 'member@example.invalid', phone: '' });
});

test('signed-in customers may explicitly look up older guest applications',async()=>{
  const h=await fixture();h.state.user={id:'fixture-member'};
  await assert.rejects(h.TrackPageView({dashboardPath:'/en/dashboard'}),/redirect:\/en\/dashboard/);
  const page=await h.TrackPageView({dashboardPath:'/en/dashboard',searchParams:Promise.resolve({mode:'guest'})});
  assert.ok(page);
});

test('guest lookup preserves opaque invalid-code responses but reports service outages separately',async()=>{
  const h=await fixture();const request=()=>new Request('https://fixture.invalid/api/track/validate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'synthetic-guest-token'})});
  let response=await h.POST(request());assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:false});
  h.state.lookupError={message:'private database diagnostics'};
  response=await h.POST(request());assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false});
  assert.ok(h.calls.some(call=>Array.isArray(call)&&call[0]==='user_id'&&call[1]===null));
  h.state.lookupError=null;h.state.lookupMatch={id:'fixture'};
  response=await h.POST(request());assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
});

test('archive album entry preserves English through sign-in and retry destinations',async()=>{
  const h=await fixture();
  const searchParams=Promise.resolve({archiveLibrary:'library-fixture',archiveRelease:'release-fixture'});
  await assert.rejects(h.AlbumSubmissionPageView({localePrefix:'/en',searchParams}),error=>error instanceof Error&&error.message.startsWith('redirect:/en/login?next=')&&decodeURIComponent(error.message).includes('/en/dashboard/new/album?archiveLibrary=library-fixture'));
  h.state.user={id:'fixture'};
  const tree=await h.AlbumSubmissionPageView({localePrefix:'/en',searchParams});
  assert.match(JSON.stringify(tree),/\/en\/mypage\/music/);
});
