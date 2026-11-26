import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import PizZip from 'pizzip';
import {createDesk} from '../server.mjs';
import {Store} from '../core.mjs';
import {lyricsHash} from '../audio-check.mjs';

// Made-up lyrics only (no commercial songs in the repository).
const FIRST = '하늘 위로 걸어가\n구름 사이 노래해\n바람 따라 춤을 춰';
const SECOND = '작은 별이 반짝여\n밤하늘을 건너가';
const waitFor = async (check, timeout = 2000) => {
  const until = Date.now() + timeout;
  while (!check()) { if (Date.now() > until) throw new Error('timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
const ALBUM_ONLY = '음원 가사 대조는 관리자 수동 작업의 음반에서만 사용할 수 있습니다.';

function fakeRun({tracks, mapping}, suggest = () => []) {
  return {id:randomUUID(), status:'completed', createdAt:'2026-11-27T00:00:00.000Z', finishedAt:'2026-11-27T00:01:00.000Z', engineVersion:'audio-check-1',
    tracks:tracks.map(t => mapping[t.id]
      ? {trackId:t.id, attachmentId:mapping[t.id], lyricsHash:lyricsHash(t.lyrics ?? ''), separation:'demucs', duration:180, foreign:false, status:'ok', suggestions:suggest(t), applied:[]}
      : {trackId:t.id, attachmentId:null, lyricsHash:lyricsHash(t.lyrics ?? ''), separation:null, duration:null, foreign:false, status:'skipped', suggestions:[], applied:[]})};
}
const replaceLine = (track, line, from, to) => ({id:`${track.id}:replace:${line}:x`, trackId:track.id, kind:'replace', confidence:'strong', start:10, end:14, op:{type:'replaceLine', lines:[line], from, to}, hint:to, score:9, lines:[line]});
const insertLines = (track, afterLine, lines) => ({id:`${track.id}:new:${afterLine}:y`, trackId:track.id, kind:'new', confidence:'check', start:20, end:24, op:{type:'insertLines', afterLine, lines}, hint:'', score:null, lines:[]});

async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-audio-server-'));
  if (options.prepare) await options.prepare(root);
  const calls = {status:0, install:[], workers:[], runs:[]};
  const online = {id:'11111111-1111-4111-8111-111111111111',type:'ALBUM',title:'온라인 신청',updated_at:'2026-10-25T00:00:00Z'};
  const source = {sourceStatus:()=>({configured:false}),fetchSubmissions:async()=>[online],fetchSubmission:async()=>{throw Error('수동작업은 온라인 조회 금지');},downloadAsset:async()=>{throw Error('수동작업 다운로드 금지');}};
  const remote = {configured:()=>false,...Object.fromEntries(['getResults','getEmailPreview','saveResults','uploadCertificate','downloadAsset'].map(key=>[key,async()=>{throw Error('원격 쓰기 금지');}])),
    saveAlbumInfo:async()=>{calls.syncOnline=(calls.syncOnline||0)+1;return {changed:true,albumInfo:{}};}};
  const reviewer = async d => ({sourceHash:createHash('sha256').update(JSON.stringify([d.submission.mv_lyrics,d.tracks.map(t=>[t.id,t.lyrics])])).digest('hex'),findings:[],requiresReview:false,counts:{total:0}});
  const importer = async ({type}) => ({submission:{title:'수동 작품',artist_name:'수동 아티스트',mv_lyrics:type==='ALBUM'?'':'노래 가사'},tracks:type==='ALBUM'?[{track_no:1,track_title:'첫 곡',lyrics:FIRST},{track_no:2,track_title:'둘째 곡',lyrics:SECOND}]:[],extractedText:'원문',warnings:[],format:'DOCX'});
  const generator = async ({outputDir}) => {await fs.writeFile(path.join(outputDir,'가사.docx'),'document');return {artifacts:[{name:'가사.docx',type:'docx',bytes:8}],warnings:[]};};
  const translator = async () => ({overrides:{},translatedCount:0,warnings:[]});
  const audio = {
    engineStatus: async () => { calls.status++; return {installed:options.installed ?? true, version:'audio-check-1', uv:'uv' in options ? options.uv : '/fake/bin/uv', needsUpdate:false}; },
    installEngine: async input => { calls.install.push(input); input.onProgress('패키지를 설치하는 중'); if (options.onInstall) await options.onInstall(input); return {version:'audio-check-1'}; },
    startWorker: input => { const worker = {input, closed:false, request:async()=>({}), async close(){worker.closed=true;}}; calls.workers.push(worker); return worker; },
    runAudioCheck: async input => { calls.runs.push(input); return options.runAudioCheck ? options.runAudioCheck(input, calls) : fakeRun(input, options.suggest); },
  };
  const desk = await createDesk({dataRoot:root,port:0,source,remote,importer,reviewer,generator,translator,audio,openFolder:()=>{},timers:false});
  const url=`http://127.0.0.1:${desk.server.address().port}`;
  const api=(route,init={})=>fetch(url+route,{...init,headers:{'X-Desk-Token':desk.token,'Content-Type':'application/json',...init.headers}});
  const json=(route,method,body)=>api(route,{method,body:JSON.stringify(body ?? {})});
  const create=async(type='ALBUM')=>{const response=await api(`/api/manual/import?type=${type}&filename=${encodeURIComponent('수신 신청서.docx')}`,{method:'POST',body:'fixture-source'});assert.equal(response.status,201);return response.json();};
  const attach=async(id,name,body='RIFF fixture')=>{const response=await api(`/api/cases/${id}/attachments?filename=${encodeURIComponent(name)}`,{method:'POST',body});assert.equal(response.status,200);return (await response.json()).attachment;};
  const audioJob=id=>desk.store.data.jobs.find(j=>j.kind==='audio-check'&&j.caseId===id);
  t.after(async()=>{await desk.close();await fs.rm(root,{recursive:true,force:true});});
  return {desk,root,url,api,json,create,attach,audioJob,calls};
}

test('audio endpoints are limited to manual albums', async t => {
  const s = await setup(t);
  await s.desk.sync();
  const onlineId = s.desk.publicState().cases.find(c => c.source === 'online').id;
  const {id: mvId} = await s.create('MV_DISTRIBUTION');
  await s.attach(mvId, '01_뮤비.wav');
  const attachmentId = randomUUID();
  for (const id of [onlineId, mvId]) {
    for (const [route, method] of [['audio-check/mapping','PATCH'],['audio-check','POST'],['audio-check/cancel','POST'],['audio-check/apply','POST'],[`attachments/${attachmentId}/stream`,'GET']]) {
      const response = method === 'GET' ? await s.api(`/api/cases/${id}/${route}`) : await s.json(`/api/cases/${id}/${route}`, method, {});
      assert.equal(response.status, 400, `${id} ${route}`);
      assert.equal((await response.json()).error, ALBUM_ONLY);
    }
  }
  assert.equal((await s.desk.detail(mvId)).audioCheck, undefined);
  assert.equal(s.calls.runs.length, 0);
});

test('mapping patch validates and persists, detail exposes auto mapping and latest run', async t => {
  const s = await setup(t);
  const {id, detail} = await s.create();
  const [first, second] = detail.tracks;
  assert.deepEqual(detail.audioCheck, {mapping:{}, auto:{mapping:{[first.id]:null,[second.id]:null}, duplicates:[], mrPairs:{}, unmapped:[]}, effective:{[first.id]:null,[second.id]:null}, latest:null, staleTracks:[]});
  assert.equal((await s.json(`/api/cases/${id}/audio-check`, 'POST')).status, 400);
  const wav = await s.attach(id, '01_첫 곡.wav'), mp3 = await s.attach(id, '01_첫 곡.mp3'), two = await s.attach(id, '02 둘째 곡.flac'), pdf = await s.attach(id, '안내.pdf');
  let view = (await s.desk.detail(id)).audioCheck;
  assert.deepEqual(view.auto.mapping, {[first.id]:wav.id, [second.id]:two.id});
  assert.deepEqual(view.auto.duplicates, [{trackId:first.id, attachmentId:mp3.id}]);
  assert.deepEqual(view.effective, {[first.id]:wav.id, [second.id]:two.id});

  const route = `/api/cases/${id}/audio-check/mapping`;
  for (const mapping of [{[first.id]:pdf.id}, {'local-00000000-0000-4000-8000-000000000000':null}, {[first.id]:two.id, [second.id]:two.id}, {[first.id]:'missing'}, {[first.id]:5}]) {
    const response = await s.json(route, 'PATCH', {mapping});
    assert.equal(response.status, 400, JSON.stringify(mapping));
  }
  assert.equal((await s.json(route, 'PATCH', {mapping:[]})).status, 400);
  assert.equal(s.desk.store.data.cases[id].audioCheck, undefined);

  // An explicit choice wins over the automatic one, and a file cannot be used twice.
  let response = await s.json(route, 'PATCH', {mapping:{[second.id]:mp3.id}});
  assert.equal(response.status, 200);
  view = (await response.json()).audioCheck;
  assert.deepEqual(view.mapping, {[second.id]:mp3.id});
  assert.deepEqual(view.effective, {[first.id]:wav.id, [second.id]:mp3.id});
  response = await s.json(route, 'PATCH', {mapping:{[first.id]:null}});
  view = (await response.json()).audioCheck;
  assert.deepEqual(view.mapping, {[first.id]:null, [second.id]:mp3.id});
  assert.deepEqual(view.effective, {[first.id]:null, [second.id]:mp3.id});
  assert.deepEqual((await new Store(s.root).init()).data.cases[id].audioCheck.mapping, {[first.id]:null, [second.id]:mp3.id});

  const started = await s.json(`/api/cases/${id}/audio-check`, 'POST');
  assert.equal(started.status, 202);
  const {job} = await started.json();
  assert.equal(job.kind, 'audio-check'); assert.equal(job.caseId, id);
  await s.desk.audioIdle();
  assert.equal(s.calls.runs.length, 1);
  const input = s.calls.runs[0];
  assert.deepEqual(input.mapping, {[first.id]:null, [second.id]:mp3.id});
  assert.equal(input.caseDir, path.join(s.root, '신청별 자료', id));
  assert.deepEqual(input.tracks.map(tr => tr.id), [first.id, second.id]);
  assert.equal(input.attachments.length, 4);
  assert.equal(input.worker, s.calls.workers[0]);
  assert.equal(s.calls.workers[0].closed, true);
  const finished = s.audioJob(id);
  assert.equal(finished.status, 'completed'); assert.equal(finished.message, '음원 대조 완료 · 제안 0개');
  view = (await s.desk.detail(id)).audioCheck;
  assert.equal(view.latest.id, finished.result.runId);
  assert.deepEqual(view.staleTracks, []);

  // Only the latest three runs are kept.
  for (let i = 0; i < 3; i++) { await s.json(`/api/cases/${id}/audio-check`, 'POST'); await s.desk.audioIdle(); }
  assert.equal(s.desk.store.data.cases[id].audioCheck.runs.length, 3);
  assert.equal(s.desk.store.data.cases[id].audioCheck.runs.at(-1).id, s.audioJob(id).result.runId);
  assert.deepEqual(s.desk.store.data.cases[id].audioCheck.mapping, {[first.id]:null, [second.id]:mp3.id});

  // Nothing connected: 400 before any job is queued.
  await s.json(route, 'PATCH', {mapping:{[second.id]:null}});
  const jobs = s.desk.store.data.jobs.length;
  response = await s.json(`/api/cases/${id}/audio-check`, 'POST');
  assert.equal(response.status, 400); assert.equal((await response.json()).error, '연결된 음원이 없습니다.');
  assert.equal(s.desk.store.data.jobs.length, jobs);
});

test('audio-check needs the installed engine', async t => {
  const s = await setup(t, {installed:false});
  const {id} = await s.create();
  await s.attach(id, '01_첫 곡.wav');
  const response = await s.json(`/api/cases/${id}/audio-check`, 'POST');
  assert.equal(response.status, 400); assert.equal((await response.json()).error, '분석 도구를 먼저 설치하세요.');
  assert.equal(s.calls.runs.length, 0);
});

test('audio-check runs on its own queue so generation is not blocked', async t => {
  let release, entered;
  const holding = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const s = await setup(t, {runAudioCheck: async (input, calls) => {
    input.onProgress('1/2 보컬 분리 중 · 01 첫 곡');
    calls.workers.at(-1).input.onProgress({id:1, stage:'transcribe'});
    entered();
    await holding;
    return fakeRun(input);
  }});
  const {id} = await s.create();
  await s.attach(id, '01_첫 곡.wav');
  const first = await (await s.json(`/api/cases/${id}/audio-check`, 'POST')).json();
  const again = await (await s.json(`/api/cases/${id}/audio-check`, 'POST')).json();
  assert.equal(again.job.id, first.job.id);
  await started;
  const job = s.audioJob(id);
  assert.equal(job.status, 'running');
  assert.equal(job.message, '1/2 받아쓰는 중 · 01 첫 곡');
  assert.equal(s.calls.workers[0].input.signal.aborted, false);
  const generation = s.desk.enqueue(id, 'generate');
  await s.desk.idle();
  assert.equal(generation.status, 'completed');
  assert.equal(job.status, 'running');
  release();
  await s.desk.audioIdle();
  assert.equal(job.status, 'completed');
});

test('cancel aborts the running audio job and records the cancel message', async t => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const s = await setup(t, {runAudioCheck: input => new Promise((resolve, reject) => {
    entered();
    input.signal.addEventListener('abort', () => reject(new Error('음원 대조를 중지했습니다.')));
  })});
  const {id} = await s.create();
  await s.attach(id, '01_첫 곡.wav');
  assert.deepEqual(await (await s.json(`/api/cases/${id}/audio-check/cancel`, 'POST')).json(), {cancelled:false});
  await s.json(`/api/cases/${id}/audio-check`, 'POST');
  await started;
  const response = await s.json(`/api/cases/${id}/audio-check/cancel`, 'POST');
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), {cancelled:true});
  await s.desk.audioIdle();
  const job = s.audioJob(id);
  assert.equal(job.status, 'cancelled'); assert.equal(job.message, '음원 대조를 중지했습니다.');
  assert.ok(job.finishedAt);
  assert.equal(s.calls.workers[0].input.signal.aborted, true);
  assert.equal(s.calls.workers[0].closed, true);
  assert.equal((await s.desk.detail(id)).audioCheck.latest, null);
  assert.equal(s.desk.store.data.cases[id].history.some(h => h.action === 'error'), false);
});

