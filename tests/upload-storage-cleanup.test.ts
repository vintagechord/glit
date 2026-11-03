import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

import { isCustomerUploadObjectKey } from "../src/lib/upload-object-references";

type Row = Record<string, unknown>;
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const owner = "11111111-1111-4111-8111-111111111111";
const upload = (name: string, submissionId = A) => `submissions/${owner}/album/${submissionId}/${name}`;

/** A PostgREST-shaped fake: select/in/eq/delete chains over in-memory tables. */
function fakeDb(tables: Record<string, Row[]>, options: { failTables?: Set<string>; rpc?: (name: string, args: Row) => unknown } = {}) {
  const calls: Array<{ name: string; args?: Row }> = [];
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let mode: "select" | "delete" = "select";
    const chain = {
      select() { return chain; },
      delete() { mode = "delete"; return chain; },
      in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return chain; },
      eq(column: string, value: unknown) { filters.push(row => row[column] === value); return chain; },
      then(resolve: (value: unknown) => void) {
        if (options.failTables?.has(table)) return resolve({ data: null, error: { message: "fixture failure" } });
        const rows = tables[table] ?? [];
        const matched = rows.filter(row => filters.every(filter => filter(row)));
        if (mode === "delete") {
          tables[table] = rows.filter(row => !matched.includes(row));
          calls.push({ name: `delete:${table}`, args: { ids: matched.map(row => row.id) } });
          return resolve({ data: null, error: null });
        }
        return resolve({ data: matched, error: null });
      },
    };
    return chain;
  };
  const removed: string[][] = [];
  const db = {
    from,
    async rpc(name: string, args: Row) {
      calls.push({ name, args });
      return { data: options.rpc?.(name, args) ?? null, error: null };
    },
    storage: { from: () => ({ remove: async (names: string[]) => { removed.push(names); return { data: null, error: null }; } }) },
  };
  return { db, calls, removed };
}

async function loadCleanup() {
  const modules: Record<string, string> = {
    "@/lib/b2": "export const getB2Config=()=>({prefix:'submissions/'});export const abortMultipartUpload=async()=>{};export const deleteObjectAllVersions=async()=>0;",
    "@/lib/supabase/admin": "export const createAdminClient=()=>{throw new Error('tests pass a db')};",
    "@/lib/multipart-upload-grants": "export const state={leased:0,fail:false};export const cleanupExpiredMultipartGrants=async()=>{if(state.fail)throw new Error('lease failed');return state.leased};",
    "@/lib/admin/customer-file-purge": "export const purgeState={confirmed:0};export const resumeInterruptedPurges=async()=>purgeState.confirmed;",
  };
  const bundle = await build({
    stdin: { contents: "export * from './src/lib/upload-storage-cleanup'; export {state as grantState} from '@/lib/multipart-upload-grants'; export {purgeState} from '@/lib/admin/customer-file-purge';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "cleanup-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^@\/lib\/(?:b2|supabase\/admin|multipart-upload-grants|admin\/customer-file-purge)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: modules[path] }));
    } }],
  });
  type Ops = { abortUpload: (params: { objectKey: string; uploadId: string }) => Promise<unknown>; deleteAllVersions: (key: string) => Promise<number> };
  const output = { exports: {} as {
    processStorageCleanupQueue: (db: unknown, options: { prefix: string; limit?: number; ops?: Ops }) => Promise<{ leased: number; done: number }>;
    runUploadStorageCleanup: (options: { db: unknown; budgetMs?: number }) => Promise<Record<string, { ok: boolean; count: number }>>;
    grantState: { leased: number; fail: boolean };
    purgeState: { confirmed: number };
  } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}

