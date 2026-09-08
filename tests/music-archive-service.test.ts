import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { applyArchiveCommand, createArchiveData, type ArchiveData } from "../src/lib/music-archive/model";

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER = "10000000-0000-4000-8000-000000000002";
const LIBRARY = "20000000-0000-4000-8000-000000000001";
const OTHER_LIBRARY = "20000000-0000-4000-8000-000000000002";
const SUBMISSION = "30000000-0000-4000-8000-000000000001";
const OTHER_SUBMISSION = "30000000-0000-4000-8000-000000000002";
const SUBMISSION_TRACK = "40000000-0000-4000-8000-000000000001";
const OTHER_SUBMISSION_TRACK = "40000000-0000-4000-8000-000000000002";
const ATTACHMENT = "50000000-0000-4000-8000-000000000001";
const OTHER_ATTACHMENT = "50000000-0000-4000-8000-000000000002";

type FixtureRow = Record<string, unknown>;
type FixtureCall = { method: string; table?: string; name?: string; args?: FixtureRow; input?: unknown; operations?: { method: string; args: unknown[] }[] };
type FixtureState = { user: { id: string } | null; authError: unknown; isAdmin: boolean; limited: boolean; tables: Record<string, FixtureRow[]>; databaseError: { code: string; message: string } | null };
type Harness = typeof import("../src/lib/music-archive/service") & typeof import("../src/lib/music-archive/evidence") & typeof import("../src/lib/music-archive/http") & {
  state: FixtureState; calls: FixtureCall[];
  apiGET: (request: Request) => Promise<Response>; apiPOST: (request: Request) => Promise<Response>;
  evidenceGET: (request: Request) => Promise<Response>;
};

