import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { applyArchiveCommand, createArchiveData, validateArchiveData, type ArchiveLibrary, type ArchiveSyncJob } from "../src/lib/music-archive/model";

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER = "10000000-0000-4000-8000-000000000002";
const LIBRARY = "20000000-0000-4000-8000-000000000001";
const OTHER_LIBRARY = "20000000-0000-4000-8000-000000000002";
const JOB = "30000000-0000-4000-8000-000000000001";
const checked = "2026-10-28T00:00:00Z";
type Row = Record<string, unknown>;
type Operation = { method: string; args: unknown[] };
type Call = { kind: string; table?: string; name?: string; operations?: Operation[]; args?: Row; url?: string };
type Harness = typeof import("../src/lib/music-archive/sync") & {
  state: { libraries: ArchiveLibrary[]; jobs: ArchiveSyncJob[]; submissions: Row[]; sources: Row[]; pages: Record<string, string>; failSourceId: string | null; archiveOnFetch: boolean };
  calls: Call[];
  fetcher: typeof fetch;
};

// Keep the actual worker, provider request/parser, merge, credit query, owner
// checks and retry logic. Replace only transport/storage. The database fixture
// validates enum literals before filtering, as PostgreSQL does even on zero rows.
const bundle = build({
  stdin: { contents: `export * from './src/lib/music-archive/sync'; export {state,calls,fetcher} from 'archive-sync-fixture';`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "archive-worker-infrastructure", setup(plugin) {
    plugin.onResolve({ filter: /^(archive-sync-fixture|@\/lib\/supabase\/(?:admin|server)|@\/lib\/request-rate-limit)$/ }, ({ path }) => ({ path, namespace: "sync-fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "sync-fixture" }, ({ path }) => {
      const files: Record<string, string> = {
        "archive-sync-fixture": `
          export const state={libraries:[],jobs:[],submissions:[],sources:[],pages:{},failSourceId:null,archiveOnFetch:false};
          export const calls=[];
          const submissionStatuses=new Set(['DRAFT','SUBMITTED','PRE_REVIEW','WAITING_PAYMENT','IN_PROGRESS','RESULT_READY','COMPLETED']);
          const storage=table=>({music_archive_libraries:state.libraries,music_archive_jobs:state.jobs,submissions:state.submissions,music_archive_sources:state.sources})[table];
          function query(table){
            const operations=[]; const q={}; let singular=false;
            for(const method of ['select','eq','is','in','not','order','range','upsert','update'])q[method]=(...args)=>{operations.push({method,args});return q;};
            function run(){
              calls.push({kind:'query',table,operations:structuredClone(operations)});
              const all=storage(table); if(!all)throw new Error('Unexpected fixture table '+table);
              // Invalid enum constants fail the SQL expression before any row,
              // owner predicate or LIMIT is considered, matching production.
              if(table==='submissions')for(const {method,args:[field,operator,value]} of operations){
                if(field!=='status')continue;
                const values=method==='not'&&operator==='in'?value.slice(1,-1).split(','):method==='in'?operator:method==='eq'?[operator]:[];
                const invalid=values.find(value=>!submissionStatuses.has(value));
                if(invalid)return {data:null,error:{code:'22P02',message:'invalid input value for enum submission_status: "'+invalid+'"'}};
              }
              let rows=[...all];
              for(const {method,args:[field,value,extra]} of operations){
                if(method==='eq')rows=rows.filter(row=>row[field]===value);
                if(method==='is')rows=rows.filter(row=>value===null?row[field]==null:row[field]===value);
                if(method==='in')rows=rows.filter(row=>value.includes(row[field]));
                if(method==='not'&&value==='in')rows=rows.filter(row=>!extra.slice(1,-1).split(',').includes(row[field]));
                if(method==='order')rows.sort((a,b)=>String(a[field]).localeCompare(String(b[field]))*(value?.ascending===false?-1:1));
                if(method==='range')rows=rows.slice(field,value+1);
              }
              for(const {method,args} of operations){
                if(method==='update')for(const row of rows)Object.assign(row,structuredClone(args[0]));
                if(method==='upsert'){
                  const entry=args[0];
                  if(state.failSourceId===entry.external_id){state.failSourceId=null;return {data:null,error:{code:'XX000',message:'private-db-secret: simulated source persistence failure'}};}
                  const keys=args[1].onConflict.split(','); const existing=all.find(row=>keys.every(key=>row[key]===entry[key]));
                  if(existing)Object.assign(existing,structuredClone(entry));else all.push(structuredClone(entry));
                  rows=[entry];
                }
              }
              return {data:structuredClone(singular?(rows[0]??null):rows),error:null};
            }
            q.maybeSingle=()=>{singular=true;return q;};q.single=()=>{singular=true;return q;};q.then=(ok,fail)=>Promise.resolve().then(run).then(ok,fail);
            return q;
          }
          export const client={from:query,rpc:async(name,args)=>{
            calls.push({kind:'rpc',name,args:structuredClone(args)});
            if(name==='reserve_music_archive_provider_slot')return {data:0,error:null};
            if(name==='lease_music_archive_job'){
              const job=state.jobs.find(job=>(!args.p_library_id||job.library_id===args.p_library_id)&&job.status==='queued'&&Date.parse(job.available_at)<=Date.now());
              if(!job)return {data:[],error:null};
              Object.assign(job,{status:'running',lease_token:args.p_lease_token,lease_until:new Date(Date.now()+90_000).toISOString(),attempts:job.attempts+1,updated_at:new Date().toISOString()});
              return {data:[structuredClone(job)],error:null};
            }
            if(name==='commit_music_archive_step'){
              const job=state.jobs.find(job=>job.id===args.p_job);
              const library=state.libraries.find(library=>library.id===job?.library_id&&library.owner_id===job.owner_id);
              if(!job||job.status!=='running'||job.lease_token!==args.p_token||Date.parse(job.lease_until)<=Date.now())return {data:null,error:{code:'40001',message:'MUSIC_ARCHIVE_LEASE_LOST'}};
              if(!library||library.version!==args.p_version)return {data:null,error:{code:'40001',message:'MUSIC_ARCHIVE_VERSION_CONFLICT'}};
              if(!library.data.connections.some(connection=>connection.provider===job.provider&&connection.externalArtistId===job.external_artist_id&&connection.confirmed))throw new Error('Unexpected missing connection');
              library.data=structuredClone(args.p_data);library.version++;
              Object.assign(job,{cursor:structuredClone(args.p_cursor),counts:structuredClone(args.p_counts),status:args.p_status,checked_at:args.p_checked_at,lease_token:null,lease_until:null,error_code:null,error_message:null,available_at:new Date().toISOString(),updated_at:new Date().toISOString()});
              return {data:structuredClone(job),error:null};
            }
            throw new Error('Unexpected fixture RPC '+name);
          }};
          export async function fetcher(input,init){
            const url=new URL(String(input));calls.push({kind:'fetch',url:url.toString()});
            if(!['https://www.melon.com','https://www.genie.co.kr'].includes(url.origin)||init?.method&&init.method!=='GET')throw new Error('Unexpected external request');
            const key=url.pathname+'?'+(url.searchParams.get('albumId')??url.searchParams.get('axnm')??url.searchParams.get('artistId')??url.searchParams.get('xxnm')??url.searchParams.get('songId')??url.searchParams.get('xgnm'));
            if(!(key in state.pages))throw new Error('Missing fixture public page '+key);
            if(state.archiveOnFetch)state.libraries[0].archived_at=new Date().toISOString();
            return new Response(state.pages[key]);
          }
        `,
        "@/lib/supabase/admin": `import {client} from 'archive-sync-fixture'; export const createAdminClient=()=>client;`,
        "@/lib/supabase/server": `export const createServerSupabase=()=>{throw new Error('Worker must not use browser session authorization');};`,
        "@/lib/request-rate-limit": `export const consumeRateLimit=()=>({allowed:true});`,
      };
      return { loader: "js", contents: files[path] };
    });
  } }],
});

