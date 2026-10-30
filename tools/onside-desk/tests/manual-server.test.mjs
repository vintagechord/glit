import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import PizZip from 'pizzip';
import {createDesk} from '../server.mjs';
import {Store} from '../core.mjs';

async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-manual-server-'));
  const calls = {remote:0, sourceDetail:0, download:0, import:0, translate:0};
  const online = {id:'11111111-1111-4111-8111-111111111111',type:'ALBUM',title:'온라인 신청',updated_at:'2026-10-25T00:00:00Z'};
  const source = {sourceStatus:()=>({configured:false}),fetchSubmissions:async()=>[online],fetchSubmission:async()=>{calls.sourceDetail++;throw Error('수동작업은 온라인 조회 금지');},downloadAsset:async()=>{calls.download++;throw Error('수동작업 다운로드 금지');}};
  const remote = {configured:()=>false,...Object.fromEntries(['getResults','getEmailPreview','saveResults','uploadCertificate','downloadAsset'].map(key=>[key,async()=>{calls.remote++;throw Error('원격 쓰기 금지');}]))};
  const reviewer = async d => ({sourceHash:createHash('sha256').update(JSON.stringify([d.submission.mv_lyrics,d.tracks.map(t=>[t.id,t.lyrics])])).digest('hex'),findings:[{id:'fixture-warning',kind:'translation_missing',severity:'warning',line:1,excerpt:'hello',message:'번역 확인 필요'}],requiresReview:true,counts:{total:1}});
  const importer = async ({body,type}) => {calls.import++;if(body.toString()==='invalid')throw Error('읽을 수 없는 기준파일');return {submission:{title:'수동 작품',artist_name:'수동 아티스트',applicant_email:'fixture@example.invalid',mv_lyrics:type==='ALBUM'?'':'hello'},tracks:type==='ALBUM'?[{track_no:1,track_title:'첫 곡',lyrics:'hello'}]:[],extractedText:'원문 전체\nhello',warnings:['내용 추출 확인'],format:'DOCX'};};
  const generator = async ({outputDir,source:sourceKind,files,submission}) => {assert.equal(sourceKind,'manual');if(options.onGenerate)await options.onGenerate({files});const artifacts=submission.type==='ALBUM'?[{name:'가사.docx',type:'docx',bytes:8},{name:'복사자료.txt',type:'txt',bytes:8},{name:'가사검토.txt',type:'txt',bytes:8}]:[{name:'가사.doc',type:'doc',bytes:8},{name:'복사자료.html',type:'html',bytes:8}];for(const a of artifacts)await fs.writeFile(path.join(outputDir,a.name),'document');return {artifacts,warnings:['번역 확인 필요']};};
  const translator = async ({detail}) => {calls.translate++;if(options.onTranslate)await options.onTranslate(detail);return {overrides:{tracks:detail.tracks.map(t=>({id:t.id,lyrics:t.lyrics+' (번역 : 안녕)'}))},translatedCount:1,warnings:[]};};
  const desk = await createDesk({dataRoot:root,port:0,source,remote,importer,reviewer,generator,translator,openFolder:()=>{},timers:false});
  const url=`http://127.0.0.1:${desk.server.address().port}`;
  const api=(route,init={})=>fetch(url+route,{...init,headers:{'X-Desk-Token':desk.token,'Content-Type':'application/json',...init.headers}});
  const create=async(type='ALBUM')=>{const response=await api(`/api/manual/import?type=${type}&filename=${encodeURIComponent('수신 신청서.docx')}`,{method:'POST',body:'fixture-source'});assert.equal(response.status,201);return response.json();};
  t.after(async()=>{await desk.close();await fs.rm(root,{recursive:true,force:true});});
  return {desk,root,url,api,create,calls};
}

