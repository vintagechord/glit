import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";

async function fixture() {
  const bundle = await build({
    stdin: { contents: "export {retryEmailAction} from './src/app/admin/emails/actions';export {default as EmailAdminPage} from './src/app/admin/emails/page';export {checkEmailOutboxHealth} from './src/lib/email-health';export {state,calls} from 'mail-admin-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "mail-admin-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(mail-admin-fixture|@\/lib\/(?:supabase\/admin|admin\/(?:api-auth|page-auth)|email-delivery-mode)|next\/(?:cache|navigation|link))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls} from 'mail-admin-fixture';";
        const modules: Record<string, string> = {
          "mail-admin-fixture": `export const calls=[];export const state={admin:true,mode:'transactional',rpcError:false,rpcThrows:false,readError:false,receipts:{oldestPendingAt:null},worker:{enabled:true,last_error:false,last_finished_at:new Date().toISOString()},stats:{pending:0,retry:0,uncertain:0,failed:0,oldestPendingAt:null}};`,
          "@/lib/supabase/admin": `${shared} export function createAdminClient(){calls.push({name:'client'});return {rpc:async(name,args)=>{calls.push({name,args});if(state.rpcThrows)throw Error('private provider token / body');return {data:name==='email_outbox_stats'?state.stats:name==='paid_submission_notification_stats'?state.receipts:{status:'pending'},error:state.rpcError?{message:'private SQL response'}:null}},from(table){calls.push({name:'table',table});const chain={select(fields){calls.push({name:'select',fields});return chain},eq(){return chain},order(){return chain},range(){return chain},async maybeSingle(){return {data:state.worker,error:state.readError?{}:null}},then(resolve){return Promise.resolve({data:table==='email_outbox'?[]:state.worker,error:state.readError?{}:null,count:0}).then(resolve)}};return chain}};}`,
          "@/lib/admin/api-auth": `${shared} export const requireAdminForApi=async()=>state.admin?{ok:true,user:{id:'fixture-admin'}}:{ok:false,error:'forbidden'};`,
          "@/lib/admin/page-auth": `${shared} export const requireAdminPage=async()=>{if(!state.admin)throw Error('forbidden');return {id:'fixture-admin'}};`,
          "@/lib/email-delivery-mode": `${shared} export const getEmailDeliveryMode=()=>state.mode;`,
          "next/navigation": "export const redirect=url=>{throw Error('redirect:'+url)};",
          "next/cache": "export const revalidatePath=()=>{};",
          "next/link": "export default function Link(props){return props.children};",
        };
        return { loader: "js", contents: modules[path] };
      });
    } }],
  });
  const output = { exports: {} as {
    retryEmailAction: typeof import("../src/app/admin/emails/actions").retryEmailAction;
    EmailAdminPage: typeof import("../src/app/admin/emails/page").default;
    checkEmailOutboxHealth: typeof import("../src/lib/email-health").checkEmailOutboxHealth;
    state: { receipts: {oldestPendingAt:string|null}; admin: boolean; mode: string; rpcError: boolean; rpcThrows: boolean; readError: boolean; worker: {enabled:boolean;last_error:boolean;last_finished_at:string|null}; stats: {pending:number;retry:number;uncertain:number;failed:number;oldestPendingAt:string|null} };
    calls: Array<{name:string;args?:Record<string,unknown>;fields?:string}>;
  } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}

const form = (allow = false) => {
  const input = new FormData();
  input.set("id", "11111111-1111-4111-8111-111111111111");
  if (allow) input.set("allowUncertain", "on");
  return input;
};

test("mail administration checks authorization before any privileged lookup or explicit retry", async () => {
  const api = await fixture(); api.state.admin = false;
  await assert.rejects(api.retryEmailAction(form()), /forbidden/);
  await assert.rejects(api.EmailAdminPage({searchParams:Promise.resolve({})}), /forbidden/);
  assert.equal(api.calls.length, 0);
  api.state.admin = true;
  const invalid = form(); invalid.set("id", "invalid");
  await assert.rejects(api.retryEmailAction(invalid), /redirect:.*notice=invalid/);
  assert.equal(api.calls.length, 0);
  await assert.rejects(api.retryEmailAction(form()), /redirect:.*notice=queued/);
  assert.equal(api.calls.find(call=>call.name==='retry_email_outbox')?.args?.p_allow_uncertain, false);
  api.calls.length = 0;
  await assert.rejects(api.retryEmailAction(form(true)), /redirect:.*notice=queued/);
  assert.equal(api.calls.find(call=>call.name==='retry_email_outbox')?.args?.p_allow_uncertain, true);
});

test("mail retry database errors and rejected network calls become a safe failure notice", async () => {
  const api = await fixture(); api.state.rpcError = true;
  await assert.rejects(api.retryEmailAction(form()), /redirect:.*notice=failed/);
  api.state.rpcError = false; api.state.rpcThrows = true;
  await assert.rejects(api.retryEmailAction(form()), error => error instanceof Error && /redirect:.*notice=failed/.test(error.message) && !/private/.test(error.message));
});

test("mail administration shows a missing worker heartbeat and reads neither payloads nor scheduler secrets", async () => {
  const api = await fixture();
  api.state.worker.last_finished_at = null;
  const tree = await api.EmailAdminPage({searchParams:Promise.resolve({notice:'provider-secret-in-query'})});
  const text = JSON.stringify(tree);
  assert.match(text, /확인 필요/);
  assert.doesNotMatch(text, /provider-secret-in-query/);
  for (const call of api.calls.filter(call=>call.name==='select')) {
    assert.doesNotMatch(call.fields ?? '', /token|html|\*/);
  }
});

test("mail readiness requires an actual recent worker completion and never selects credentials or mail bodies", async () => {
  const api = await fixture();
  api.state.mode = 'manual';
  assert.deepEqual(await api.checkEmailOutboxHealth(), []);
  assert.equal(api.calls.length, 0);
  api.state.mode = 'transactional';
  for (const finish of [null, new Date(Date.now()-28*60*60_000).toISOString(), 'invalid']) {
    api.state.worker.last_finished_at = finish;
    const checks = await api.checkEmailOutboxHealth();
    assert.equal(checks.find(check=>check.name==='email retry worker')?.ok, false);
  }
  api.state.worker.last_finished_at = new Date().toISOString();
  assert.equal((await api.checkEmailOutboxHealth()).find(check=>check.name==='email retry worker')?.ok, true);
  api.state.stats.oldestPendingAt = new Date(Date.now()-16*60_000).toISOString();
  assert.equal((await api.checkEmailOutboxHealth()).find(check=>check.name==='email queue processing')?.ok, false);
  api.state.receipts.oldestPendingAt = new Date(Date.now()-16*60_000).toISOString();
  assert.equal((await api.checkEmailOutboxHealth()).find(check=>check.name==='payment receipt notifications')?.ok, false);
  api.state.stats.uncertain = 1;
  assert.equal((await api.checkEmailOutboxHealth()).find(check=>check.name==='email delivery exceptions')?.ok, false);
  api.state.rpcError = true;
  assert.deepEqual(await api.checkEmailOutboxHealth(), [{name:'email queue connectivity',ok:false,severity:'error'}]);
  api.state.rpcError = false; api.state.rpcThrows = true;
  const failed = await api.checkEmailOutboxHealth();
  assert.doesNotMatch(JSON.stringify(failed), /private/);
  assert.equal(failed[0].ok, false);
  for (const call of api.calls.filter(call=>call.name==='select')) {
    assert.doesNotMatch(call.fields ?? '', /token|html|recipient|subject|\*/);
  }
});
