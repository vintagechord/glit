import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { multipartCompletionManifest } from "../src/lib/multipart-upload-completion";

const fixture = `
export const id='11111111-1111-4111-8111-111111111111';
export const calls=[];
export const state={};
export function reset(){
  calls.length=0;
  Object.assign(state,{
    bytes:new TextEncoder().encode('RIFF1234WAVEdata'),object:false,headError:false,ownerError:null,
    completeFailure:null,stageFailure:null,markFailure:null,receiptReadFailure:false,stageBarrier:null,
    stage:null,live:null,partCount:2,
    grant:{id,submission_id:id,owner_key:'user:fixture-owner',upload_id:'fixture-upload',object_key:'submissions/fixture/test.wav',
      original_name:'test.wav',mime_type:'audio/wav',upload_kind:'audio',declared_size_bytes:16,
      status:'ACTIVE',expires_at:new Date(Date.now()+60000).toISOString(),completion_manifest_hash:null}
  });
}
reset();
export const client={send:async command=>{
  calls.push({name:command.constructor.name});
  if(command.constructor.name==='HeadObjectCommand'){
    if(state.headError)throw new Error('HEAD transport failure');
    if(!state.object)throw Object.assign(new Error('missing'),{name:'NotFound'});
    return {ContentLength:state.bytes.length,ETag:'provider-final-etag'};
  }
  return {ContentLength:state.bytes.length,Body:{transformToWebStream:()=>new ReadableStream({start(controller){controller.enqueue(state.bytes);controller.close()}})}};
}};
export function match(grant,expected){return grant.submission_id===expected.submissionId&&grant.owner_key===expected.ownerKey&&grant.upload_id===expected.uploadId&&grant.object_key===expected.objectKey}
export async function claim(args){
  calls.push({name:'claim',args});
  const g=state.grant;
  const error=(message,code='55000')=>({data:null,error:{message,code}});
  if(!match(g,{submissionId:args.p_submission_id,ownerKey:args.p_owner_key,uploadId:args.p_upload_id,objectKey:args.p_object_key}))return error('MULTIPART_GRANT_MISMATCH','42501');
  if(new Date(g.expires_at).getTime()<=Date.now())return error('MULTIPART_GRANT_EXPIRED','57014');
  if(args.p_part_numbers.length!==state.partCount||new Set(args.p_part_numbers).size!==state.partCount||args.p_part_numbers.some(p=>p<1||p>state.partCount))return error('MULTIPART_PARTS_MISMATCH','22023');
  if(g.status==='ACTIVE'){g.status='COMPLETING';g.completion_manifest_hash=args.p_manifest_hash;return {data:'START',error:null}}
  if(!['COMPLETING','COMPLETED'].includes(g.status))return error('MULTIPART_GRANT_NOT_ACTIVE');
  if(!g.completion_manifest_hash||g.completion_manifest_hash!==args.p_manifest_hash)return error('MULTIPART_MANIFEST_MISMATCH');
  return {data:g.status,error:null};
}
export function from(table){
  let payload=null,options=null;
  const chain={select(){return chain},eq(){return chain},upsert(value,opts){payload=value;options=opts;return chain},async maybeSingle(){
    if(payload){
      calls.push({name:'stage-attempt',options,payload});
      if(state.stageBarrier)await state.stageBarrier();
      const failure=state.stageFailure;state.stageFailure=null;
      if(failure==='before')return {data:null,error:{message:'database unavailable'}};
      if(failure==='payment-race')return {data:null,error:{message:'SUBMISSION_FILE_PAID'}};
      if(state.stage){if(!options?.ignoreDuplicates)state.stage={...state.stage,...payload};return {data:null,error:null}}
      state.stage={id:'fixture-staging-id',...payload};calls.push({name:'stage-insert',payload});
      return failure==='after'?{data:null,error:{message:'response lost'}}:{data:{id:state.stage.id},error:null};
    }
    calls.push({name:'receipt-read',table});
    if(state.receiptReadFailure)return {data:null,error:{message:'read unavailable'}};
    return {data:table==='submission_files'?state.live:state.stage,error:null};
  }};
  return chain;
}
`;

