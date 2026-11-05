import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";

const submissionId = "11111111-1111-4111-8111-111111111111";

/** The real ensureSubmissionResultReader with Supabase replaced by a fixture. */
async function fixture() {
  const bundle = await build({
    stdin: { contents: "export {ensureSubmissionResultReader, ensureSubmissionOwner} from './src/lib/payments/submission'; export {state, calls} from 'reader-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "reader-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(reader-fixture|@\/lib\/supabase\/(?:server|admin))$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      plugin.onResolve({ filter: /^@\// }, (args) => ({ path: args.path, namespace: "stub" }));
      plugin.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js", contents: "module.exports = new Proxy({}, { get: () => () => undefined });" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls} from 'reader-fixture';";
        const modules: Record<string, string> = {
          "reader-fixture": "export const state={user:{id:'admin-user'},isAdmin:true,ownerId:'member-user'};export const calls=[];",
          "@/lib/supabase/server": `${shared} export const createServerSupabase=async()=>({auth:{getUser:async()=>({data:{user:state.user}})},rpc:async(name)=>{calls.push({kind:'rpc',name});return {data:state.isAdmin,error:null}}});`,
          "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>({from(){const filters=[];const chain={select(){return chain},eq(column,value){filters.push([column,value]);return chain},is(column,value){filters.push([column,value]);return chain},maybeSingle:async()=>{calls.push({kind:'lookup',filters:[...filters]});const owner=filters.find(([c])=>c==='user_id');const ok=!owner||owner[1]===state.ownerId;return {data:ok?{id:'${submissionId}',type:'MV_DISTRIBUTION',user_id:state.ownerId}:null,error:null}}};return chain}});`,
        };
        return { loader: "js", contents: modules[path] };
      });
    } }],
  });
  type Result = { submission: { id: string } | null; error: string | null };
  const output = { exports: {} as {
    ensureSubmissionResultReader: (id: string, token?: string) => Promise<Result>;
    ensureSubmissionOwner: (id: string, token?: string) => Promise<Result>;
    state: { user: { id: string } | null; isAdmin: boolean; ownerId: string };
    calls: Array<{ kind: string; name?: string; filters?: Array<[string, unknown]> }>;
  } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}

test("an administrator previewing a member's page can read the delivered result files", async () => {
  const api = await fixture();
  const result = await api.ensureSubmissionResultReader(submissionId);
  assert.equal(result.error, null);
  assert.equal(result.submission?.id, submissionId);
  const unrestricted = api.calls.filter((call) => call.kind === "lookup").at(-1);
  assert.deepEqual(unrestricted?.filters, [["id", submissionId]]);
  // Payments and uploads keep the strict owner check.
  assert.equal((await api.ensureSubmissionOwner(submissionId)).error, "FORBIDDEN");
});

test("other signed-in members are still refused", async () => {
  const api = await fixture();
  api.state.isAdmin = false;
  api.state.user = { id: "someone-else" };
  const result = await api.ensureSubmissionResultReader(submissionId);
  assert.equal(result.error, "FORBIDDEN");
  assert.equal(result.submission, null);
});

test("the owner is served without an administrator lookup", async () => {
  const api = await fixture();
  api.state.user = { id: "member-user" };
  const result = await api.ensureSubmissionResultReader(submissionId);
  assert.equal(result.error, null);
  assert.equal(api.calls.some((call) => call.kind === "rpc"), false);
});

test("only the three read-only result file routes use the administrator reader", () => {
  for (const name of ["mv-certificate", "mv-guide", "mv-rating-image"]) {
    const source = readFileSync(new URL(`../src/app/api/submissions/[id]/${name}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /ensureSubmissionResultReader\(submissionId, guestToken\)/);
    assert.doesNotMatch(source, /ensureSubmissionOwner/);
  }
  for (const path of ["src/app/api/inicis/submission/order/route.ts", "src/app/api/uploads/init/route.ts", "src/app/api/uploads/multipart/init/route.ts", "src/app/api/b2/download/route.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), /ensureSubmissionResultReader/);
  }
});
