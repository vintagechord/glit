import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createArchiveData, type ArchiveLibrary } from "../src/lib/music-archive/model";

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER = "10000000-0000-4000-8000-000000000002";
const LIBRARY = "20000000-0000-4000-8000-000000000001";
type Row = Record<string, unknown>;
type Call = { method: string; table?: string; name?: string; args?: Row; url?: string; operations?: { method: string; args: unknown[] }[] };
type Harness = typeof import("../src/lib/music-archive/service") & typeof import("../src/lib/music-archive/catalog-search") & {
  state: {
    user: { id: string } | null; tables: Record<string, Row[]>; limitedNamespaces: string[];
    appleSearchRows: Row[]; appleLookupRows: Row[]; appleStatus: number;
    failure: { table: string; operation: string; code: string; message: string } | null;
  };
  calls: Call[];
  fetcher: typeof fetch;
  apiGET: (request: Request) => Promise<Response>;
  apiPOST: (request: Request) => Promise<Response>;
};

// Keep the real route, catalog, Apple response parser, service, model and sync queue.
// Only HTTP, Supabase, rate-limit storage and Next's after scheduler are replaced.
const bundle = build({
  stdin: { contents: `export * from './src/lib/music-archive/service'; export * from './src/lib/music-archive/catalog-search'; export {GET as apiGET, POST as apiPOST} from './src/app/api/music-archive/route'; export {state,calls,fetcher} from 'catalog-service-fixture';`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "catalog-service-infrastructure", setup(plugin) {
    plugin.onResolve({ filter: /^(catalog-service-fixture|@\/lib\/supabase\/(?:admin|server)|@\/lib\/request-rate-limit|next\/server)$/ }, ({ path }) => ({ path, namespace: "catalog-fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "catalog-fixture" }, ({ path }) => {
      const shared = `import {state,calls,client} from 'catalog-service-fixture';`;
      const files: Record<string, string> = {
        "catalog-service-fixture": `
          export const state={user:{id:'${OWNER}'},tables:{},limitedNamespaces:[],appleSearchRows:[],appleLookupRows:[],appleStatus:200,failure:null};
          export const calls=[];
          function like(value,pattern){
            if(typeof value!=='string'||!pattern.endsWith('%'))throw new Error('Unsupported fixture LIKE');
            return value.startsWith(pattern.slice(0,-1));
          }
          function query(table){
            const operations=[]; const q={};
            for(const method of ['select','eq','is','in','gt','lt','like','or','order','limit','upsert','insert','update','delete'])q[method]=(...args)=>{operations.push({method,args});return q;};
            function run(single=false){
              calls.push({method:'query',table,operations:structuredClone(operations)});
              if(state.failure?.table===table&&operations.some(op=>op.method===state.failure.operation))return {data:null,error:state.failure};
              const all=state.tables[table]??=[];
              let rows=[...all];
              for(const {method,args:[key,value]} of operations){
                if(method==='eq')rows=rows.filter(row=>row[key]===value);
                if(method==='is')rows=rows.filter(row=>value===null?row[key]==null:row[key]===value);
                if(method==='in')rows=rows.filter(row=>value.includes(row[key]));
                if(method==='gt')rows=rows.filter(row=>row[key]>value);
                if(method==='lt')rows=rows.filter(row=>row[key]<value);
                if(method==='like')rows=rows.filter(row=>like(row[key],value));
                if(method==='or'){
                  const branches=key.split(',').map(branch=>{
                    const match=branch.match(/^([a-z_]+)\\.like\\.(.+)$/);
                    if(!match)throw new Error('Unsupported fixture OR');return match;
                  });
                  rows=rows.filter(row=>branches.some(([,field,pattern])=>like(row[field],pattern)));
                }
              }
              for(const {method,args} of operations){
                if(method==='insert'||method==='upsert'){
                  const entries=Array.isArray(args[0])?args[0]:[args[0]]; rows=[];
                  const fields=(args[1]?.onConflict??'query_key').split(',');
                  for(const entry of entries){
                    const existing=method==='upsert'?all.find(row=>fields.every(field=>row[field]===entry[field])):null;
                    if(existing){Object.assign(existing,structuredClone(entry));rows.push(existing);}
                    else{const inserted=structuredClone(entry);all.push(inserted);rows.push(inserted);}
                  }
                }
                if(method==='update')for(const row of rows)Object.assign(row,structuredClone(args[0]));
                if(method==='delete')state.tables[table]=all.filter(row=>!rows.includes(row));
                if(method==='order')rows.sort((a,b)=>String(a[args[0]]).localeCompare(String(b[args[0]]))*(args[1]?.ascending===false?-1:1));
                if(method==='limit')rows=rows.slice(0,args[0]);
              }
              return {data:structuredClone(single?(rows[0]??null):rows),error:null};
            }
            q.maybeSingle=()=>Promise.resolve(run(true));q.single=()=>Promise.resolve(run(true));q.then=(ok,fail)=>Promise.resolve(run()).then(ok,fail);
            return q;
          }
          export const client={from:query,rpc:async(name,args)=>{
            calls.push({method:'rpc',name,args:structuredClone(args)});
            if(name==='reserve_music_archive_provider_slot')return {data:0,error:null};
            if(name==='save_music_archive_library'){
              const row=(state.tables.music_archive_libraries??[]).find(row=>row.id===args.p_id&&row.owner_id===args.p_owner);
              if(!row)return {data:null,error:{message:'OWNER_NOT_FOUND'}};
              if(row.version!==args.p_version)return {data:null,error:{code:'40001',message:'VERSION_CONFLICT'}};
              row.data=structuredClone(args.p_data);row.version++;row.archived_at=args.p_archived_at;
              return {data:structuredClone(row),error:null};
            }
            throw new Error('Unexpected database RPC '+name);
          }};
          export async function fetcher(input,init){
            const url=new URL(String(input));calls.push({method:'fetch',url:url.toString()});
            if(url.origin!=='https://itunes.apple.com'||!['/search','/lookup'].includes(url.pathname)||init?.method&&init.method!=='GET')throw new Error('Unexpected external request');
            const rows=url.pathname==='/search'?state.appleSearchRows:state.appleLookupRows;
            return new Response(JSON.stringify({resultCount:rows.length,results:rows}),{status:state.appleStatus,headers:{'content-type':'application/json'}});
          }
        `,
        "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>client;`,
        "@/lib/supabase/server": `${shared} export async function createServerSupabase(){return {auth:{getUser:async()=>({data:{user:state.user},error:null})},rpc:async()=>({data:false,error:null})};}`,
        "@/lib/request-rate-limit": `${shared} export function consumeRateLimit(args){calls.push({method:'rate',args});return {allowed:!state.limitedNamespaces.includes(args.namespace),retryAfterSeconds:60};}`,
        "next/server": `${shared} export function after(){calls.push({method:'after'});}`,
      };
      return { loader: "js", contents: files[path] };
    });
  } }],
});