test("cleanup only ever touches applicant upload and supplement keys", () => {
  assert.equal(isCustomerUploadObjectKey(upload("song.wav"), "submissions/", A), true);
  assert.equal(isCustomerUploadObjectKey(`submissions/supplements/${A}/r/v/u/fix.wav`, "submissions/", A), true);
  assert.equal(isCustomerUploadObjectKey(upload("song.wav"), "submissions/"), true, "any submission when none is given");
  for (const key of [
    upload("song.wav", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), `submissions/${A}/certificate/cert.pdf`,
    `submissions/email-attachments/${A}/x/hash.png`, `submissions/admin-free/free-upload/${A}/x.pdf`,
    `submissions/artist-thumbnails/a/b/${A}/x.jpg`, `submissions/${owner}/album/${A}/../x.wav`,
    `submissions/${owner}//${A}/x.wav`, `other/${owner}/album/${A}/x.wav`, `submissions/supplements/${A}`,
  ]) {
    assert.equal(isCustomerUploadObjectKey(key, "submissions/", A), false, key);
  }
  assert.equal(isCustomerUploadObjectKey(upload("song.wav"), ""), false, "an empty prefix never matches");
});

test("queued objects are aborted and deleted unless a row still uses them; failures stay queued", async () => {
  const api = await loadCleanup();
  const queue: Row[] = [
    { id: "q-active", object_key: upload("active.wav"), upload_id: "upload-1", submission_id: A, reason: "GRANT_DELETED", attempts: 0 },
    { id: "q-saved", object_key: upload("saved.wav"), upload_id: null, submission_id: A, reason: "STAGING_EXPIRED", attempts: 0 },
    { id: "q-aborted", object_key: upload("gone.wav"), upload_id: "upload-gone", submission_id: A, reason: "GRANT_DELETED", attempts: 1 },
    { id: "q-b2-down", object_key: upload("down.wav"), upload_id: "upload-down", submission_id: A, reason: "GRANT_DELETED", attempts: 2 },
    { id: "q-foreign", object_key: `submissions/${A}/certificate/cert.pdf`, upload_id: null, submission_id: A, reason: "PUT_GRANT_ABANDONED", attempts: 0 },
    { id: "q-supplement", object_key: `submissions/supplements/${A}/r/v/u/fix.wav`, upload_id: "upload-supp", submission_id: A, reason: "GRANT_DELETED", attempts: 0 },
  ];
  const tables: Record<string, Row[]> = {
    storage_object_cleanup_queue: [...queue],
    submission_files: [{ id: "live", object_key: upload("saved.wav") }],
    submission_upload_staging: [],
    submission_supplement_files: [{ id: "verified", object_key: `submissions/supplements/${A}/r/v/u/fix.wav`, status: "VERIFIED" }],
  };
  const { db, calls } = fakeDb(tables, { rpc: name => name === "lease_storage_object_cleanup" ? queue : null });
  const aborted: string[] = [];
  const deleted: string[] = [];
  const result = await api.processStorageCleanupQueue(db, {
    prefix: "submissions/",
    ops: {
      abortUpload: async ({ uploadId }) => {
        if (uploadId === "upload-gone") throw Object.assign(new Error("gone"), { name: "NoSuchUpload" });
        if (uploadId === "upload-down") throw Object.assign(new Error("down"), { name: "InternalError" });
        aborted.push(uploadId);
      },
      deleteAllVersions: async key => { deleted.push(key); return 1; },
    },
  });
  assert.deepEqual(result, { leased: 6, done: 5 });
  assert.deepEqual(aborted.sort(), ["upload-1", "upload-supp"]);
  assert.deepEqual(deleted.sort(), [upload("active.wav"), upload("gone.wav")].sort(), "only unreferenced customer keys are deleted");
  assert.deepEqual(tables.storage_object_cleanup_queue.map(row => row.id), ["q-b2-down"], "a failed abort stays leased for a later retry");
  assert.ok(calls.some(call => call.name === "lease_storage_object_cleanup"));

  // A reference lookup that fails never turns into a delete.
  const retry: Row[] = [{ id: "q-lookup", object_key: upload("doubt.wav"), upload_id: null, submission_id: A, reason: "STAGING_EXPIRED", attempts: 0 }];
  const failing = fakeDb({ storage_object_cleanup_queue: [...retry], submission_files: [], submission_upload_staging: [], submission_supplement_files: [] }, {
    failTables: new Set(["submission_upload_staging"]), rpc: () => retry,
  });
  const removedKeys: string[] = [];
  assert.deepEqual(await api.processStorageCleanupQueue(failing.db, { prefix: "submissions/", ops: { abortUpload: async () => undefined, deleteAllVersions: async key => { removedKeys.push(key); return 1; } } }), { leased: 1, done: 0 });
  assert.deepEqual(removedKeys, []);
});

