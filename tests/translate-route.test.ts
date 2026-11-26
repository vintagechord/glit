import assert from "node:assert/strict";
import {createRequire} from "node:module";
import test from "node:test";
import {build} from "esbuild";
import {lyricsTranslationModelBatches} from "../src/lib/lyrics-translation-validation";
import {translateLyricsBatch} from "../src/lib/server-lyrics-translation";

type Fixture={POST:(request:Request)=>Promise<Response>;state:{result:string[];failure:Error|null;allowed:boolean;onTranslate:(()=>void)|null;deny:string[];limits:Array<{namespace:string;identifier:string;limit:number;windowMs:number;cost?:number}>};calls:Array<{lines:string[];options:{context?:string;signal:AbortSignal}}>};
async function fixture():Promise<Fixture>{
  const result=await build({stdin:{resolveDir:process.cwd(),loader:"ts",contents:"export {POST} from './src/app/api/translate/route';export {state,calls} from 'translate-fixture';"},bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"translate-route-fixture",setup(plugin){
    plugin.onResolve({filter:/^(translate-fixture|@\/lib\/(?:server-lyrics-translation|request-rate-limit))$/},args=>({path:args.path,namespace:"fixture"}));
    plugin.onLoad({filter:/.*/,namespace:"fixture"},({path})=>({loader:"js",contents:path==='translate-fixture'?`export const state={result:[],failure:null,allowed:true,onTranslate:null,deny:[],limits:[]};export const calls=[];`:path==='@/lib/server-lyrics-translation'?`import {state,calls} from 'translate-fixture';export async function translateLyricsBatch(lines,options){calls.push({lines,options});state.onTranslate?.();if(state.failure)throw state.failure;return state.result}`:`import {state} from 'translate-fixture';export const consumeRateLimit=()=>({allowed:state.allowed,retryAfterSeconds:60});export const consumePersistentRateLimit=async input=>{state.limits.push(input);const allowed=!state.deny.includes(input.namespace);return {allowed,retryAfterSeconds:allowed?0:90}};export const getRequestIdentifier=()=> 'fixture';`}));
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

test('shared per-address limits and a daily site budget guard the provider, with Korean messages',async()=>{
  const api=await fixture();api.state.result=['번역'];
  // Invalid and empty requests never reach the provider and are not counted.
  await api.POST(request({lines:'wrong'}));await api.POST(request({lines:[]}));
  assert.equal(api.state.limits.length,0);
  let response=await api.POST(request({lines:['Source']}));assert.equal(response.status,200);
  // Every limit, the per-address ones included, is charged in model calls.
  assert.deepEqual(api.state.limits.map(limit=>[limit.namespace,limit.identifier,limit.cost]),[['translate-ip-600000','fixture',1],['translate-ip-86400000','fixture',1],['translate-daily-budget','site',1]]);
  assert.deepEqual(api.state.limits.map(limit=>limit.limit),[30,60,10]);
  assert.equal(api.state.limits[1].windowMs,86_400_000);assert.equal(api.state.limits[2].windowMs,86_400_000);
  api.state.limits.length=0;api.state.result=Array.from({length:45},()=>'번역');
  await api.POST(request({lines:Array.from({length:45},(_,index)=>`Source ${index}`)}));
  assert.deepEqual(api.state.limits.map(limit=>limit.cost),[3,3,3],'45 lines are three model calls of 20 lines');
  for(const namespace of ['translate-ip-600000','translate-ip-86400000']){
    const limited=await fixture();limited.state.deny=[namespace];
    response=await limited.POST(request({lines:['Source']}));
    assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'90');
    // The day's allowance does not come back "shortly".
    assert.match((await response.json()).error,namespace==='translate-ip-86400000'?/오늘 쓸 수 있는 자동번역을 모두 사용했습니다\. 내일 다시 시도/:/자동번역 요청이 너무 많습니다/);
    assert.equal(limited.calls.length,0);
    assert.equal(limited.state.limits.some(limit=>limit.namespace==='translate-daily-budget'),false,'a limited address does not spend the site budget');
  }
  const exhausted=await fixture();exhausted.state.deny=['translate-daily-budget'];
  response=await exhausted.POST(request({lines:['Source']}));
  // 503 keeps the wizard's free in-browser fallback available to real users.
  assert.equal(response.status,503);assert.match((await response.json()).error,/오늘 자동번역 사용량이 한도에 도달했습니다\. 내일 다시 시도하거나 번역을 직접 입력해주세요/);
  assert.equal(exhausted.calls.length,0);
});

// One anonymous client could spend the AI Gateway key's whole monthly limit:
// a request counted as 1 against its address however many paid calls it made.
test('a request is charged every model call it makes, without a cap, and only for lines sent to the model',async()=>{
  const api=await fixture();
  // Excerpts of 1,001 characters fit three to a 4,000-character batch: 59 of them are 20 calls.
  const long=Array.from({length:59},(_,index)=>`${String(index).padStart(3,'0')} ${'a'.repeat(997)}`);
  api.state.result=long.map(()=>'번역');
  await api.POST(request({lines:long}));
  assert.deepEqual(api.state.limits.map(limit=>limit.cost),[20,20,20]);
  // A repeated line is sent once.
  api.state.limits.length=0;api.state.result=Array.from({length:45},()=>'번역');
  await api.POST(request({lines:Array(45).fill('Source')}));
  assert.deepEqual(api.state.limits.map(limit=>limit.cost),[1,1,1]);
  // Korean lines come back as they are without a model call, so nothing is spent.
  api.state.limits.length=0;api.state.result=['한국어 가사','두 번째 줄'];
  const response=await api.POST(request({lines:['한국어 가사','두 번째 줄']}));
  assert.equal(response.status,200);assert.equal(api.state.limits.length,0);
});

test('the charge equals the model calls the server translation makes',async(t)=>{
  const originalKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture-key';
  t.after(()=>{if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey});
  for(const lines of [
    Array.from({length:59},(_,index)=>`${String(index).padStart(3,'0')} ${'a'.repeat(997)}`),
    [...Array(45).fill('Source'),'한국어 가사','Mixed 한국어 line'],
    [`${'word '.repeat(900)}end`,'Short line'],
  ]){
    let modelCalls=0;
    await translateLyricsBatch(lines,{fetchImpl:async(input,init)=>{
      assert.equal(new URL(String(input)).hostname,'api.openai.com');modelCalls++;
      const data=JSON.parse(JSON.parse(String(init?.body)).input);
      return Response.json({status:'completed',output_text:JSON.stringify({translations:data.lines.map((line:{index:number;text:string})=>({index:line.index,source:line.text,translation:`번역 ${line.index}`}))})});
    }});
    assert.equal(modelCalls,lyricsTranslationModelBatches(lines,'ko').length);
  }
});

test('the daily site budget leaves most of the monthly key for review documents and follows its setting',async()=>{
  const previous=process.env.TRANSLATE_DAILY_BATCH_BUDGET;
  const budgetFor=async(setting:string|undefined)=>{
    if(setting===undefined)delete process.env.TRANSLATE_DAILY_BATCH_BUDGET;else process.env.TRANSLATE_DAILY_BATCH_BUDGET=setting;
    const api=await fixture();api.state.result=['번역'];
    await api.POST(request({lines:['Source']}));
    return api.state.limits.find(limit=>limit.namespace==='translate-daily-budget')?.limit;
  };
  try{
    assert.equal(await budgetFor(undefined),10);
    assert.equal(await budgetFor('40'),40);
    for(const invalid of ['0','-3','abc','2.5',''])assert.equal(await budgetFor(invalid),10,`setting ${JSON.stringify(invalid)}`);
  }finally{
    if(previous===undefined)delete process.env.TRANSLATE_DAILY_BATCH_BUDGET;else process.env.TRANSLATE_DAILY_BATCH_BUDGET=previous;
  }
});