async function harness(provider: "melon" | "genie" = "melon", ids = ["100"]) {
  const result = await bundle;
  const loaded = { exports: {} as Harness };
  const fetcher: typeof fetch = (...args) => loaded.exports.fetcher(...args);
  new Function("require", "module", "exports", "fetch", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, fetcher);
  const h = loaded.exports;
  const data = applyArchiveCommand(createArchiveData("우리 가수"), { type: "set_connection", connection: { provider, externalArtistId: "12", confirmed: true } });
  h.state.libraries.push({ id: LIBRARY, owner_id: OWNER, version: 1, data, archived_at: null, created_at: checked, updated_at: checked });
  h.state.jobs.push({ id: JOB, library_id: LIBRARY, owner_id: OWNER, provider, external_artist_id: "12", status: "queued", cursor: {}, counts: {}, error_code: null, error_message: null, attempts: 0, available_at: checked, lease_token: null, lease_until: null, created_at: checked, updated_at: checked, checked_at: null });
  if (provider === "melon") {
    h.state.pages["/artist/album.htm?12"] = `<a radio-value="0">전체앨범(${ids.length})</a><div class="list_album11"><ul>${ids.map(id => `<li><a href="javascript:melon.link.goAlbumDetail('${id}');">앨범</a></li>`).join("")}</ul></div>`;
    for (const id of ids) h.state.pages[`/album/detail.htm?${id}`] = `<div class="section_info"><div class="song_name"><strong>앨범명</strong>앨범 ${id}</div><a class="artist_name"><span>우리 가수</span></a><a href="javascript:melon.link.goArtistDetail('12');">우리 가수</a><div class="button d_album_like"></div></div><table><tr data-group-items="cd1"><td><span class="rank">1</span><a href="javascript:melon.link.goSongDetail('5${id}');">정보</a><a href="javascript:melon.play.playSong('1', 5${id});">노래 ${id}</a><a href="javascript:melon.link.goArtistDetail('12');">우리 가수</a></td></tr></table>`;
  } else {
    h.state.pages["/detail/artistAlbum?12"] = `<div class="artist-album-list"><ul>${ids.map(id => `<li><a onclick="fnViewAlbumLayer('${id}');">앨범</a></li>`).join("")}</ul></div>`;
    for (const id of ids) h.state.pages[`/detail/albumInfo?${id}`] = `<div class="album-detail-infos"><h2 class="name">앨범 ${id}</h2><a onclick="fnGoMore('artistInfo','12');">우리 가수</a><!-- E. 앨범 기본 정보 --></div><table><tr class="list" songId="5${id}"><td class="number">1</td><td><a class="title" title="노래 ${id}">노래 ${id}</a><a class="artist" onclick="fnViewArtist(12);">우리 가수</a></td></tr></table>`;
  }
  for (const id of ids) {
    h.state.pages[provider === "melon" ? `/song/detail.htm?5${id}` : `/detail/songInfo?5${id}`] = provider === "melon"
      ? `<div class="song_name"><strong>곡명</strong>노래 ${id}</div><ul class="list_person clfix"><li><a class="artist_name">공개 작곡가</a><span class="type">작곡</span></li><li><a class="artist_name">공개 편곡자</a><span class="type">편곡</span></li></ul><div class="lyric" id="d_video_summary">비저장 가사</div>`
      : `<div class="song-header"><h2 class="name">노래 ${id}</h2></div><ul class="info-data"><li><span class="attr"><img alt="작곡가" /></span><span class="value"><a>공개 작곡가</a></span></li><li><span class="attr"><img alt="편곡자" /></span><span class="value"><a>공개 편곡자</a></span></li></ul><pre id="pLyrics">비저장 가사</pre>`;
  }
  return h;
}