test("a scheduled run works through every step and one failing step does not stop the others", async () => {
  const api = await loadCleanup();
  api.grantState.fail = true;
  api.purgeState.confirmed = 3;
  const { db, calls, removed } = fakeDb({ storage_object_cleanup_queue: [] }, {
    rpc: (name) => {
      if (name === "retire_expired_upload_storage") return { staging: 4, putGrants: 1, completedPutGrants: 0 };
      if (name === "lease_storage_object_cleanup") return [];
      if (name === "list_orphan_magazine_artwork") return [{ object_name: `${owner}/uploads/1730000000000-x-cover.png` }, { object_name: "../escape.png" }];
      return null;
    },
  });
  const report = await api.runUploadStorageCleanup({ db });
  assert.deepEqual(report["expired-uploads"], { ok: true, count: 5 });
  assert.deepEqual(report["multipart-grants"], { ok: false, count: 0 });
  assert.deepEqual(report["queued-objects"], { ok: true, count: 0 });
  assert.deepEqual(report["interrupted-purges"], { ok: true, count: 3 });
  assert.deepEqual(report["magazine-artwork"], { ok: true, count: 1 });
  assert.deepEqual(removed, [[`${owner}/uploads/1730000000000-x-cover.png`]], "only member upload paths are removed");
  assert.deepEqual(calls.find(call => call.name === "list_orphan_magazine_artwork")?.args, { p_min_age: "1 day", p_limit: 100 });
});

test("multipart aborts also delete an object a failed or abandoned completion assembled", async () => {
  const modules: Record<string, string> = {
    "grant-fixture": "export const calls=[];export const state={leased:[],deleteFails:false,abortError:null};",
    "@/lib/b2": "import {calls,state} from 'grant-fixture';export const getB2Config=()=>({prefix:'submissions/'});export const abortMultipartUpload=async input=>{calls.push({name:'abort',input});if(state.abortError)throw Object.assign(new Error('x'),{name:state.abortError})};",
    "@/lib/upload-object-references": "import {calls,state} from 'grant-fixture';export const deleteUnreferencedUploadObject=async(db,key,options)=>{calls.push({name:'delete',key,options});if(state.deleteFails)throw new Error('lookup failed');return 'deleted'};",
    "@/lib/supabase/admin": "import {calls,state} from 'grant-fixture';export const createAdminClient=()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:state.leased,error:null}},from(){let values=null;const chain={update(v){values=v;return chain},eq(){return chain},in(){return chain},select(){return chain},async maybeSingle(){calls.push({name:'update',values});return {data:{id:'grant'},error:null}}};return chain}});",
  };
  const bundle = await build({
    stdin: { contents: "export * from './src/lib/multipart-upload-grants'; export {calls,state} from 'grant-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "grant-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(grant-fixture|@\/lib\/(?:b2|supabase\/admin|upload-object-references))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: modules[path] }));
    } }],
  });
  const output = { exports: {} as { cleanupExpiredMultipartGrants: (limit?: number) => Promise<number>; abortFailedMultipartGrant: (grant: Row) => Promise<boolean>; calls: Array<{ name: string; values?: Row; key?: string; options?: Row; args?: Row }>; state: { leased: Row[]; deleteFails: boolean; abortError: string | null } } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  const api = output.exports;
  const grant = { id: "grant", submission_id: A, object_key: upload("assembled.wav"), upload_id: "upload-1", status: "ABORTING", abort_attempts: 1 };

  api.state.leased = [grant]; api.state.abortError = "NoSuchUpload";
  assert.equal(await api.cleanupExpiredMultipartGrants(20), 1);
  assert.deepEqual(api.calls.map(call => call.name), ["lease_expired_multipart_upload_aborts", "abort", "delete", "update"]);
  assert.equal(api.calls.find(call => call.name === "delete")?.key, upload("assembled.wav"));
  assert.deepEqual(api.calls.find(call => call.name === "delete")?.options, { prefix: "submissions/", submissionId: A });
  assert.equal(api.calls.find(call => call.name === "update")?.values?.status, "ABORTED");

  // A lookup failure keeps the grant ABORTING for the lease to retry.
  api.calls.length = 0; api.state.deleteFails = true; api.state.abortError = null;
  assert.equal(await api.cleanupExpiredMultipartGrants(20), 1);
  assert.equal(api.calls.some(call => call.name === "update"), false);

  // The completion route retires a FAILED grant at once.
  api.calls.length = 0; api.state.deleteFails = false;
  assert.equal(await api.abortFailedMultipartGrant({ ...grant, status: "FAILED" }), true);
  assert.deepEqual(api.calls.map(call => call.name), ["update", "abort", "delete", "update"]);
  assert.equal(api.calls[0].values?.status, "ABORTING");
});