type Receipt = { id: string; original_name: string; mime: string; size: number; storage_provider: string; status: string; uploaded_at: string };
type Fixture = {
  POST: (request: Request) => Promise<Response>;
  reset: () => void;
  state: {
    bytes: Uint8Array; object: boolean; headError: boolean; ownerError: string | null;
    completeFailure: string | null; stageFailure: string | null; markFailure: string | null;
    receiptReadFailure: boolean; stageBarrier: (() => Promise<void>) | null;
    stage: Receipt | null; live: Receipt | null;
    grant: { status: string; expires_at: string; completion_manifest_hash: string | null; original_name: string; mime_type: string; upload_kind: string; declared_size_bytes: number; owner_key: string };
  };
  calls: Array<{name: string; options?: {ignoreDuplicates?: boolean}; args?: {p_manifest_hash: string}}>;
};

async function handlerFixture(): Promise<Fixture> {
  const modules: Record<string, string> = {
    "multipart-fixture": fixture,
    "@/lib/b2": `import {state,calls,client} from 'multipart-fixture';export class B2ConfigError extends Error{};export const getB2Config=()=>({client,bucket:'fixture'});export const presignGetUrl=async()=> 'https://fixture.invalid/download';export async function completeMultipartUpload(){calls.push({name:'provider-complete'});const failure=state.completeFailure;state.completeFailure=null;if(failure==='before')throw new Error('connection reset before commit');state.object=true;if(failure==='after')throw new Error('response lost after commit')}`,
    "@/lib/payments/submission": `import {state} from 'multipart-fixture';export const ensureSubmissionOwner=async()=>({user:{id:'fixture-owner'},submission:{user_id:'fixture-owner',status:'DRAFT',payment_status:'UNPAID',current_order_id:null},error:state.ownerError});`,
    "@/lib/request-rate-limit": `export const consumeRateLimit=()=>({allowed:true});export const getRequestIdentifier=()=> 'fixture';`,
    "@/lib/supabase/admin": `import {claim,from} from 'multipart-fixture';export const createAdminClient=()=>({rpc:async(name,args)=>{if(name!=='claim_multipart_upload_completion')throw new Error('wrong RPC');return claim(args)},from});`,
    "@/lib/multipart-upload-grants": `import {state,calls,match} from 'multipart-fixture';export const getMultipartOwnerKey=()=> 'user:fixture-owner';export const getMultipartGrant=async()=>({...state.grant});export const multipartGrantMatches=match;export const abortExpiredMultipartGrant=async()=>{calls.push({name:'abort'});state.grant.status='ABORTED'};export const markMultipartGrantFailed=async()=>{calls.push({name:'failed'});if(state.grant.status==='COMPLETING')state.grant.status='FAILED'};export async function markMultipartGrantCompleted(){calls.push({name:'completed'});const failure=state.markFailure;state.markFailure=null;if(failure==='before')throw new Error('mark failed before commit');if(state.grant.status==='COMPLETED')throw new Error('another request committed');state.grant.status='COMPLETED';if(failure==='after')throw new Error('mark response lost')}`,
  };
  const bundle = await build({ stdin: { contents: "export {POST} from './src/app/api/uploads/multipart/complete/route'; export {state,calls,reset} from 'multipart-fixture';", resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "multipart-completion-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(multipart-fixture|@\/lib\/(?:b2|supabase\/admin|payments\/submission|multipart-upload-grants|request-rate-limit))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: modules[path] }));
    } }],
  });
  const output = {exports:{} as Fixture};
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}