// Bundle the real routes, authorization, service, model and evidence storage validation.
// Replace only infrastructure (Supabase/B2/Next after/rate limiter) and unrelated sync execution.
const bundle = build({
  stdin: { contents: `export * from './src/lib/music-archive/service'; export * from './src/lib/music-archive/evidence'; export * from './src/lib/music-archive/http'; export {GET as apiGET, POST as apiPOST} from './src/app/api/music-archive/route'; export {GET as evidenceGET} from './src/app/api/music-archive/evidence/route'; export {state,calls} from 'archive-service-fixture';`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "archive-service-fixtures", setup(plugin) {
    plugin.onResolve({ filter: /^(archive-service-fixture|@\/lib\/supabase\/(?:admin|server)|@\/lib\/b2|@\/lib\/request-rate-limit|next\/server)$/ }, args => ({ path: args.path, namespace: "archive-fixture" }));
    plugin.onResolve({ filter: /(?:^\.\/sync$|^@\/lib\/music-archive\/sync$)/ }, args => ({ path: args.path, namespace: "archive-sync-fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "archive-sync-fixture" }, () => ({ loader: "js", contents: `export async function runArchiveBatch(){throw new Error('Unexpected sync execution');} export async function enqueueArchiveSync(){throw new Error('Unexpected sync enqueue');} export async function resumeArchiveSync(){throw new Error('Unexpected sync resume');} export async function acquireArchiveProviderPermit(){throw new Error('Unexpected external request');}` }));
    plugin.onLoad({ filter: /.*/, namespace: "archive-fixture" }, ({ path }) => {
      const shared = `import {state,calls,client} from 'archive-service-fixture';`;
      const files: Record<string, string> = {
        "archive-service-fixture": `
          export const state={user:{id:'${OWNER}'},authError:null,isAdmin:false,limited:false,tables:{},databaseError:null};
          export const calls=[];
          function query(table){
            const operations=[]; const q={};
            for(const method of ['select','eq','is','in','or','order','range','limit','insert','update','delete']) q[method]=(...args)=>{operations.push({method,args});return q;};
            function run(single=false){
              calls.push({method:'query',table,operations:structuredClone(operations)});
              if(state.databaseError)return {data:null,error:state.databaseError,count:0};
              let rows=[...(state.tables[table]??[])];
              for(const op of operations){
                const [key,value]=op.args;
                if(op.method==='eq')rows=rows.filter(row=>row[key]===value);
                if(op.method==='is')rows=rows.filter(row=>value===null?row[key]==null:row[key]===value);
                if(op.method==='in')rows=rows.filter(row=>value.includes(row[key]));
              }
              const count=rows.length;
              for(const op of operations){if(op.method==='range')rows=rows.slice(op.args[0],op.args[1]+1);if(op.method==='limit')rows=rows.slice(0,op.args[0]);}
              return {data:single?(rows[0]??null):structuredClone(rows),error:null,count};
            }
            q.maybeSingle=()=>Promise.resolve(run(true));q.single=()=>Promise.resolve(run(true));q.then=(ok,fail)=>Promise.resolve(run()).then(ok,fail);
            return q;
          }
          export const client={from:query,rpc:async(name,args)=>{
            calls.push({method:'rpc',name,args:structuredClone(args)});
            if(state.databaseError)return {data:null,error:state.databaseError};
            if(name==='create_music_archive_library'){
              const row={id:args.p_id,owner_id:args.p_owner,version:1,data:args.p_data,archived_at:null,created_at:'2026-09-08T00:00:00Z',updated_at:'2026-09-08T00:00:00Z'};
              (state.tables.music_archive_libraries??=[]).push(row);return {data:row,error:null};
            }
            if(name==='save_music_archive_library'){
              const row=(state.tables.music_archive_libraries??[]).find(r=>r.id===args.p_id&&r.owner_id===args.p_owner);
              if(!row)return {data:null,error:{message:'OWNER_NOT_FOUND'}};
              if(row.version!==args.p_version)return {data:null,error:{code:'40001',message:'VERSION_CONFLICT'}};
              row.data=args.p_data;row.version++;return {data:structuredClone(row),error:null};
            }
            if(name==='save_music_archive_guide')return {data:null,error:null};
            throw new Error('Unexpected database mutation '+name);
          }};`,
        "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>client;`,
        "@/lib/supabase/server": `${shared} export async function createServerSupabase(){return {auth:{getUser:async()=>{calls.push({method:'auth'});return {data:{user:state.user},error:state.authError};}},rpc:async(name)=>{calls.push({method:'auth-rpc',name});return {data:state.isAdmin,error:null};}};}`,
        "@/lib/request-rate-limit": `${shared} export const consumeRateLimit=()=>({allowed:!state.limited,retryAfterSeconds:60});`,
        "@/lib/b2": `${shared} export const getB2Config=()=>({prefix:'test/',bucket:'private-test',client:{send:async command=>{calls.push({method:'storage',name:command.constructor.name,input:command.input});return {ContentLength:9,Body:(async function*(){yield Buffer.from('%PDF-test');})()};}}});`,
        "next/server": `${shared} export const after=callback=>{calls.push({method:'after',input:typeof callback});};`,
      };
      return { loader: "js", contents: files[path] };
    });
  } }],
});

async function harness() {
  const result = await bundle;
  const loaded = { exports: {} as Harness };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports;
}
function libraryData() {
  let data = createArchiveData("Shared artist name");
  data = applyArchiveCommand(data, { type: "add_release", release: { id: "release-one", title: "Shared album title" } });
  return applyArchiveCommand(data, { type: "add_track", track: { id: "track-one", releaseId: "release-one", title: "Shared track title" } });
}
function libraryRow(owner = OWNER, id = LIBRARY, data: ArchiveData = libraryData()): FixtureRow {
  return { id, owner_id: owner, version: 1, data, archived_at: null, created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z" };
}
function submissionRow(owner = OWNER, id = SUBMISSION, trackId = SUBMISSION_TRACK): FixtureRow {
  return { id, user_id: owner, type: "ALBUM", user_deleted_at: null, artist_name: "Shared artist name", title: owner === OWNER ? "My private submission" : "Other member private submission", album_tracks: [{ id: trackId, track_title: "Shared track title" }] };
}
const commandBody = (command: unknown) => ({ action: "command", libraryId: LIBRARY, version: 1, command });
const status = (expected: number) => (error: unknown) => error instanceof Error && "status" in error && error.status === expected;
const mutations = (h: Harness) => h.calls.filter(call => call.method === "rpc" || call.operations?.some(op => ["insert", "update", "delete"].includes(op.method)));
const hasFilter = (call: FixtureCall, field: string, value: unknown) => call.operations?.some(op => op.method === "eq" && op.args[0] === field && op.args[1] === value);
const jsonRequest = (body: unknown, headers: Record<string, string> = {}) => new Request("https://onside.test/api/music-archive", { method: "POST", headers: { "content-type": "application/json", origin: "https://onside.test", ...headers }, body: JSON.stringify(body) });


test("library service and real detail route hide another owner's same-artist archive", async () => {
  const h = await harness();
  h.state.tables.music_archive_libraries = [libraryRow(OTHER_OWNER)];
  await assert.rejects(() => h.getOwnedLibrary(OWNER, LIBRARY), status(404));
  assert.ok(hasFilter(h.calls.find(call => call.table === "music_archive_libraries")!, "owner_id", OWNER));
  const response = await h.apiGET(new Request(`https://onside.test/api/music-archive?libraryId=${LIBRARY}`));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.doesNotMatch(await response.text(), new RegExp(OTHER_OWNER));
  assert.equal(mutations(h).length, 0);
});

test("owned submission search filters owner, album type and deletion state before returning candidates", async () => {
  const h = await harness();
  h.state.tables.submissions = [submissionRow(), submissionRow(OTHER_OWNER, OTHER_SUBMISSION), { ...submissionRow(OWNER, OTHER_SUBMISSION), user_deleted_at: "2026-09-01" }, { ...submissionRow(OWNER, OTHER_SUBMISSION), type: "MV" }];
  const result = await h.searchOwnedSubmissions(OWNER, "Shared artist name,(user_id.eq.other)%_\\", 0);
  assert.deepEqual(result.submissions.map(row => row.id), [SUBMISSION]);
  const call = h.calls.find(call => call.table === "submissions")!;
  assert.ok(hasFilter(call, "user_id", OWNER));
  assert.ok(hasFilter(call, "type", "ALBUM"));
  assert.ok(call.operations?.some(op => op.method === "is" && op.args[0] === "user_deleted_at" && op.args[1] === null));
  const filter = String(call.operations?.find(op => op.method === "or")?.args[0]);
  assert.equal(filter.split(",").length, 2, "search input cannot add PostgREST OR branches");
  assert.doesNotMatch(filter, /[()\\]/);
  assert.doesNotMatch(filter, /user_id/);
  assert.ok(call.operations?.some(op => op.method === "range" && op.args[1] === 19));
});

test("cross-owner and wrong submission-track review links reject before any private archive save", async () => {
  const h = await harness();
  h.state.tables.music_archive_libraries = [libraryRow()];
  h.state.tables.submissions = [submissionRow(OTHER_OWNER)];
  const link = { id: "link-one", submissionId: SUBMISSION, trackId: "track-one", submissionTrackId: SUBMISSION_TRACK };
  await assert.rejects(() => h.mutateArchive(OWNER, commandBody({ type: "link_review", link })), status(404));
  assert.equal(mutations(h).length, 0);
  assert.ok(hasFilter(h.calls.find(call => call.table === "submissions")!, "user_id", OWNER));
  h.state.tables.submissions = [submissionRow()];
  await assert.rejects(() => h.mutateArchive(OWNER, commandBody({ type: "link_review", link: { ...link, submissionTrackId: OTHER_SUBMISSION_TRACK } })), status(404));
  await assert.rejects(() => h.mutateArchive(OWNER, commandBody({ type: "link_review", link: { id: "link-one", submissionId: SUBMISSION, trackId: "track-one" } })), status(422));
  assert.equal(mutations(h).length, 0);
  await h.mutateArchive(OWNER, commandBody({ type: "link_review", link }));
  assert.equal(mutations(h).length, 1);
  assert.equal(mutations(h)[0].name, "save_music_archive_library");
  assert.equal(mutations(h)[0].args?.p_owner, OWNER);
});

test("artist creation and manual release creation never create paid orders, payments, submissions or background work", async () => {
  const h = await harness();
  const response = await h.apiPOST(jsonRequest({ action: "create", name: "New free archive" }));
  assert.equal(response.status, 200);
  const created = await response.json() as { library: { id: string } };
  await h.mutateArchive(OWNER, { action: "command", libraryId: created.library.id, version: 1, command: { type: "add_release", release: { id: "manual-release", title: "Manual single", type: "single" } } });
  assert.deepEqual(mutations(h).map(call => call.name), ["create_music_archive_library", "save_music_archive_library"]);
  assert.ok(h.calls.every(call => !call.table || call.table === "music_archive_libraries"));
  assert.equal(h.calls.filter(call => call.method === "after").length, 0);
});

test("client cannot spoof official/admin task evidence or successful official query provenance", async () => {
  const h = await harness();
  h.state.tables.music_archive_libraries = [libraryRow()];
  const base = { type: "save_tasks", id: "task", trackIds: ["track-one"], task: { kind: "karaoke", agency: "TJ", status: "completed", result: "listed" } };
  for (const extra of [{ source: "official" }, { source: "admin" }, { source: "onside" }, { queryStatus: "success" }]) {
    const response = await h.apiPOST(jsonRequest(commandBody({ ...base, task: { ...base.task, ...extra } })));
    assert.equal(response.status, 422);
    assert.equal(mutations(h).length, 0);
  }
  const result = await h.mutateArchive(OWNER, commandBody(base));
  assert.equal(result.library?.data.tasks[0].source, "user_input");
  assert.equal(result.library?.data.tasks[0].queryStatus, "unsupported");
  assert.equal(result.library?.data.tasks[0].status, "completed");
});

test("task attachment references require the owner, library and exact task scope", async () => {
  const h = await harness();
  h.state.tables.music_archive_libraries = [libraryRow()];
  h.state.tables.music_archive_attachments = [{ id: ATTACHMENT, owner_id: OTHER_OWNER, library_id: LIBRARY, task_id: "task:track-one", deleted_at: null }];
  const command = { type: "save_tasks", id: "task", trackIds: ["track-one"], task: { kind: "karaoke", agency: "TJ", status: "completed", result: "listed", attachmentIds: [ATTACHMENT] } };
  await assert.rejects(() => h.mutateArchive(OWNER, commandBody(command)), status(403));
  h.state.tables.music_archive_attachments[0].owner_id = OWNER;
  h.state.tables.music_archive_attachments[0].task_id = "different-task";
  await assert.rejects(() => h.mutateArchive(OWNER, commandBody(command)), status(403));
  assert.equal(mutations(h).length, 0);
  const query = h.calls.find(call => call.table === "music_archive_attachments")!;
  assert.ok(hasFilter(query, "owner_id", OWNER));
  assert.ok(hasFilter(query, "library_id", LIBRARY));
});

test("real API routes reject unauthenticated, cross-site, rate-limited and non-admin access before writes", async () => {
  const h = await harness();
  h.state.user = null;
  const anonymous = await h.apiGET(new Request("https://onside.test/api/music-archive"));
  assert.equal(anonymous.status, 401);
  h.state.user = { id: OWNER };
  const crossSite = await h.apiPOST(jsonRequest({ action: "create", name: "Unwanted" }, { origin: "https://attacker.test" }));
  assert.equal(crossSite.status, 403);
  const crossFetch = await h.apiPOST(jsonRequest({ action: "create", name: "Unwanted" }, { "sec-fetch-site": "cross-site" }));
  assert.equal(crossFetch.status, 403);
  const denied = await h.apiPOST(jsonRequest({ action: "admin-guide", guide: { id: "tj", visible: false } }));
  assert.equal(denied.status, 403);
  const adminRead = await h.apiGET(new Request("https://onside.test/api/music-archive?action=admin"));
  assert.equal(adminRead.status, 403);
  h.state.limited = true;
  assert.equal((await h.apiPOST(jsonRequest({ action: "create", name: "Limited" }))).status, 429);
  assert.equal(mutations(h).length, 0);
});

test("admin guide updates preserve array/text types and reject nonofficial, credentialed and insecure URLs", async () => {
  const h = await harness();
  h.state.isAdmin = true;
  for (const guide of [{ id: "tj", url: "https://attacker.test/apply" }, { id: "tj", url: "https://user@www.tjmedia.com/song/accompaniment" }, { id: "tj", url: "http://www.tjmedia.com/song/accompaniment" }, { id: "tj", steps: "wrong type" }, { id: "tj", name: ["wrong type"] }]) {
    const response = await h.apiPOST(jsonRequest({ action: "admin-guide", guide }));
    assert.ok([400, 422].includes(response.status));
    assert.equal(mutations(h).length, 0);
  }
  const response = await h.apiPOST(jsonRequest({ action: "admin-guide", guide: { id: "tj", visible: false, steps: ["공식 안내를 확인하세요."], checkedAt: "2026-09-08" } }));
  assert.equal(response.status, 200);
  assert.equal(mutations(h)[0].name, "save_music_archive_guide");
  assert.equal(mutations(h)[0].args?.p_actor, OWNER);
});

test("evidence download checks attachment and library ownership before touching private object storage", async () => {
  const h = await harness();
  h.state.tables.music_archive_libraries = [libraryRow(), libraryRow(OTHER_OWNER, OTHER_LIBRARY)];
  const row = { id: ATTACHMENT, owner_id: OTHER_OWNER, library_id: LIBRARY, object_key: `test/review-doc-jobs/${OWNER}/${LIBRARY}/${ATTACHMENT}`, deleted_at: null, file_name: "증빙.pdf", mime_type: "application/pdf" };
  h.state.tables.music_archive_attachments = [row];
  assert.equal((await h.evidenceGET(new Request(`https://onside.test/api/music-archive/evidence?id=${ATTACHMENT}`))).status, 404);
  assert.equal(h.calls.filter(call => call.method === "storage").length, 0);
  row.owner_id = OWNER; row.library_id = OTHER_LIBRARY;
  assert.equal((await h.evidenceGET(new Request(`https://onside.test/api/music-archive/evidence?id=${ATTACHMENT}`))).status, 404);
  assert.equal(h.calls.filter(call => call.method === "storage").length, 0);
  row.library_id = LIBRARY; row.object_key = `test/review-doc-jobs/${OTHER_OWNER}/${LIBRARY}/${ATTACHMENT}`;
  const wrongKey = await h.evidenceGET(new Request(`https://onside.test/api/music-archive/evidence?id=${ATTACHMENT}`));
  assert.notEqual(wrongKey.status, 200);
  assert.equal(h.calls.filter(call => call.method === "storage").length, 0, "real assertReviewObjectKey must reject a mismatched object namespace");
});

test("authorized evidence response forces attachment, private no-store, nosniff and sandbox headers", async () => {
  const h = await harness();
  h.state.tables.music_archive_libraries = [libraryRow()];
  h.state.tables.music_archive_attachments = [{ id: ATTACHMENT, owner_id: OWNER, library_id: LIBRARY, object_key: `test/review-doc-jobs/${OWNER}/${LIBRARY}/${ATTACHMENT}`, deleted_at: null, file_name: '한글"증빙.pdf', mime_type: "application/pdf" }, { id: OTHER_ATTACHMENT, owner_id: OTHER_OWNER, library_id: LIBRARY, deleted_at: null }];
  const response = await h.evidenceGET(new Request(`https://onside.test/api/music-archive/evidence?id=${ATTACHMENT}`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), "sandbox");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(await response.text(), "%PDF-test");
  assert.equal(h.calls.filter(call => call.method === "storage").length, 1);
});

test("provider configuration and database failures keep their truthful status and do not leak infrastructure details", async () => {
  const h = await harness();
  const unsupported = await h.searchArchiveArtists(OWNER, new URLSearchParams({ provider: "spotify", q: "Artist" }));
  assert.equal(unsupported.queryStatus, "unsupported");
  const previous = process.env.MUSICBRAINZ_COMMERCIAL_USE_APPROVED;
  try {
    delete process.env.MUSICBRAINZ_COMMERCIAL_USE_APPROVED;
    const unconfigured = await h.searchArchiveArtists(OWNER, new URLSearchParams({ provider: "musicbrainz", q: "Artist" }));
    assert.equal(unconfigured.queryStatus, "forbidden");
    assert.equal((unconfigured as { code: string }).code, "permission_required");
    assert.equal(mutations(h).length, 0);
  } finally { if (previous === undefined) delete process.env.MUSICBRAINZ_COMMERCIAL_USE_APPROVED; else process.env.MUSICBRAINZ_COMMERCIAL_USE_APPROVED = previous; }
  h.state.databaseError = { code: "42P01", message: "secret_table password=do-not-leak" };
  const response = await h.apiGET(new Request(`https://onside.test/api/music-archive?libraryId=${LIBRARY}`));
  assert.equal(response.status, 503);
  const payload = await response.json() as { code: string; error: string };
  assert.equal(payload.code, "MIGRATION_REQUIRED");
  assert.doesNotMatch(payload.error, /secret_table|password|do-not-leak/);
});

test("related work-recording-track edits commit once and invalid final relations leave no partial rows", async () => {
  const h = await harness();
  h.state.tables.music_archive_libraries = [libraryRow()];
  const commands = [
    { type: "save_work", work: { id: "work-new", title: "Work", writers: "Author" } },
    { type: "save_recording", recording: { id: "recording-new", title: "Recording", workIds: ["work-new"] } },
    { type: "update_track", trackId: "missing-track", patch: { recordingId: "recording-new" } },
  ];
  await assert.rejects(() => h.mutateArchive(OWNER, { action: "commands", libraryId: LIBRARY, version: 1, commands }));
  assert.equal(mutations(h).length, 0);
  assert.equal((h.state.tables.music_archive_libraries[0].data as ArchiveData).works.length, 0);
  commands[2] = { type: "update_track", trackId: "track-one", patch: { recordingId: "recording-new" } };
  const result = await h.mutateArchive(OWNER, { action: "commands", libraryId: LIBRARY, version: 1, commands });
  assert.equal(result.library?.data.tracks[0].recordingId, "recording-new");
  assert.equal(result.library?.data.recordings[0].workIds[0], "work-new");
  assert.equal(mutations(h).length, 1);
  assert.equal(mutations(h)[0].name, "save_music_archive_library");
});