for (const provider of ["melon", "genie"] as const) test(`${provider} worker persists its first album through enum-valid credit query, source write and atomic commit`, async () => {
  const h = await harness(provider);
  assert.equal(await h.runArchiveJob(LIBRARY), true);
  assert.equal(h.state.jobs[0].counts.steps, 1);
  assert.equal(h.state.libraries[0].data.releases.length, 0);
  assert.equal(await h.runArchiveJob(LIBRARY), true);
  const job = h.state.jobs[0];
  assert.equal(job.status, "queued", job.error_message ?? undefined);
  assert.equal(job.counts.steps, 2);
  assert.deepEqual([job.counts.releases, job.counts.tracks, job.counts.managedTracks], [1, 1, 1]);
  assert.equal(job.error_code, null);
  assert.equal(h.state.libraries[0].version, 3);
  assert.equal(validateArchiveData(h.state.libraries[0].data).releases[0].source?.externalId, "100");
  assert.equal(h.state.sources.length, 1);
  const payload = h.state.sources[0].payload as Row;
  assert.equal(payload.participation, undefined);
  assert.equal((payload.tracks as Row[])[0].managedByArtist, undefined);
  const creditLookup = h.calls.find(call => call.table === "submissions");
  assert.ok(creditLookup?.operations?.some(op => op.method === "eq" && op.args[0] === "user_id" && op.args[1] === OWNER));
  await h.runArchiveJob(LIBRARY); await h.runArchiveJob(LIBRARY);
  assert.equal(job.status, "completed", job.error_message ?? undefined);
  assert.equal(job.counts.creditTracks, 1);
  assert.equal(job.counts.creditTracksChecked, 1);
  assert.deepEqual(h.state.libraries[0].data.works[0].contributors, [{ name: "공개 작곡가", role: "composition" }, { name: "공개 편곡자", role: "arrangement" }]);
  assert.doesNotMatch(JSON.stringify([h.state.libraries, h.state.sources]), /비저장 가사/);
  assert.equal(h.state.sources.filter(source => source.kind === "work").length, 1);
  assert.equal(await h.runArchiveJob(LIBRARY), false, "completed jobs cannot be claimed again");
});