const id = "11111111-1111-4111-8111-111111111111";
const parts = [{partNumber:1,etag:"fixture-etag-one"},{partNumber:2,etag:"fixture-etag-two"}];
const request = (api: Fixture, override: Record<string, unknown> = {}) => new Request("https://fixture.invalid/api/uploads/multipart/complete", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({grantId:id,submissionId:id,key:"submissions/fixture/test.wav",uploadId:"fixture-upload",parts,filename:api.state.grant.original_name,mimeType:api.state.grant.mime_type,sizeBytes:api.state.grant.declared_size_bytes,kind:api.state.grant.upload_kind,...override})});

test("completion manifests bind exact ETags and part numbers independent of array order", () => {
  assert.equal(multipartCompletionManifest(parts),multipartCompletionManifest([...parts].reverse()));
  assert.notEqual(multipartCompletionManifest(parts),multipartCompletionManifest([{...parts[0],etag:"tampered-etag"},parts[1]]));
});

test("actual multipart handler validates WAV/MP4 before staging and replays a lost successful HTTP response", async () => {
  const api=await handlerFixture();
  for(const [filename,mime,kind,bytes] of [["test.wav","audio/wav","audio","RIFF1234WAVEdata"],["test.mp4","video/mp4","video","0000ftypisom"]]){
    api.reset();api.state.bytes=new TextEncoder().encode(bytes);Object.assign(api.state.grant,{original_name:filename,mime_type:mime,upload_kind:kind,declared_size_bytes:api.state.bytes.length});
    const first=await api.POST(request(api));assert.equal(first.status,200);const body=await first.json();
    assert.deepEqual(body.verification,{size:true,signature:"matched",codec:"not_checked",contents:"not_checked"});
    assert.equal(api.state.grant.status,"COMPLETED");assert.ok(api.state.stage);
    const receipt=structuredClone(api.state.stage);const writes=api.calls.filter(call=>call.name==='stage-attempt').length;
    // The caller never observed the first HTTP success. Same payload must use
    // the real object and saved metadata rather than calling B2 completion again.
    const replay=await api.POST(request(api,{parts:[...parts].reverse()}));assert.equal(replay.status,200);
    assert.equal(api.calls.filter(call=>call.name==='provider-complete').length,1);
    assert.equal(api.calls.filter(call=>call.name==='stage-attempt').length,writes);
    assert.deepEqual(api.state.stage,receipt);
  }
});

test("provider and database response losses preserve bytes/receipt and converge on an identical retry", async () => {
  const api=await handlerFixture();
  for(const failure of ['provider-after','provider-before','stage-after','stage-before','mark-after','mark-before']){
    api.reset();api.state.grant.declared_size_bytes=api.state.bytes.length;
    if(failure.startsWith('provider'))api.state.completeFailure=failure.slice(9);
    if(failure.startsWith('stage'))api.state.stageFailure=failure.slice(6);
    if(failure.startsWith('mark'))api.state.markFailure=failure.slice(5);
    const first=await api.POST(request(api));
    const immediateSuccess=['provider-after','mark-after'].includes(failure);
    assert.equal(first.status,immediateSuccess?200:503,failure);
    if(failure==='provider-before')assert.equal(api.state.object,false);
    else assert.equal(api.state.object,true,failure);
    if(!immediateSuccess)assert.equal(api.state.grant.status,'COMPLETING',failure);
    if(failure==='stage-after'||failure==='mark-before')assert.ok(api.state.stage,failure);
    const retry=await api.POST(request(api));assert.equal(retry.status,200,failure);
    assert.equal(api.state.grant.status,'COMPLETED');assert.ok(api.state.stage);
    assert.equal(api.calls.filter(call=>call.name==='stage-insert').length,1,failure);
    assert.equal(api.calls.some(call=>['delete','abort','failed'].includes(call.name)),false,failure);
  }
});