test('manual intake requires local authentication and retains source without online matching',async t=>{
  const s=await setup(t);const route='/api/manual/import?type=ALBUM&filename=test.docx';
  assert.equal((await fetch(s.url+route,{method:'POST',body:'fixture'})).status,403);assert.equal(s.calls.import,0);
  assert.equal((await s.api(route,{method:'POST',headers:{Origin:'https://foreign.invalid'},body:'fixture'})).status,403);
  const {id,detail}=await s.create();assert.match(id,/^manual-/);assert.equal(detail.source,'manual');assert.match(detail.tracks[0].id,/^local-/);
  assert.equal(detail.importInfo.extractedText,'원문 전체\nhello');assert.equal(detail.importInfo.bytes,14);
  assert.equal(detail.importInfo.parserVersion,4);
  assert.ok(detail.warnings.includes('내용 추출 확인'));
  assert.ok(!detail.warnings.some(w=>/결제|서비스에 업로드/.test(w)));
  await s.desk.sync();assert.equal(s.desk.publicState().cases.filter(c=>c.source==='manual').length,1);
  await s.desk.detail(id,true);assert.equal(s.calls.sourceDetail,0);
  assert.equal(await (await s.api(`/api/cases/${id}/reference`)).text(),'fixture-source');
  assert.equal((await fetch(`${s.url}/api/cases/${id}/reference`)).status,403);
  assert.equal((await s.api(route,{method:'POST',body:'invalid'})).status,400);assert.equal(s.desk.publicState().cases.filter(c=>c.source==='manual').length,1);
});

test('manual edits keep original, invalidate reviewed lyrics, and allow deleting imported tracks',async t=>{
  const s=await setup(t);const {id,detail}=await s.create();const local=`/api/cases/${id}/local`;
  await s.api(local,{method:'PATCH',body:JSON.stringify({overrides:{tracks:[{id:detail.tracks[0].id,lyrics_with_translation:'old combined'}]}})});
  await s.api(local,{method:'PATCH',body:JSON.stringify({reviewAcknowledgedRevision:detail.screening.sourceHash})});
  assert.equal((await s.desk.detail(id)).screening.acknowledged,true);
  const edited=await s.api(local,{method:'PATCH',body:JSON.stringify({overrides:{submission:{title:'수정 작품',applicant_name:'담당자'},tracks:[{id:detail.tracks[0].id,lyrics:'수정 가사'}]}})});
  assert.equal(edited.status,200);assert.equal((await edited.json()).detail.screening.acknowledged,false);
  assert.equal((await s.desk.detail(id)).tracks[0].lyrics_with_translation,'');
  assert.equal(s.desk.publicState().cases[0].title,'수정 작품');assert.equal((await s.desk.detail(id)).importInfo.extractedText,'원문 전체\nhello');
  assert.equal((await s.api(local,{method:'PATCH',body:JSON.stringify({reviewAcknowledgedRevision:detail.screening.sourceHash})})).status,409);
  await s.api(local,{method:'PATCH',body:JSON.stringify({overrides:{tracks:[{id:detail.tracks[0].id,_deleted:true}]}})});
  assert.equal((await s.desk.detail(id)).tracks.length,0);
});

test('manual cases cannot reach remote result, certificate, mail or result asset endpoints',async t=>{
  const s=await setup(t);const {id}=await s.create();
  for(const [action,method] of [['results','GET'],['results','POST'],['email-preview','GET'],['certificate','POST'],['result-assets/certificate','GET']]){
    const response=await s.api(`/api/cases/${id}/${action}`,{method,...(method==='POST'?{body:'{}'}:{})});assert.equal(response.status,409,action);
    assert.equal((await response.json()).code,'MANUAL_CASE_LOCAL_ONLY');
  }
  assert.equal(s.calls.remote,0);
});

test('offline manual MV keeps exactly two output files with warning metadata and reference backup',async t=>{
  const s=await setup(t);const {id}=await s.create('MV_DISTRIBUTION');
  const job=s.desk.enqueue(id,'generate');assert.equal(s.desk.enqueue(id,'generate').id,job.id);await s.desk.idle();assert.equal(job.status,'completed');
  assert.equal(s.calls.sourceDetail,0);assert.equal(s.calls.download,0);
  const g=s.desk.store.data.cases[id].generations[0];assert.equal(g.artifacts.length,2);
  assert.deepEqual((await fs.readdir(path.join(s.root,'신청별 자료',id,'생성 이력',g.id))).sort(),['가사.doc','복사자료.html'].sort());
  assert.ok(g.warnings.includes('번역 확인 필요'));assert.ok(g.warnings.includes('내용 추출 확인'));assert.ok(g.snapshot);assert.ok(g.screening);
  for(const a of g.artifacts)assert.equal(await(await s.api(`/api/artifacts/${id}/${g.id}/${encodeURIComponent(a.name)}`)).text(),'document');
  await s.api(`/api/cases/${id}/attachments?filename=video.mp4`,{method:'POST',body:'video'});
  const backup=await s.desk.backup();const saved=new PizZip(await fs.readFile(backup.path));
  assert.ok(Object.keys(saved.files).some(name=>name.includes('/기준파일/수신 신청서.docx')));
  assert.ok(!Object.keys(saved.files).some(name=>name.includes('이메일 파일')));
});