test('a worker that dies fails the job and keeps no partial run', async t => {
  const s = await setup(t, {runAudioCheck: input => {
    const run = fakeRun(input);
    Object.assign(run.tracks[0], {status:'failed', error:'분석 도구가 중단되었습니다. 신호 9', suggestions:[]});
    return run;
  }});
  const {id} = await s.create();
  await s.attach(id, '01_첫 곡.wav');
  await s.json(`/api/cases/${id}/audio-check`, 'POST');
  await s.desk.audioIdle();
  const job = s.audioJob(id);
  assert.equal(job.status, 'failed'); assert.match(job.message, /^분석 도구가 중단되었습니다/);
  assert.equal((await s.desk.detail(id)).audioCheck.latest, null);
});

test('apply writes lyrics through overrides, records applied ids, and returns 409 after a lyric edit', async t => {
  const s = await setup(t, {suggest: track => track.track_no === 1
    ? [replaceLine(track, 1, '구름 사이 노래해', '구름 사이로 노래해'), insertLines(track, 2, ['바람 따라 춤을 춰']), {...replaceLine(track, 1, '구름 사이 노래해', '구름 위에서 노래해'), id:`${track.id}:replace:1:z`}]
    : [insertLines(track, 1, ['작은 별이 반짝여'])]});
  const {id, detail} = await s.create();
  const [first, second] = detail.tracks;
  await s.attach(id, '01_첫 곡.wav'); await s.attach(id, '02_둘째 곡.wav');
  // Generated once, so an applied edit marks the documents as changed.
  s.desk.enqueue(id, 'generate'); await s.desk.idle();
  await s.json(`/api/cases/${id}/local`, 'PATCH', {reviewAcknowledgedRevision:(await s.desk.detail(id)).screening.sourceHash});
  await s.json(`/api/cases/${id}/audio-check`, 'POST'); await s.desk.audioIdle();
  assert.equal(s.audioJob(id).message, '음원 대조 완료 · 제안 4개');
  const run = (await s.desk.detail(id)).audioCheck.latest;
  const [changed, added, conflicting] = run.tracks[0].suggestions;
  const route = `/api/cases/${id}/audio-check/apply`;

  let response = await s.json(route, 'POST', {runId:'old-run', items:[{suggestionId:changed.id}]});
  assert.equal(response.status, 409); assert.equal((await response.json()).error, '더 최신 대조 결과가 있습니다. 화면을 새로고침하세요.');
  response = await s.json(route, 'POST', {runId:run.id, items:[{suggestionId:'unknown'}]});
  assert.equal(response.status, 400);
  response = await s.json(route, 'POST', {runId:run.id, items:[]});
  assert.equal(response.status, 400);
  response = await s.json(route, 'POST', {runId:run.id, items:[{suggestionId:changed.id}, {suggestionId:conflicting.id}]});
  assert.equal(response.status, 409); assert.match((await response.json()).error, /겹칩니다/);
  assert.equal((await s.desk.detail(id)).tracks[0].lyrics, FIRST);

  response = await s.json(route, 'POST', {runId:run.id, items:[{suggestionId:changed.id}, {suggestionId:added.id, text:'바람 따라 춤을 춰요'}]});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.applied, 2);
  assert.equal(body.detail.tracks[0].lyrics, '하늘 위로 걸어가\n구름 사이로 노래해\n바람 따라 춤을 춰\n바람 따라 춤을 춰요');
  assert.equal(body.detail.tracks[1].lyrics, SECOND);
  assert.equal(body.detail.screening.acknowledged, false);
  assert.equal(body.detail.sourceChanged, true);
  assert.deepEqual(body.detail.audioCheck.staleTracks, [first.id]);
  const item = s.desk.store.data.cases[id];
  assert.equal(item.local.overrides.tracks.find(tr => tr.id === first.id).lyrics, body.detail.tracks[0].lyrics);
  assert.equal(item.local.reviewAcknowledgedRevision, '');
  assert.equal(item.history[0].message, '음원 대조 제안 2개를 가사에 반영했습니다.');
  assert.deepEqual(item.audioCheck.runs.at(-1).tracks[0].applied, [changed.id, added.id]);
  assert.deepEqual((await new Store(s.root).init()).data.cases[id].audioCheck.runs.at(-1).tracks[0].applied, [changed.id, added.id]);

  // The applied track's lyrics changed, so the same run cannot be applied to it again.
  response = await s.json(route, 'POST', {runId:run.id, items:[{suggestionId:conflicting.id}]});
  assert.equal(response.status, 409); assert.equal((await response.json()).error, '가사가 바뀌었습니다. 다시 대조하세요.');

  // A lyric edit after the check blocks that track too.
  const other = run.tracks[1].suggestions[0];
  await s.json(`/api/cases/${id}/local`, 'PATCH', {overrides:{tracks:[{id:second.id, lyrics:'작은 별이 반짝여\n밤하늘을 건너가\n새로 쓴 줄'}]}});
  response = await s.json(route, 'POST', {runId:run.id, items:[{suggestionId:other.id}]});
  assert.equal(response.status, 409); assert.equal((await response.json()).error, '가사가 바뀌었습니다. 다시 대조하세요.');
  assert.deepEqual((await s.desk.detail(id)).audioCheck.staleTracks, [first.id, second.id]);
  assert.equal(s.calls.syncOnline, undefined);
});