test("worker copies only the owning member's matched credits and leaves another owner's job untouched", async () => {
  const h = await harness();
  const other = structuredClone(h.state.libraries[0]); other.id = OTHER_LIBRARY; other.owner_id = OTHER_OWNER;
  h.state.libraries.push(other);
  h.state.jobs.push({ ...structuredClone(h.state.jobs[0]), id: "30000000-0000-4000-8000-000000000002", library_id: OTHER_LIBRARY, owner_id: OTHER_OWNER });
  h.state.submissions.push(...[OWNER, OTHER_OWNER].map((owner, index) => ({ id: `40000000-0000-4000-8000-00000000000${index + 1}`, user_id: owner, type: "ALBUM", status: "COMPLETED", user_deleted_at: null, melon_url: "https://www.melon.com/album/detail.htm?albumId=100", album_tracks: [{ id: `50000000-0000-4000-8000-00000000000${index + 1}`, track_no: 1, track_title: "노래 100", composer: index ? "다른 회원 비공개 작곡가" : "내 작곡가" }] })));
  await h.runArchiveJob(LIBRARY); await h.runArchiveJob(LIBRARY);
  await h.runArchiveJob(LIBRARY); await h.runArchiveJob(LIBRARY);
  assert.equal(h.state.jobs[0].status, "completed", h.state.jobs[0].error_message ?? undefined);
  assert.equal(h.state.jobs[1].status, "queued");
  assert.equal(h.state.libraries[1].data.releases.length, 0);
  assert.equal(h.state.libraries[0].data.works[0].contributors?.[0].name, "내 작곡가");
  assert.doesNotMatch(JSON.stringify(h.state.libraries[0].data), /다른 회원 비공개/);
  assert.doesNotMatch(JSON.stringify(h.state.sources), /내 작곡가|다른 회원 비공개/, "public snapshots never receive private submission credits");
});

test("a mid-import storage failure preserves the checkpoint, redacts diagnostics and resumes without losing edits", async () => {
  const h = await harness("melon", ["100", "101"]);
  await h.runArchiveJob(LIBRARY); await h.runArchiveJob(LIBRARY);
  const checkpoint = structuredClone(h.state.jobs[0].cursor);
  const beforeVersion = h.state.libraries[0].version;
  h.state.failSourceId = "101";
  await h.runArchiveJob(LIBRARY);
  assert.equal(h.state.jobs[0].status, "partial");
  assert.equal(h.state.jobs[0].error_code, "DATABASE_ERROR");
  assert.doesNotMatch(h.state.jobs[0].error_message ?? "", /private-db-secret|simulated|XX000/);
  assert.deepEqual(h.state.jobs[0].cursor, checkpoint);
  assert.equal(h.state.libraries[0].version, beforeVersion);
  assert.equal(h.state.libraries[0].data.releases.length, 1);
  assert.equal(h.state.sources.length, 1);
  const library = h.state.libraries[0];
  library.data = applyArchiveCommand(library.data, { type: "update_release", releaseId: "melon-release:100", patch: { title: "회원이 수정한 앨범명" } });
  library.version++;
  h.state.jobs[0].available_at = checked;
  await assert.rejects(h.resumeArchiveSync(OTHER_OWNER, JOB), /찾을 수 없습니다/);
  await h.resumeArchiveSync(OWNER, JOB);
  await h.runArchiveJob(LIBRARY);
  assert.equal(h.state.jobs[0].status, "queued");
  assert.equal(h.state.jobs[0].counts.steps, 3);
  assert.equal(h.state.jobs[0].counts.consecutiveErrors, 0);
  assert.deepEqual(h.state.jobs[0].cursor.releaseIds, ["100", "101"]);
  assert.equal(library.data.releases[0].title, "회원이 수정한 앨범명");
  assert.equal(library.data.releases.length, 2);
  assert.equal(library.data.tracks.length, 2);
  assert.equal(h.state.sources.length, 2);
  assert.deepEqual(h.calls.filter(call => call.kind === "fetch").map(call => new URL(call.url!).searchParams.get("albumId")).filter(Boolean), ["100", "101", "101"]);
});