test('local trash hides manual and online cases, survives sync and restores without deleting files',async t=>{
  const s=await setup(t);const {id}=await s.create();await s.desk.sync();
  const ids=s.desk.publicState().cases.map(c=>c.id);assert.equal(ids.length,2);
  assert.equal((await fetch(`${s.url}/api/cases/${id}`,{method:'DELETE'})).status,403);
  for(const caseId of ids){assert.equal((await s.api(`/api/cases/${caseId}`,{method:'DELETE'})).status,200);assert.equal((await s.api(`/api/cases/${caseId}`)).status,410);assert.throws(()=>s.desk.enqueue(caseId,'generate'),e=>e.code==='CASE_DELETED');}
  await s.desk.sync();assert.equal(s.desk.publicState().cases.length,0);assert.equal(s.desk.publicState().trashCases.length,2);
  assert.equal((await s.api(`/api/cases/${id}/restore`,{method:'POST',body:'{}'})).status,200);
  assert.equal(s.desk.publicState().cases.length,1);assert.equal(await(await s.api(`/api/cases/${id}/reference`)).text(),'fixture-source');assert.equal(s.calls.remote,0);
});

test('deletion is blocked while a generation is queued or a translation is active',async t=>{
  let s,id;
  s=await setup(t,{onGenerate:async()=>assert.equal((await s.api(`/api/cases/${id}`,{method:'DELETE'})).status,409),onTranslate:async()=>assert.equal((await s.api(`/api/cases/${id}`,{method:'DELETE'})).status,409)});
  const created=await s.create();id=created.id;s.desk.enqueue(id,'generate');await s.desk.idle();
  assert.equal((await s.api(`/api/cases/${id}/translate`,{method:'POST',body:JSON.stringify({expectedSourceHash:created.detail.screening.sourceHash})})).status,200);
  assert.equal(s.desk.publicState().cases.length,1);
});

const trashInput = desk => JSON.stringify({confirmation:'EMPTY_TRASH',cases:desk.publicState().trashCases.map(({id,deletedAt})=>({id,deletedAt}))});

test('empty trash requires local authentication, same origin, and explicit confirmation',async t=>{
  const s=await setup(t);const {id}=await s.create();await s.api(`/api/cases/${id}`,{method:'DELETE'});
  const body=trashInput(s.desk);
  assert.equal((await fetch(s.url+'/api/trash/empty',{method:'POST',body})).status,403);
  assert.equal((await s.api('/api/trash/empty',{method:'POST',headers:{Origin:'https://foreign.invalid'},body})).status,403);
  assert.equal((await s.api('/api/trash/empty',{method:'POST',body:JSON.stringify({cases:JSON.parse(body).cases})})).status,400);
  assert.equal(s.desk.publicState().trashCases.length,1);
  assert.equal(s.desk.store.data.cases[id].purgeRequestedAt,undefined);
  assert.ok(await fs.stat(path.join(s.root,'신청별 자료',id)));
});