test("the free-upload GET serves thumbnails only from inside their folder", async () => {
  const bundle = await build({
    stdin: { contents: "export {GET} from './src/app/api/admin/uploads/free/route';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "free-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^@\/lib\/(?:b2|supabase\/server)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "@/lib/b2"
        ? "export class B2ConfigError extends Error{};export const getB2Config=()=>({prefix:'submissions/'});export const presignGetUrl=async key=>'https://signed.invalid/'+encodeURIComponent(key);export const buildObjectKey=()=>'';export const deleteObject=async()=>{};"
        : "export const createServerSupabase=async()=>({auth:{getUser:async()=>({data:{user:null}})},rpc:async()=>({data:false})});" }));
    } }],
  });
  const output = { exports: {} as { GET: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  const get = (objectKey: string) => output.exports.GET(new Request(`https://fixture.invalid/api/admin/uploads/free?objectKey=${encodeURIComponent(objectKey)}`));
  assert.equal((await get("submissions/artist-thumbnails/artist/thumb.jpg")).status, 302);
  for (const key of [
    "submissions/artist-thumbnails/../11111111/album/x.wav", "submissions/artist-thumbnails//thumb.jpg",
    "submissions/artist-thumbnails/./thumb.jpg", "submissions/artist-thumbnails/", "submissions/artist-thumbnails/a\\..\\b.jpg",
    "submissions/artist-thumbnails/a/..", "submissions/admin-free/x.pdf",
  ]) {
    assert.equal((await get(key)).status, 404, key);
  }
});

