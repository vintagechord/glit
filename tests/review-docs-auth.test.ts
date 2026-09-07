import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";

// Bundle the real Route Handlers with only the session transport replaced.
// This exercises the shared is_admin check before payload parsing/storage.
test("every review-docs route returns 403 for an authenticated fixture session without admin privileges", async () => {
  const result = await build({
    stdin: { contents: `
      export {GET as list, POST as create} from './src/app/api/admin/review-docs/jobs/route';
      export {GET as detail, PATCH as save} from './src/app/api/admin/review-docs/jobs/[id]/route';
      export {POST as action} from './src/app/api/admin/review-docs/jobs/[id]/[action]/route';
      export {GET as download} from './src/app/api/admin/review-docs/jobs/[id]/download/route';
      export {GET as source} from './src/app/api/admin/review-docs/jobs/[id]/source/route';
    `, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "auth-test-transport", setup(plugin) {
      plugin.onResolve({ filter: /^@\/lib\/supabase\/server$/ }, () => ({ path: "session", namespace: "auth-fixture" }));
      plugin.onResolve({ filter: /^@\/lib\/supabase\/admin$/ }, () => ({ path: "privileged", namespace: "auth-fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "auth-fixture" }, ({ path }) => ({ loader: "js", contents: path === "privileged"
        ? `export function createAdminClient() { throw new Error("Privileged client must not run for unauthorized callers"); }`
        : `export async function createServerSupabase() { return { auth: {getUser: async () => ({data:{user:{id:'regular-user'}},error:null})}, rpc: async (name) => { if(name!=='is_admin') throw new Error('Unexpected RPC'); return {data:false,error:null}; } }; }` }));
    } }],
  });
  const bundled = { exports: {} as Record<string, (request: Request, context?: unknown) => Promise<Response>> };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  const context = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111", action: "generate" }) };
  for (const [handler, method] of [["list", "GET"], ["create", "POST"], ["detail", "GET"], ["save", "PATCH"], ["download", "GET"], ["source", "GET"]]) {
    const response = await bundled.exports[handler](new Request("https://onside.test/api/admin/review-docs/jobs", { method, ...(method === "GET" ? {} : { body: '{"isAdmin":true,"broken":' }) }), context);
    assert.equal(response.status, 403, handler);
    assert.deepEqual(await response.json(), { error: "관리자 권한이 필요합니다.", code: "AUTH_REQUIRED" });
  }
  for (const action of ["generate", "translate", "retry", "cancel"]) {
    const response = await bundled.exports.action(new Request(`https://onside.test/api/admin/review-docs/jobs/id/${action}`, { method: "POST", body: '{"isAdmin":true}' }), { params: Promise.resolve({ ...await context.params, action }) });
    assert.equal(response.status, 403, action);
  }
});
