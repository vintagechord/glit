import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

async function fixture() {
  const bundle = await build({ stdin: { contents: "export * from './src/lib/payments/notification-events';", resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "receipt-fixture", setup(p) {
      p.onResolve({ filter: /^(?:@\/lib\/(supabase\/admin|email-delivery-mode)|\.\/notifications)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      p.onLoad({ filter: /.*/, namespace: "fixture" }, ({path}) => ({ loader: "js", contents: path.includes('email-delivery-mode') ? "export const getEmailDeliveryMode=()=> 'transactional'" : path.includes('supabase') ? "export const createAdminClient=()=>{throw Error('no live DB in tests')}" : "export async function sendPaidSubmissionNotificationsById(){throw Error('no live mail in tests')}" }));
    } }],
  });
  const loaded = {exports: {} as typeof import('../src/lib/payments/notification-events')};
  new Function("require","module","exports",bundle.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
  return loaded.exports;
}

test("payment event recovery only completes durable notifications, retries outages, and shares callback keys", async () => {
  const {drainPaidSubmissionNotifications} = await fixture();
  const events = ["durable","lookup-failed","throws","not-paid"].map(submission_id=>({submission_id,payment_key:`order:${submission_id}`,lease_token:`lease:${submission_id}`}));
  const finishes: Array<[string, boolean]> = [];
  const calls: string[] = [];
  const result = await drainPaidSubmissionNotifications({limit:4,store:{async claim(limit){assert.equal(limit,4);return events},async finish(event,recorded){finishes.push([event.submission_id,recorded]);return true}},
    async notify(input){calls.push(input.paymentKey);if(input.submissionId==='throws')throw Error('fixture');return {recorded:['durable','not-paid'].includes(input.submissionId),eligible:input.submissionId==='durable',customer:null,admin:null}},
  });
  assert.deepEqual(result,{claimed:4,recorded:2,retry:2});
  assert.equal(finishes.find(([id])=>id==='lookup-failed')?.[1],false,"DB lookup failure must never discard the event");
  assert.equal(finishes.find(([id])=>id==='throws')?.[1],false);
  assert.deepEqual(calls,events.map(event=>event.payment_key));
});
