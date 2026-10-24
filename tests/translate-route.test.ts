import assert from "node:assert/strict";
import {createRequire} from "node:module";
import test from "node:test";
import {build} from "esbuild";

type Fixture={POST:(request:Request)=>Promise<Response>;state:{result:string[];failure:Error|null;allowed:boolean;onTranslate:(()=>void)|null};calls:Array<{lines:string[];options:{context?:string;signal:AbortSignal}}>};
async function fixture():Promise<Fixture>{
  const result=await build({stdin:{resolveDir:process.cwd(),loader:"ts",contents:"export {POST} from './src/app/api/translate/route';export {state,calls} from 'translate-fixture';"},bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"translate-route-fixture",setup(plugin){
    plugin.onResolve({filter:/^(translate-fixture|@\/lib\/(?:server-lyrics-translation|request-rate-limit))$/},args=>({path:args.path,namespace:"fixture"}));
    plugin.onLoad({filter:/.*/,namespace:"fixture"},({path})=>({loader:"js",contents:path==='translate-fixture'?`export const state={result:[],failure:null,allowed:true,onTranslate:null};export const calls=[];`:path==='@/lib/server-lyrics-translation'?`import {state,calls} from 'translate-fixture';export async function translateLyricsBatch(lines,options){calls.push({lines,options});state.onTranslate?.();if(state.failure)throw state.failure;return state.result}`:`import {state} from 'translate-fixture';export const consumeRateLimit=()=>({allowed:state.allowed,retryAfterSeconds:60});export const getRequestIdentifier=()=> 'fixture';`}));
  }}]});
  const output={exports:{} as Fixture};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),output,output.exports);return output.exports;
}
const request=(body:unknown,signal?:AbortSignal)=>new Request('https://fixture.invalid/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});

test('actual translation API rejects invalid/oversized inputs before the provider instead of coercing or clipping them',async()=>{
  const api=await fixture();
  for(const [body,status] of [
    [{lines:[{secret:'fixture'}]},400],[{lines:[null]},400],[{lines:'wrong'},400],
    [{lines:Array(121).fill('source')},413],[{lines:['A'.repeat(5001)]},413],
    [{lines:Array(20).fill('A'.repeat(4000))},413],[{lines:['source'],context:'A'.repeat(12001)},413],
  ] as const){assert.equal((await api.POST(request(body))).status,status)}
  assert.equal(api.calls.length,0);assert.deepEqual(await (await api.POST(request({lines:[]}))).json(),{translations:[]});
  api.state.allowed=false;const limited=await api.POST(request({lines:['source']}));assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'60');assert.equal(api.calls.length,0);
});

test('actual translation API preserves aligned partials and rejects unchanged, extra or euphemized results',async()=>{
  const api=await fixture();api.state.result=['사랑해','Stay with me',''];
  let response=await api.POST(request({lines:['I love you','Stay with me',''],context:'한글 맥락'}));assert.equal(response.status,502);
  assert.deepEqual(await response.json(),{error:'Translation provider did not translate every requested segment',translations:['사랑해','',''],failedIndexes:[1]});
  assert.equal(api.calls[0].options.context,'한글 맥락');assert.ok(api.calls[0].options.signal);
  api.state.result=['번역','추가'];response=await api.POST(request({lines:['Source']}));assert.equal(response.status,502);assert.deepEqual((await response.json()).translations,['']);
  api.state.result=['너는 나빠'];response=await api.POST(request({lines:['Fuck you']}));assert.equal(response.status,502);
  api.state.result=['씨발 너'];response=await api.POST(request({lines:['Fuck you']}));assert.equal(response.status,200);assert.deepEqual(await response.json(),{translations:['씨발 너']});
});

test('cancellation keeps completed translations and returns an incomplete status',async()=>{
  const api=await fixture();const controller=new AbortController();api.state.result=['완료 번역',''];api.state.onTranslate=()=>controller.abort();
  const response=await api.POST(request({lines:['Good source','Pending source']},controller.signal));assert.equal(response.status,504);
  assert.deepEqual((await response.json()).translations,['완료 번역','']);
});

test('provider exceptions cannot leak lyrics or secrets through API errors or diagnostics',async(t)=>{
  const api=await fixture();const logs:unknown[][]=[];t.mock.method(console,'error',(...args:unknown[])=>logs.push(args));
  const privateMarker='private-lyrics-credentials-fixture';api.state.failure=new Error(privateMarker);
  const response=await api.POST(request({lines:['Source']}));assert.equal(response.status,500);
  assert.deepEqual(await response.json(),{error:'Translation failed'});assert.ok(!JSON.stringify(logs).includes(privateMarker));
});