test('apply follows a registered manual album to its online submission', async t => {
  const s = await setup(t, {suggest: track => track.track_no === 1 ? [replaceLine(track, 1, '구름 사이 노래해', '구름 사이로 노래해')] : []});
  const {id} = await s.create();
  await s.attach(id, '01_첫 곡.wav');
  s.desk.store.data.cases[id].online = {submissionId:'22222222-2222-4222-8222-222222222222', status:'SUBMITTED', payment_status:'UNPAID'};
  await s.json(`/api/cases/${id}/audio-check`, 'POST'); await s.desk.audioIdle();
  const run = (await s.desk.detail(id)).audioCheck.latest;
  const response = await s.json(`/api/cases/${id}/audio-check/apply`, 'POST', {runId:run.id, items:[{suggestionId:run.tracks[0].suggestions[0].id}]});
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).onlineSync, {ok:true, changed:true});
  assert.equal(s.calls.syncOnline, 1);
});

test('stream serves byte ranges for audio attachments only', async t => {
  const s = await setup(t);
  const {id} = await s.create();
  const wav = await s.attach(id, '01_첫 곡.wav', '0123456789');
  const mp3 = await s.attach(id, '02 둘째 곡.mp3', 'ID3-bytes');
  const pdf = await s.attach(id, '안내.pdf', '%PDF');
  const stream = attachment => `/api/cases/${id}/attachments/${attachment.id}/stream`;

  let response = await s.api(stream(wav), {headers:{Range:'bytes=0-3'}});
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/10');
  assert.equal(response.headers.get('content-length'), '4');
  assert.equal(response.headers.get('content-type'), 'audio/wav');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(await response.text(), '0123');

  response = await s.api(stream(wav), {headers:{Range:'bytes=6-'}});
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 6-9/10'); assert.equal(await response.text(), '6789');
  response = await s.api(stream(wav), {headers:{Range:'bytes=8-20'}});
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 8-9/10'); assert.equal(await response.text(), '89');
  response = await s.api(stream(wav), {headers:{Range:'bytes=-3'}});
  assert.equal(response.status, 206); assert.equal(await response.text(), '789');

  response = await s.api(stream(wav), {headers:{Range:'bytes=10-'}});
  assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), 'bytes */10');
  response = await s.api(stream(wav), {headers:{Range:'bytes=5-2'}});
  assert.equal(response.status, 416);

  // The audio element sends the session cookie, not the header token.
  response = await fetch(s.url + stream(mp3), {headers:{Cookie:`desk-session=${s.desk.token}`}});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('content-length'), '9');
  assert.equal(await response.text(), 'ID3-bytes');
  assert.equal((await fetch(s.url + stream(mp3))).status, 403);

  response = await s.api(stream(pdf));
  assert.equal(response.status, 400);
  assert.equal((await s.api(`/api/cases/${id}/attachments/${randomUUID()}/stream`)).status, 404);
  assert.equal((await s.api(stream(wav), {method:'POST', body:'{}'})).status, 405);
});