test("credit persistence failure resumes the same song after all albums are saved and preserves member corrections", async () => {
  const h = await harness("melon", ["100", "101"]);
  for (let step = 0; step < 4; step++) await h.runArchiveJob(LIBRARY);
  const library = h.state.libraries[0];
  assert.equal(library.data.releases.length, 2);
  const cursor = structuredClone(h.state.jobs[0].cursor);
  h.state.failSourceId = "5100";
  await h.runArchiveJob(LIBRARY);
  assert.equal(h.state.jobs[0].status, "partial");
  assert.deepEqual(h.state.jobs[0].cursor, cursor);
  assert.equal(library.data.works.length, 0, "failed credit source write cannot commit member data");
  library.data = applyArchiveCommand(library.data, { type: "save_work", work: { id: "member-work", title: "노래 100", contributors: [{ name: "회원 수정 작곡가", role: "composition" }], institutionNumbers: [] } });
  library.data = applyArchiveCommand(library.data, { type: "save_recording", recording: { id: "member-recording", title: "노래 100", workIds: ["member-work"] } });
  library.data = applyArchiveCommand(library.data, { type: "update_track", trackId: "melon-track:100:5100", patch: { recordingId: "member-recording" } });
  library.version++;
  h.state.jobs[0].available_at = checked;
  await h.resumeArchiveSync(OWNER, JOB);
  for (let step = 0; step < 3; step++) await h.runArchiveJob(LIBRARY);
  assert.equal(h.state.jobs[0].status, "completed", h.state.jobs[0].error_message ?? undefined);
  assert.equal(h.state.jobs[0].counts.creditTracksChecked, 2);
  assert.equal(library.data.works.find(work => work.id === "member-work")?.contributors?.[0].name, "회원 수정 작곡가");
  assert.equal(library.data.tracks.find(track => track.id === "melon-track:100:5100")?.recordingId, "member-recording");
  assert.equal(library.data.works.find(work => work.id === "melon-work:5101")?.contributors?.length, 2);
  assert.doesNotMatch(JSON.stringify(h.state.sources), /회원 수정|비저장 가사/);
  assert.deepEqual(h.calls.filter(call => call.kind === "fetch").map(call => new URL(call.url!).searchParams.get("songId")).filter(Boolean), ["5100", "5100", "5101"]);
});

test("deleting an artist during the external request prevents album and public source writes", async () => {
  const h = await harness();
  await h.runArchiveJob(LIBRARY);
  h.state.archiveOnFetch = true;
  await h.runArchiveJob(LIBRARY);
  assert.equal(h.state.jobs[0].status, "cancelled");
  assert.equal(h.state.libraries[0].data.releases.length, 0);
  assert.equal(h.state.sources.length, 0);
});

test("verified album notes supplement credits before an empty song page without double-counting or replacing a direct cache", async () => {
  const h = await harness("genie");
  h.state.pages["/detail/albumInfo?100"] += `<script>var _rfr = "/detail/albumInfo?axnm=100";</script><!-- S. 앨범 DESC albumDesc--><div>[CREDIT]</div><div>01. 노래 100</div><div>Composed &amp; Arranged by 빈티지코드</div><div>Lyrics by 작사가</div><!-- E. 앨범 DESC -->`;
  h.state.pages["/detail/songInfo?5100"] = `<h2 class="name">노래 100</h2>`;
  const direct = { provider: "genie", external_id: "5100", kind: "work", payload: { songId: "5100", contributors: [{ name: "이전에 확인한 곡 원본", role: "composition" }] } };
  h.state.sources.push(structuredClone(direct));
  for (let step = 0; step < 3; step++) await h.runArchiveJob(LIBRARY);
  const library = h.state.libraries[0];
  assert.equal(h.state.jobs[0].counts.creditTracksChecked, 0);
  assert.equal(h.state.jobs[0].counts.creditTracks, 1);
  assert.equal(library.data.works[0].contributors?.length, 3);
  const credits = structuredClone(library.data.works[0].contributors);
  await h.runArchiveJob(LIBRARY);
  assert.equal(h.state.jobs[0].status, "completed");
  assert.equal(h.state.jobs[0].counts.creditTracksChecked, 1);
  assert.deepEqual(library.data.works[0].contributors, credits);
  assert.deepEqual(h.state.sources.find(source => source.kind === "work"), direct);
});