test("the schedule, leases and retention rules are in the migrations", () => {
  const cleanup = read("supabase/migrations/20261103150000_upload_grants_and_storage_cleanup.sql");
  const schedule = read("supabase/migrations/20261103150400_storage_cleanup_schedule.sql");
  const purge = read("supabase/migrations/20261103150100_customer_file_purge_confirmation.sql");
  const bucket = read("supabase/migrations/20261103150200_close_submissions_bucket_uploads.sql");
  const artwork = read("supabase/migrations/20261103150300_magazine_artwork_limits.sql");

  // Item 4: failed and abandoned completions join the abort lease, which keeps
  // its service-role check, pinned search_path and grants.
  assert.match(cleanup, /create or replace function public\.lease_expired_multipart_upload_aborts[\s\S]*security definer\s+set search_path = public, pg_temp[\s\S]*auth\.role\(\)/);
  assert.match(cleanup, /candidate_grant\.status = 'FAILED'/);
  assert.match(cleanup, /candidate_grant\.status = 'COMPLETING'\s+and candidate_grant\.expires_at <= now\(\) - interval '1 day'/);
  assert.match(cleanup, /grant execute on function public\.lease_expired_multipart_upload_aborts\(integer\)\s+to service_role/);
  assert.match(cleanup, /after delete on public\.multipart_upload_grants\s+for each row execute function public\.queue_deleted_multipart_upload_cleanup/);
  assert.match(cleanup, /after delete on public\.upload_put_grants/);
  // Item 3: the 7-day expiry is enforced and only unreferenced keys are queued.
  assert.match(cleanup, /staged\.expires_at <= now\(\)/);
  assert.match(cleanup, /not exists \(\s*select 1 from public\.submission_files live/);
  assert.match(cleanup, /other\.id not in \(select expired\.id from expired\)/);
  for (const fn of ["retire_expired_upload_storage(integer)", "lease_storage_object_cleanup(integer)"]) {
    assert.match(cleanup, new RegExp(`revoke all on function public\\.${fn.replace(/[()]/g, "\\$&")}\\s+from public, anon, authenticated`), fn);
    assert.match(cleanup, new RegExp(`grant execute on function public\\.${fn.replace(/[()]/g, "\\$&")}\\s+to service_role`), fn);
  }
  for (const table of ["upload_put_grants", "storage_object_cleanup_queue"]) {
    assert.match(cleanup, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(cleanup, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
  }
  assert.match(schedule, /cron\.schedule\('onside-storage-cleanup', '\*\/10 \* \* \* \*'/);
  assert.match(schedule, /body := '\{"task":"storage-cleanup"\}'::jsonb/);
  assert.match(schedule, /revoke all on function public\.dispatch_storage_cleanup\(\) from public, anon, authenticated/);
  // Item 7.
  assert.match(purge, /add column if not exists purge_confirmed_at timestamptz/);
  // Item 9.
  assert.match(bucket, /drop policy if exists "Submission files are insertable by owner" on storage\.objects/);
  // Item 11.
  assert.match(artwork, /file_size_limit = 20971520/);
  assert.match(artwork, /allowed_mime_types = array\['image\/jpeg', 'image\/png', 'image\/webp', 'image\/gif'\]/);
  assert.match(artwork, /grant execute on function public\.list_orphan_magazine_artwork\(interval, integer\)\s+to service_role/);
});

test("the background route runs storage cleanup only for its task, and drafts hide expired receipts", () => {
  const route = read("src/app/api/internal/background-jobs/route.ts");
  assert.ok(route.indexOf('authorize_email_worker') < route.indexOf('readBoundedJsonBody(request'), "the body is read after authorization");
  assert.match(route, /task === "storage-cleanup"[\s\S]*runUploadStorageCleanup/);
  const drafts = read("src/app/api/submissions/drafts/route.ts");
  assert.match(drafts, /from\("submission_upload_staging"\)[\s\S]{0,200}\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
});

test("magazine artwork upload URLs are throttled per member and need enough credit", () => {
  const actions = read("src/features/magazine/actions.ts");
  const start = actions.indexOf("export async function createMagazineArtworkUploadAction");
  const body = actions.slice(start, actions.indexOf("async function verifyMagazineArtworkUpload"));
  assert.match(body, /consumePersistentRateLimit\(\{\s*namespace: "magazine-artwork-upload-user",\s*identifier: user\.id/);
  assert.match(body, /creditSummary\.available < MAGAZINE_REQUEST_CREDIT_COST/);
  assert.ok(body.indexOf("consumePersistentRateLimit") < body.indexOf("createSignedUploadUrl"));
  assert.ok(body.indexOf("creditSummary.available") < body.indexOf("createSignedUploadUrl"));
});