test('engine status and install run as audio jobs', async t => {
  let release;
  const holding = new Promise(resolve => { release = resolve; });
  const s = await setup(t, {onInstall: () => holding});
  const status = await s.api('/api/audio-engine');
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {installed:true, version:'audio-check-1', uv:'/fake/bin/uv', needsUpdate:false});
  const response = await s.json('/api/audio-engine/install', 'POST');
  assert.equal(response.status, 202);
  const {job} = await response.json();
  assert.equal(job.kind, 'audio-install'); assert.equal(job.caseId, null);
  assert.equal((await (await s.json('/api/audio-engine/install', 'POST')).json()).job.id, job.id);
  await waitFor(() => s.calls.install.length === 1);
  const live = s.desk.store.data.jobs.find(j => j.id === job.id);
  assert.equal(live.message, '패키지를 설치하는 중');
  assert.equal(s.calls.install[0].uv, '/fake/bin/uv');
  assert.equal(s.calls.install[0].dataRoot, s.root);
  assert.ok(s.calls.install[0].signal instanceof AbortSignal);
  assert.ok(s.desk.publicState().jobs.some(j => j.id === job.id));
  release();
  await s.desk.audioIdle();
  assert.equal(live.status, 'completed'); assert.equal(live.message, '분석 도구를 설치했습니다.');
});