test('empty trash removes local files and jobs, preserves active cases and backups, and cannot reimport online cases',async t=>{
  const s=await setup(t);const {id}=await s.create();const active=await s.create();await s.desk.sync();
  const online=s.desk.publicState().cases.find(c=>c.source==='online').id;
  const originalSource=await fs.readFile(path.join(s.root,'신청별 자료',active.id,'기준파일','수신 신청서.docx'));
  await fs.mkdir(path.join(s.root,'신청별 자료',online),{recursive:true});await fs.writeFile(path.join(s.root,'신청별 자료',online,'original.wav'),'online-original');
  s.desk.store.data.jobs.push({id:'job-purged',caseId:id,status:'completed'},{id:'job-active',caseId:active.id,status:'completed'});
  const backup=await s.desk.backup();
  for(const caseId of [id,online]) await s.api(`/api/cases/${caseId}`,{method:'DELETE'});
  const response=await s.api('/api/trash/empty',{method:'POST',body:trashInput(s.desk)});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,deletedCount:2,failedCases:[]});
  assert.equal(s.desk.publicState().trashCases.length,0);assert.equal(s.desk.publicState().cases.length,1);
  for(const caseId of [id,online]){await assert.rejects(fs.stat(path.join(s.root,'신청별 자료',caseId)),{code:'ENOENT'});assert.equal((await s.api(`/api/cases/${caseId}/restore`,{method:'POST',body:'{}'})).status,404);}
  assert.deepEqual(await fs.readFile(path.join(s.root,'신청별 자료',active.id,'기준파일','수신 신청서.docx')),originalSource);
  assert.ok(await fs.stat(backup.path));assert.deepEqual(s.desk.store.data.jobs.map(j=>j.id),['job-active']);
  const saved=await new Store(s.root).init();s.desk.store.data=saved.data;
  assert.equal(typeof saved.data.purgedCases[online],'string');assert.equal(saved.data.purgedCases[id],undefined);
  await s.desk.sync();assert.equal(s.desk.publicState().cases.length,1);assert.equal(s.desk.publicState().trashCases.length,0);assert.equal(s.calls.remote,0);
});

test('empty trash rejects restored or busy snapshot targets before deleting anything',async t=>{
  const s=await setup(t);const first=await s.create();const second=await s.create();
  for(const {id} of [first,second])await s.api(`/api/cases/${id}`,{method:'DELETE'});
  const body=trashInput(s.desk);await s.api(`/api/cases/${second.id}/restore`,{method:'POST',body:'{}'});
  assert.equal((await s.api('/api/trash/empty',{method:'POST',body})).status,409);
  assert.ok(await fs.stat(path.join(s.root,'신청별 자료',first.id)));assert.equal(s.desk.store.data.cases[first.id].purgeRequestedAt,undefined);
  s.desk.store.data.jobs.push({id:'busy-job',caseId:first.id,status:'running'});
  const response=await s.api('/api/trash/empty',{method:'POST',body:trashInput(s.desk)});assert.equal(response.status,409);assert.equal((await response.json()).code,'CASE_BUSY');
});

test('empty trash only removes the confirmed snapshot and leaves newly trashed cases',async t=>{
  const s=await setup(t);const first=await s.create();const second=await s.create();
  await s.api(`/api/cases/${first.id}`,{method:'DELETE'});const body=trashInput(s.desk);
  await s.api(`/api/cases/${second.id}`,{method:'DELETE'});
  const response=await s.api('/api/trash/empty',{method:'POST',body});assert.equal((await response.json()).deletedCount,1);
  assert.deepEqual(s.desk.publicState().trashCases.map(c=>c.id),[second.id]);assert.ok(await fs.stat(path.join(s.root,'신청별 자료',second.id)));
});

test('failed file cleanup remains retryable and cannot restore partly removed files',async t=>{
  const s=await setup(t);const first=await s.create();const second=await s.create();
  for(const {id} of [first,second])await s.api(`/api/cases/${id}`,{method:'DELETE'});
  const originalRm=fs.rm;const failingDir=path.join(s.root,'신청별 자료',first.id);
  const mock=t.mock.method(fs,'rm',async(target,options)=>{if(target===failingDir)throw Object.assign(new Error('파일 사용 중'),{code:'EBUSY'});return originalRm(target,options);});
  const result=await(await s.api('/api/trash/empty',{method:'POST',body:trashInput(s.desk)})).json();
  assert.equal(result.ok,false);assert.equal(result.deletedCount,1);assert.equal(result.failedCases[0].id,first.id);
  assert.equal(s.desk.publicState().trashCases[0].purgePending,true);
  assert.equal((await s.api(`/api/cases/${first.id}/restore`,{method:'POST',body:'{}'})).status,409);
  assert.ok((await new Store(s.root).init()).data.cases[first.id].purgeRequestedAt);
  mock.mock.restore();
  assert.equal((await(await s.api('/api/trash/empty',{method:'POST',body:trashInput(s.desk)})).json()).deletedCount,1);
  assert.equal(s.desk.publicState().trashCases.length,0);
});