async function harness() {
  const result = await bundle;
  const loaded = { exports: {} as Harness };
  const fetcher: typeof fetch = (...args) => loaded.exports.fetcher(...args);
  new Function("require", "module", "exports", "fetch", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, fetcher);
  return loaded.exports;
}
function artist(id: number, name = `김아티스트 ${id}`, slug = name): Row {
  return { wrapperType: "artist", artistType: "Artist", artistId: id, artistName: name, primaryGenreName: "K-Pop", artistLinkUrl: `https://music.apple.com/kr/artist/${encodeURIComponent(slug)}/${id}` };
}
function library(): Row {
  return { id: LIBRARY, owner_id: OWNER, version: 1, data: createArchiveData("Member private working name"), archived_at: null, created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z" };
}
const search = (q: string, offset = 0) => new URLSearchParams({ q, offset: String(offset) });
const fetches = (h: Harness) => h.calls.filter(call => call.method === "fetch");
const permits = (h: Harness) => h.calls.filter(call => call.name === "reserve_music_archive_provider_slot");
const operation = (call: Call, name: string) => call.operations?.some(op => op.method === name);
const post = (body: unknown) => new Request("https://onside.test/api/music-archive", { method: "POST", headers: { origin: "https://onside.test", "content-type": "application/json" }, body: JSON.stringify(body) });
const connect = { action: "connect", libraryId: LIBRARY, version: 1, provider: "apple", url: "https://music.apple.com/kr/artist/100" };

test("cached artist search serves disjoint 20-result pages across normalized queries and members with one provider call", async () => {
  const h = await harness();
  h.state.appleSearchRows = Array.from({ length: 45 }, (_, i) => artist(100 + i));
  const response = await h.apiGET(new Request(`https://onside.test/api/music-archive?action=search&${search("김 아티스트")}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  const first = await response.json() as Awaited<ReturnType<Harness["searchArchiveArtists"]>>;
  const second = await h.searchArchiveArtists(OTHER_OWNER, search("김-아티스트", 20));
  const third = await h.searchArchiveArtists(OWNER, search("김아티스트", 40));
  assert.deepEqual([first.items.length, second.items.length, third.items.length], [20, 20, 5]);
  assert.deepEqual([first.nextOffset, second.nextOffset, third.nextOffset], [20, 40, null]);
  assert.deepEqual([first.total, second.total, third.total], [45, 45, 45]);
  assert.deepEqual([...first.items, ...second.items, ...third.items].map(item => item.externalId), Array.from({ length: 45 }, (_, i) => String(100 + i)));
  assert.equal(fetches(h).length, 1);
  assert.equal(permits(h).length, 1);
  const url = new URL(fetches(h)[0].url!);
  assert.equal(url.searchParams.get("limit"), "200");
  assert.equal(url.searchParams.get("country"), "KR");
  assert.equal(url.searchParams.has("offset"), false);
  assert.equal(h.state.tables.music_archive_search_cache.length, 1);
  assert.equal(h.state.tables.music_archive_artist_index.length, 45);
  assert.doesNotMatch(JSON.stringify([h.state.tables.music_archive_search_cache, h.state.tables.music_archive_artist_index]), new RegExp(`${OWNER}|${OTHER_OWNER}`));
  assert.ok(h.calls.every(call => !call.table || ["music_archive_search_cache", "music_archive_artist_index"].includes(call.table)));
});

test("expired catalog cache is refreshed and an empty official response is cached without invented candidates", async () => {
  const h = await harness();
  h.state.appleSearchRows = [artist(100)];
  await h.searchArchiveArtists(OWNER, search("김아티스트"));
  h.state.tables.music_archive_search_cache[0].expires_at = "2000-01-01T00:00:00Z";
  h.state.appleSearchRows = [];
  const refreshed = await h.searchArchiveArtists(OWNER, search("김아티스트"));
  const cachedEmpty = await h.searchArchiveArtists(OTHER_OWNER, search("김 아티스트"));
  assert.equal(refreshed.queryStatus, "no_results");
  assert.deepEqual(cachedEmpty.items, []);
  assert.equal(cachedEmpty.nextOffset, null);
  assert.equal(fetches(h).length, 2);
  assert.equal(h.state.tables.music_archive_search_cache.length, 1);
});

test("initial search reads only the public index, matches alternate Korean names and caps suggestions at 20", async () => {
  const h = await harness();
  const candidates = Array.from({ length: 24 }, (_, i) => ({ provider: "apple" as const, externalId: String(100 + i), name: i === 0 ? "Kim Singer" : `김수아 ${i}`, sortName: "김수아", disambiguation: "", country: "", type: "", url: `https://music.apple.com/kr/artist/${100 + i}`, imageUrl: null, representativeRelease: null }));
  await h.indexCatalogArtists(candidates, "2026-09-08T00:00:00Z");
  h.state.tables.music_archive_libraries = [library()];
  h.state.tables.submissions = [{ artist_name: "김수아 private submission", user_id: OTHER_OWNER }];
  h.calls.length = 0;
  const result = await h.searchArchiveArtists(OWNER, search("ㄱ ㅅ ㅇ"));
  assert.equal(result.items.length, 20);
  assert.equal(result.nextOffset, null);
  assert.equal(result.items[0].externalId, "100", "English display name remains discoverable through its public Korean alias");
  assert.equal(new Set(result.items.map(item => item.externalId)).size, 20);
  assert.equal(fetches(h).length, 0);
  assert.equal(permits(h).length, 0);
  const queries = h.calls.filter(call => call.method === "query");
  assert.deepEqual(queries.map(call => call.table), ["music_archive_artist_index"]);
  assert.ok(queries.every(call => !["insert", "upsert", "update", "delete"].some(name => operation(call, name))));
  assert.doesNotMatch(JSON.stringify(result), /private|Member private/);
});

test("an initial query with no indexed match returns no results without falling through to network or private libraries", async () => {
  const h = await harness();
  h.state.tables.music_archive_libraries = [library()];
  const result = await h.searchArchiveArtists(OWNER, search("ㅂㅌㅅㄴㄷ"));
  assert.deepEqual(result.items, []);
  assert.equal(result.queryStatus, "no_results");
  assert.equal(fetches(h).length, 0);
  assert.equal(permits(h).length, 0);
  assert.deepEqual(h.calls.filter(call => call.table).map(call => call.table), ["music_archive_artist_index"]);
});

test("Apple connection validates the selected artist, saves ownership-scoped data, queues collection and returns 202", async () => {
  const h = await harness();
  h.state.tables.music_archive_libraries = [library()];
  h.state.appleLookupRows = [artist(100, "Kim Singer", "김수아")];
  h.state.tables.music_archive_jobs = [
    { id: "old-own", owner_id: OWNER, library_id: LIBRARY, provider: "apple", external_artist_id: "200", status: "queued" },
    { id: "other-member", owner_id: OTHER_OWNER, library_id: LIBRARY, provider: "apple", status: "queued" },
    { id: "other-provider", owner_id: OWNER, library_id: LIBRARY, provider: "musicbrainz", status: "queued" },
  ];
  const response = await h.apiPOST(post(connect));
  assert.equal(response.status, 202);
  const body = await response.json() as { library: ArchiveLibrary; job: Row; runLibraryId: string };
  assert.equal(body.library.version, 2);
  assert.equal(body.library.data.artist.name, "Member private working name");
  assert.equal(body.library.data.connections[0].externalArtistId, "100");
  assert.equal(body.library.data.connections[0].confirmed, true);
  assert.equal(body.runLibraryId, undefined, "worker routing stays on the server");
  assert.equal(body.job.external_artist_id, undefined);
  assert.equal(body.job.status, "queued");
  assert.equal(body.job.owner_id, undefined);
  assert.equal(h.state.tables.music_archive_jobs.find(row => row.id === body.job.id)?.external_artist_id, "100");
  assert.deepEqual(h.state.tables.music_archive_jobs.slice(0, 3).map(row => row.status), ["queued", "queued", "queued"]);
  assert.equal(h.calls.filter(call => call.method === "after").length, 1);
  assert.equal(h.calls.filter(call => call.name === "save_music_archive_library").length, 1);
  assert.equal(fetches(h).length, 1);
  assert.equal(new URL(fetches(h)[0].url!).searchParams.get("id"), "100");
  assert.doesNotMatch(JSON.stringify(h.state.tables.music_archive_artist_index), /Member private working name/);
  assert.equal((h.state.tables.music_archive_artist_index[0].payload as Row).name, "김수아");
});

for (const failure of ["rate-limit", "queue-insert"] as const) {
  test(`Apple connection remains successfully saved with a retry notice when enqueue fails at ${failure}`, async () => {
    const h = await harness();
    h.state.tables.music_archive_libraries = [library()];
    h.state.appleLookupRows = [artist(100)];
    if (failure === "rate-limit") h.state.limitedNamespaces = ["archive-sync"];
    else h.state.failure = { table: "music_archive_jobs", operation: "insert", code: "XX000", message: "private infrastructure failure" };
    const response = await h.apiPOST(post(connect));
    assert.equal(response.status, 200);
    const body = await response.json() as { library: ArchiveLibrary; syncNotice?: string; job?: unknown; runLibraryId?: string };
    assert.equal(body.library.version, 2);
    assert.equal(body.library.data.connections[0].externalArtistId, "100");
    assert.equal(h.state.tables.music_archive_libraries[0].version, 2);
    assert.ok(body.syncNotice);
    assert.equal(body.job, undefined);
    assert.equal(body.runLibraryId, undefined);
    assert.equal(h.calls.filter(call => call.method === "after").length, 0);
    assert.equal(h.calls.filter(call => call.name === "save_music_archive_library").length, 1);
    assert.doesNotMatch(JSON.stringify(body), /private infrastructure failure/);
  });
}

test("an Apple lookup returning a different artist ID cannot save a connection or start collection", async () => {
  const h = await harness();
  h.state.tables.music_archive_libraries = [library()];
  h.state.appleLookupRows = [artist(999)];
  const response = await h.apiPOST(post(connect));
  assert.equal(response.ok, false);
  assert.equal(h.state.tables.music_archive_libraries[0].version, 1);
  assert.equal(h.calls.filter(call => call.name === "save_music_archive_library").length, 0);
  assert.equal(h.calls.filter(call => call.method === "after").length, 0);
  assert.equal(h.calls.filter(call => call.table === "music_archive_jobs").length, 0);
  assert.equal(h.calls.filter(call => call.table === "music_archive_artist_index").length, 0);
});

test("failure to cancel a removed profile preserves the saved removal and never cancels another profile", async () => {
  const h = await harness();
  const row = library();
  const data = row.data as ArchiveLibrary["data"];
  data.connections = ["100", "200"].map(id => ({ provider: "apple", externalArtistId: id, url: `https://music.apple.com/kr/artist/${id}`, confirmed: true, status: "automatic" }));
  h.state.tables.music_archive_libraries = [row];
  h.state.tables.music_archive_jobs = [{ id: "prior", owner_id: OWNER, library_id: LIBRARY, provider: "apple", external_artist_id: "100", status: "queued" }];
  h.state.failure = { table: "music_archive_jobs", operation: "update", code: "XX000", message: "private cancellation error" };
  const response = await h.apiPOST(post({ action: "command", libraryId: LIBRARY, version: 1, command: { type: "remove_connection", provider: "apple", externalArtistId: "100" } }));
  assert.equal(response.status, 200);
  const body = await response.json() as { library: ArchiveLibrary; syncNotice?: string; job?: unknown };
  assert.equal(body.library.version, 2);
  assert.deepEqual(body.library.data.connections.map(item => item.externalArtistId), ["200"]);
  assert.ok(body.syncNotice);
  assert.equal(body.job, undefined);
  assert.equal(h.state.tables.music_archive_jobs[0].status, "queued");
  const update = h.calls.find(call => call.table === "music_archive_jobs" && operation(call, "update"));
  assert.ok(update?.operations?.some(op => op.method === "eq" && op.args[0] === "external_artist_id" && op.args[1] === "100"));
  assert.equal(h.calls.filter(call => call.table === "music_archive_jobs" && operation(call, "insert")).length, 0);
  assert.doesNotMatch(JSON.stringify(body), /private cancellation error/);
});

test("connecting a second confirmed profile preserves the first queue and a provider-wide sync returns both without duplicates", async () => {
  const h = await harness();
  h.state.tables.music_archive_libraries = [library()];
  h.state.appleLookupRows = [artist(100)];
  const first = await (await h.apiPOST(post(connect))).json() as { library: ArchiveLibrary; job: Row };
  h.state.appleLookupRows = [artist(200)];
  const second = await (await h.apiPOST(post({ ...connect, version: first.library.version, url: "https://music.apple.com/kr/artist/200" }))).json() as { library: ArchiveLibrary; job: Row; jobs: Row[] };
  assert.deepEqual(second.library.data.connections.map(item => item.externalArtistId), ["100", "200"]);
  assert.equal(second.job.external_artist_id, undefined);
  assert.equal(h.state.tables.music_archive_jobs.find(row => row.id === second.job.id)?.external_artist_id, "200");
  assert.deepEqual(second.jobs.map(item => item.id), [second.job.id]);
  assert.deepEqual(h.state.tables.music_archive_jobs.map(item => [item.external_artist_id, item.status]), [["100", "queued"], ["200", "queued"]]);
  const all = await (await h.apiPOST(post({ action: "sync", libraryId: LIBRARY, provider: "apple" }))).json() as { jobs: Row[] };
  assert.deepEqual(new Set(all.jobs.map(item => item.id)), new Set(h.state.tables.music_archive_jobs.map(item => item.id)));
  assert.equal(h.state.tables.music_archive_jobs.length, 2);
  assert.equal(h.calls.filter(call => call.table === "music_archive_jobs" && operation(call, "update")).length, 0);
  const repeat = await h.apiPOST(post({ ...connect, version: second.library.version, url: "https://music.apple.com/kr/artist/200" }));
  assert.equal(repeat.status, 202);
  assert.equal(h.state.tables.music_archive_jobs.length, 2);
  assert.equal((h.state.tables.music_archive_libraries[0].data as ArchiveLibrary["data"]).connections.length, 2);
});

test("the second same-provider profile resumes by exact identity and removing it cancels only its own queued work", async () => {
  const h = await harness();
  const row = library();
  (row.data as ArchiveLibrary["data"]).connections = ["100", "200"].map(id => ({ provider: "apple", externalArtistId: id, url: `https://music.apple.com/kr/artist/${id}`, confirmed: true, status: "automatic" }));
  h.state.tables.music_archive_libraries = [row];
  const idA = "30000000-0000-4000-8000-000000000001";
  const idB = "30000000-0000-4000-8000-000000000002";
  h.state.tables.music_archive_jobs = [idA, idB].map((id,i) => ({ id, owner_id: OWNER, library_id: LIBRARY, provider: "apple", external_artist_id: i ? "200" : "100", status: i ? "partial" : "queued", available_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z", cursor: {}, counts: {} }));
  const resumed = await h.apiPOST(post({ action: "resume", jobId: idB }));
  assert.equal(resumed.status, 202);
  assert.equal(h.state.tables.music_archive_jobs[1].status, "queued");
  const removed = await h.apiPOST(post({ action: "command", libraryId: LIBRARY, version: 1, command: { type: "remove_connection", provider: "apple", externalArtistId: "200" } }));
  assert.equal(removed.status, 200);
  assert.deepEqual(h.state.tables.music_archive_jobs.map(item => item.status), ["queued", "cancelled"]);
  assert.deepEqual((h.state.tables.music_archive_libraries[0].data as ArchiveLibrary["data"]).connections.map(item => item.externalArtistId), ["100"]);
});
