import assert from "node:assert/strict";
import {createRequire} from "node:module";
import test from "node:test";
import {build} from "esbuild";

type Operation={method:string;args:unknown[]};
type Fixture={getSubmissionCartCount:(id:string)=>Promise<{count:number;totalAmountKrw:number;error:unknown}>;getSubmissionCartItems:(id:string)=>Promise<unknown>;state:{results:Array<{data:unknown[]|null;error:unknown}>};queries:Operation[][]};
async function fixture():Promise<Fixture>{
  const result=await build({stdin:{resolveDir:process.cwd(),loader:"ts",contents:"export {getSubmissionCartCount,getSubmissionCartItems} from './src/lib/submission-cart';export {state,queries} from 'cart-summary-fixture';"},bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"cart-summary-fixture",setup(plugin){
    plugin.onResolve({filter:/^(cart-summary-fixture|@\/lib\/supabase\/server)$/},args=>({path:args.path,namespace:"fixture"}));
    plugin.onLoad({filter:/.*/,namespace:"fixture"},({path})=>({loader:"js",contents:path==='cart-summary-fixture'?`export const state={results:[]};export const queries=[];`:`import {state,queries} from 'cart-summary-fixture';export const createServerSupabase=async()=>({from(table){const ops=[{method:'from',args:[table]}];queries.push(ops);const chain={then(resolve,reject){return Promise.resolve(state.results.shift()).then(resolve,reject)}};for(const name of ['select','eq','is','in','or','order','limit'])chain[name]=(...args)=>{ops.push({method:name,args});return chain};return chain}});`}));
  }}]});
  const output={exports:{} as Fixture};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),output,output.exports);return output.exports;
}
const filters=(ops:Operation[])=>ops.filter(op=>op.method!=='select');

test('header summary fetches only amount/id while preserving the full cart owner, lifecycle, visibility and limit filters',async()=>{
  const api=await fixture();api.state.results.push({data:[{amount_krw:15000},{amount_krw:-1},{amount_krw:'invalid'}],error:null});
  assert.deepEqual(await api.getSubmissionCartCount('fixture-owner'),{count:3,totalAmountKrw:15000,error:null});
  assert.deepEqual(api.queries[0].find(op=>op.method==='select')?.args,['id,amount_krw']);
  api.state.results.push({data:[],error:null});await api.getSubmissionCartItems('fixture-owner');
  assert.deepEqual(filters(api.queries[0]),filters(api.queries[1]));
  assert.ok(api.queries[1].find(op=>op.method==='select')?.args[0]?.toString().includes('package:packages'));
  assert.deepEqual(api.queries[0],[
    {method:'from',args:['submissions']},{method:'select',args:['id,amount_krw']},
    {method:'eq',args:['user_id','fixture-owner']},{method:'is',args:['current_order_id',null]},
    {method:'in',args:['status',['SUBMITTED','WAITING_PAYMENT']]},{method:'or',args:['payment_status.is.null,payment_status.eq.UNPAID']},
    {method:'is',args:['user_deleted_at',null]},{method:'order',args:['updated_at',{ascending:false}]},{method:'limit',args:[200]},
  ]);
});

test('summary keeps the legacy visibility-column fallback and does not retry an unrelated database failure',async()=>{
  const api=await fixture();api.state.results.push({data:null,error:{code:'42703',message:'user_deleted_at missing'}},{data:[{amount_krw:32000}],error:null});
  assert.deepEqual(await api.getSubmissionCartCount('fixture-owner'),{count:1,totalAmountKrw:32000,error:null});
  assert.equal(api.queries.length,2);
  assert.deepEqual(api.queries[1],api.queries[0].filter(op=>!(op.method==='is'&&op.args[0]==='user_deleted_at')));
  const error={code:'42501',message:'access denied'};api.state.results.push({data:null,error});
  assert.deepEqual(await api.getSubmissionCartCount('other-fixture-owner'),{count:0,totalAmountKrw:0,error});
  assert.equal(api.queries.length,3);
});