test('concurrent empty and restore requests cannot race a permanent deletion',async t=>{
  const s=await setup(t);const {id}=await s.create();await s.api(`/api/cases/${id}`,{method:'DELETE'});
  const body=trashInput(s.desk), originalRm=fs.rm, targetDir=path.join(s.root,'신청별 자료',id);
  let entered,release;const deleting=new Promise(resolve=>{entered=resolve;});const proceed=new Promise(resolve=>{release=resolve;});
  const mock=t.mock.method(fs,'rm',async(target,options)=>{if(target===targetDir){entered();await proceed;}return originalRm(target,options);});
  const first=s.api('/api/trash/empty',{method:'POST',body});await deleting;
  try {
    assert.equal((await s.api('/api/trash/empty',{method:'POST',body})).status,409);
    assert.equal((await s.api(`/api/cases/${id}/restore`,{method:'POST',body:'{}'})).status,409);
  } finally { release(); }
  assert.equal((await(await first).json()).deletedCount,1);mock.mock.restore();
  assert.equal(s.desk.publicState().trashCases.length,0);
});

test('translation is explicit, validates source revision and leaves original reference unchanged',async t=>{
  const s=await setup(t);const {id,detail}=await s.create();assert.equal(s.calls.translate,0);
  const route=`/api/cases/${id}/translate`;
  assert.equal((await s.api(route,{method:'POST',body:JSON.stringify({expectedSourceHash:'old'})})).status,409);assert.equal(s.calls.translate,0);
  const response=await s.api(route,{method:'POST',body:JSON.stringify({expectedSourceHash:detail.screening.sourceHash})});assert.equal(response.status,200);
  const result=await response.json();assert.match(result.detail.tracks[0].lyrics,/번역 : 안녕/);assert.equal(result.translatedCount,1);assert.equal(s.calls.translate,1);
  assert.equal(result.detail.importInfo.extractedText,'원문 전체\nhello');assert.equal(s.calls.remote,0);
});

test('metadata edited during translation is retained without applying stale overrides',async t=>{
  let s,id;
  s=await setup(t,{onTranslate:async()=>{
    const saved=await s.api(`/api/cases/${id}/local`,{method:'PATCH',body:JSON.stringify({overrides:{submission:{title:'번역 중 수정한 제목'}}})});
    assert.equal(saved.status,200);
  }});
  const created=await s.create();id=created.id;
  const response=await s.api(`/api/cases/${id}/translate`,{method:'POST',body:JSON.stringify({expectedSourceHash:created.detail.screening.sourceHash})});
  assert.equal(response.status,409);
  const current=await s.desk.detail(id);
  assert.equal(current.submission.title,'번역 중 수정한 제목');assert.equal(current.tracks[0].lyrics,'hello');
});

test('generation includes connected manual media and remains stale after concurrent document edits',async t=>{
  let s,id;
  s=await setup(t,{onGenerate:async({files})=>{
    assert.equal(files.length,1);assert.match(files[0].name,/received\.wav$/);
    const saved=await s.api(`/api/cases/${id}/local`,{method:'PATCH',body:JSON.stringify({overrides:{submission:{title:'생성 중 수정한 제목'}}})});assert.equal(saved.status,200);
  }});
  id=(await s.create()).id;
  assert.equal((await s.api(`/api/cases/${id}/attachments?filename=received.wav`,{method:'POST',body:'RIFF fixture'})).status,200);
  const job=s.desk.enqueue(id,'generate');await s.desk.idle();assert.equal(job.status,'completed');
  assert.equal(s.desk.store.data.cases[id].sourceChanged,true);
  assert.equal((await s.desk.detail(id)).submission.title,'생성 중 수정한 제목');
});