test("simultaneous identical completion preserves the first receipt timestamp and both requests converge", async () => {
  const api=await handlerFixture();api.state.grant.declared_size_bytes=api.state.bytes.length;
  let arriving=0;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});
  api.state.stageBarrier=async()=>{arriving++;if(arriving===2)release();await gate};
  const [one,two]=await Promise.all([api.POST(request(api)),api.POST(request(api))]);
  assert.equal(one.status,200);assert.equal(two.status,200);
  assert.equal(api.calls.filter(call=>call.name==='stage-attempt').length,2);
  assert.ok(api.calls.filter(call=>call.name==='stage-attempt').every(call=>call.options?.ignoreDuplicates===true));
  assert.equal(api.calls.filter(call=>call.name==='stage-insert').length,1);
  const firstTimestamp=api.state.stage?.uploaded_at;assert.ok(firstTimestamp);
  const retry=await api.POST(request(api));assert.equal(retry.status,200);assert.equal(api.state.stage?.uploaded_at,firstTimestamp);
});

test("completed retries still require live bytes, verified metadata and a current receipt", async () => {
  const api=await handlerFixture();
  for(const failure of ['missing-object','missing-receipt','tampered-receipt','read-failure','bad-signature','wrong-size']){
    api.reset();api.state.grant.declared_size_bytes=api.state.bytes.length;
    assert.equal((await api.POST(request(api))).status,200);
    if(failure==='missing-object')api.state.object=false;
    if(failure==='missing-receipt')api.state.stage=null;
    if(failure==='tampered-receipt')api.state.stage!.original_name='changed.wav';
    if(failure==='read-failure')api.state.receiptReadFailure=true;
    if(failure==='bad-signature')api.state.bytes=new TextEncoder().encode('PDFX1234FAKEdata');
    if(failure==='wrong-size')api.state.bytes=new Uint8Array(2);
    const status=(await api.POST(request(api))).status;
    assert.equal(status,['missing-object','read-failure'].includes(failure)?503:failure==='bad-signature'||failure==='wrong-size'?400:409,failure);
    assert.equal(api.calls.filter(call=>call.name==='provider-complete').length,1,failure);
    assert.equal(api.calls.filter(call=>call.name==='stage-insert').length,1,failure);
    assert.equal(api.state.grant.status,'COMPLETED',failure);
  }
});

test("a payment race at provisional metadata insert remains a conflict without deleting completed bytes", async () => {
  const api=await handlerFixture();api.state.grant.declared_size_bytes=api.state.bytes.length;api.state.stageFailure='payment-race';
  const response=await api.POST(request(api));assert.equal(response.status,409);
  assert.match((await response.json()).error,/결제가 완료/);
  assert.equal(api.state.object,true);assert.equal(api.state.stage,null);assert.equal(api.state.grant.status,'COMPLETING');
});

test("tampered manifests/metadata, expired grants and other owners cannot finalize or replay", async () => {
  const api=await handlerFixture();
  for(const failure of ['changed-etag','partial-parts','bad-metadata','owner','expired','aborted','legacy-hashless']){
    api.reset();api.state.grant.declared_size_bytes=api.state.bytes.length;
    const override:Record<string,unknown>={};
    let expected=409;
    if(failure==='changed-etag'){assert.equal((await api.POST(request(api))).status,200);override.parts=[{...parts[0],etag:'tampered-etag'},parts[1]]}
    if(failure==='partial-parts'){override.parts=[parts[0]];expected=400}
    if(failure==='bad-metadata'){override.filename='tampered.wav';expected=400}
    if(failure==='owner'){api.state.ownerError='FORBIDDEN';expected=403}
    if(failure==='expired'){api.state.grant.expires_at=new Date(Date.now()-1).toISOString();expected=410}
    if(failure==='aborted')api.state.grant.status='ABORTED';
    if(failure==='legacy-hashless')api.state.grant.status='COMPLETED';
    const before=api.calls.filter(call=>call.name==='provider-complete').length;
    assert.equal((await api.POST(request(api,override))).status,expected,failure);
    assert.equal(api.calls.filter(call=>call.name==='provider-complete').length,before,failure);
  }
});