test('install without uv explains how to get it', async t => {
  const s = await setup(t, {uv:null});
  const response = await s.json('/api/audio-engine/install', 'POST');
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /brew install uv/);
  assert.equal(s.calls.install.length, 0);
});

test('closing the desk stops a running audio job', async t => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const s = await setup(t, {runAudioCheck: input => new Promise((resolve, reject) => {
    entered();
    input.signal.addEventListener('abort', () => reject(new Error('음원 대조를 중지했습니다.')));
  })});
  const {id} = await s.create();
  await s.attach(id, '01_첫 곡.wav');
  await s.json(`/api/cases/${id}/audio-check`, 'POST');
  await started;
  const job = s.audioJob(id);
  await s.desk.close();
  s.desk.close = async () => {};
  assert.equal(job.status, 'failed'); assert.equal(job.message, '앱이 다시 시작되어 중단되었습니다.');
  assert.equal(s.calls.workers[0].closed, true);
  const saved = (await new Store(s.root).init()).data.jobs.find(j => j.id === job.id);
  assert.equal(saved.status, 'failed');
});

test('leftover audio jobs fail on restart', async t => {
  const s = await setup(t, {prepare: async root => {
    const store = await new Store(root).init();
    store.data.jobs.push(
      {id:'install-job', caseId:null, kind:'audio-install', status:'running', message:'패키지를 설치하는 중', createdAt:'2026-11-27T00:00:00.000Z'},
      {id:'check-job', caseId:'manual-x', kind:'audio-check', status:'queued', message:'대기 중', createdAt:'2026-11-27T00:00:00.000Z'},
      {id:'generate-job', caseId:'manual-x', kind:'generate', status:'running', message:'생성 중', createdAt:'2026-11-27T00:00:00.000Z'});
    await store.save();
  }});
  const jobs = Object.fromEntries(s.desk.store.data.jobs.map(j => [j.id, j]));
  for (const key of ['install-job', 'check-job']) {
    assert.equal(jobs[key].status, 'failed');
    assert.equal(jobs[key].message, '앱이 다시 시작되어 중단되었습니다.');
    assert.ok(jobs[key].finishedAt);
  }
  assert.equal(jobs['generate-job'].status, 'failed');
  assert.equal(jobs['generate-job'].message, '앱 종료로 중단되었습니다. 다시 실행하세요.');
  // A new install is not blocked by the interrupted one.
  const response = await s.json('/api/audio-engine/install', 'POST');
  assert.notEqual((await response.json()).job.id, 'install-job');
  await s.desk.audioIdle();
});

test('backup excludes the audio cache folder', async t => {
  const s = await setup(t);
  const {id} = await s.create();
  const dir = path.join(s.root, '신청별 자료', id);
  await fs.mkdir(path.join(dir, '음원 대조 캐시', 'abc123'), {recursive:true});
  await fs.writeFile(path.join(dir, '음원 대조 캐시', 'abc123', 'analysis.json'), '{"vocals":"x"}');
  await fs.writeFile(path.join(dir, '음원 대조 캐시', 'abc123', 'vocals.wav'), 'derived');
  await fs.mkdir(path.join(dir, '음원 대조', 'run-1'), {recursive:true});
  await fs.writeFile(path.join(dir, '음원 대조', 'run-1', 'result.json'), '{}');
  const backup = await s.desk.backup();
  const names = Object.keys(new PizZip(await fs.readFile(backup.path)).files);
  assert.ok(names.some(name => name.endsWith(path.join('음원 대조', 'run-1', 'result.json'))));
  assert.ok(!names.some(name => name.includes('음원 대조 캐시')));
});
