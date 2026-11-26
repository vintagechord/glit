// Synthetic manual-work UI contract test. No customer data, live services, or real emails.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-manual-ui-'));
const here = path.resolve('tools/onside-desk/public');
const staticFiles = { '/': (await fs.readFile(path.join(here, 'index.html'), 'utf8')).replace('__CSRF_TOKEN__', 'fixture'), '/app.js': await fs.readFile(path.join(here, 'app.js'), 'utf8'), '/styles.css': await fs.readFile(path.join(here, 'styles.css'), 'utf8') };
const albumId = 'manual-11111111-1111-4111-8111-111111111111', mvId = 'manual-22222222-2222-4222-8222-222222222222', onlineId = '33333333-3333-4333-8333-333333333333';
const clone = value => structuredClone(value);
const local = () => ({stage:'RECEIVED',notes:'',dueDate:'',checklist:{},overrides:{}});
const submissions = [
 {id:albumId,source:'manual',type:'ALBUM',title:'수동 음반 예시',artist_name:'한별',created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z',applicant_name:'예시 신청자',applicant_email:'artist@example.invalid'},
 {id:mvId,source:'manual',type:'MV_DISTRIBUTION',title:'수동 뮤비 예시',artist_name:'HANA',created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z',mv_lyrics:'별이 빛나는 밤',mv_runtime:'3분 20초',mv_storyline:'밤의 도시를 걷는 주인공'},
 {id:onlineId,type:'ALBUM',title:'온라인 신청 예시',artist_name:'온라인 아티스트',status:'IN_PROGRESS',payment_status:'PAID',created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z'},
];
const state={trashCases:[],connection:{configured:true,connected:true,resultsConfigured:true},settings:{autoSync:true,autoGenerate:false},cases:submissions.map(s=>({...s,local:local()})),jobs:[],lastSync:'2026-10-25T01:00:00Z'};
const finding={id:'f1',kind:'suspected',severity:'warning',trackNo:1,trackTitle:'첫 곡',line:2,excerpt:'<script>의심 표현</script>',message:'원문 문맥과 방송 심의 표현을 확인해 주세요.'};
const details=new Map(submissions.map(s=>[s.id,{source:s.source,submission:clone(s),sourceSubmission:clone(s),local:state.cases.find(c=>c.id===s.id).local,tracks:s.type==='ALBUM'?[{id:'local-44444444-4444-4444-8444-444444444444',track_no:1,track_title:'첫 곡',lyrics:'첫 번째 줄\n외국어 가사',composer:'한별',lyricist:'한별'}]:[],assets:[],files:[],warnings:[],generations:[],localAttachments:[],history:[],importInfo:{filename:'이메일로 받은 기준파일.hwp',format:'HWP',warnings:['트랙 구분을 원문과 확인해 주세요.'],extractedText:'앨범명: 수동 음반 예시\n<script>원문 확인</script>'},screening:{sourceHash:'a'.repeat(64),findings:s.type==='ALBUM'?[finding,{...finding,id:'f2',kind:'translation_missing',excerpt:'외국어 가사',message:'한국어 번역이 없습니다.'}]:[],counts:{suspected:s.type==='ALBUM'?1:0,translation_missing:s.type==='ALBUM'?1:0},requiresReview:s.type==='ALBUM',acknowledged:false}}]));
const calls=[];const errors=[];
const T1='local-44444444-4444-4444-8444-444444444444',T2='local-66666666-6666-4666-8666-666666666666';
const audio={engine:{installed:false,version:null,uv:null,needsUpdate:false}};
const audioRoute=p=>p.match(/^\/api\/cases\/([^/]+)\/audio-check(?:\/(\w+))?$/);
let translationCalls=0;
const options={headless:true};const chrome=process.env.ONSIDE_TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';if(await fs.access(chrome).then(()=>true,()=>false))options.executablePath=chrome;
const browser=await chromium.launch(options);const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url()),p=url.pathname;
 if(p in staticFiles)return route.fulfill({contentType:p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html',body:staticFiles[p]});
 if(p==='/api/state')return route.fulfill({json:state});
 if(p==='/api/trash/empty'){
  const body=request.postDataJSON();assert.equal(body.confirmation,'EMPTY_TRASH');assert.equal(body.cases.length,1);
  const ids=new Set(body.cases.map(c=>c.id));state.trashCases=state.trashCases.filter(c=>!ids.has(c.id));calls.push({kind:'empty-trash'});
  return route.fulfill({json:{ok:true,deletedCount:ids.size,failedCases:[]}});
 }
 if(p==='/api/manual/import'){
  calls.push({kind:'import',type:url.searchParams.get('type'),filename:url.searchParams.get('filename')});
  const id='manual-55555555-5555-4555-8555-555555555555',type=url.searchParams.get('type');const s={id,source:'manual',type,title:type==='ALBUM'?'가져온 음반':'가져온 뮤비',artist_name:'Derringer',mv_director:'검증 감독',mv_lead_actor:'검증 주연',mv_storyline:'기준파일의 줄거리',created_at:'2026-10-25T02:00:00Z',updated_at:'2026-10-25T02:00:00Z',mv_lyrics:'하늘의 별빛',original_lyrics:'이전 뮤비 원문',mv_runtime:'3분 30초'};
  const d={...clone(details.get(type==='ALBUM'?albumId:mvId)),source:'manual',submission:s,sourceSubmission:s,local:local(),importInfo:{filename:url.searchParams.get('filename'),format:'DOCX',warnings:[],extractedText:'가져온 원문'}};details.set(id,d);state.cases.push({...s,local:d.local});return route.fulfill({json:{id,detail:d}});
 }
 if(p==='/api/audio-engine')return route.fulfill({json:audio.engine});
 if(p==='/api/audio-engine/install'){calls.push({kind:'audio-install'});audio.engine={installed:true,version:'1',uv:'/opt/homebrew/bin/uv',needsUpdate:false};const job={id:'job-install',caseId:null,kind:'audio-install',status:'completed',message:'분석 도구를 설치했습니다.',createdAt:'2026-11-26T12:00:00Z'};state.jobs.unshift(job);return route.fulfill({status:202,json:{job}});}
 const streamMatch=p.match(/^\/api\/cases\/([^/]+)\/attachments\/([^/]+)\/stream$/);
 if(streamMatch){calls.push({kind:'audio-stream',attachment:streamMatch[2]});return route.fulfill({contentType:'audio/wav',body:'RIFF'});}
 const am=audioRoute(p);
 if(am){
  const d=details.get(am[1]),act=am[2];calls.push({kind:'audio-'+act,method:request.method(),body:request.method()==='GET'?undefined:request.postDataJSON()});
  if(act==='mapping'){const merged={...d.audioCheck.effective,...request.postDataJSON().mapping};d.audioCheck={...d.audioCheck,mapping:merged,effective:merged};return route.fulfill({json:{audioCheck:d.audioCheck}});}
  if(act==='cancel'){const job=state.jobs.find(j=>j.kind==='audio-check'&&j.status==='running');if(job){job.status='cancelled';job.message='음원 대조를 중지했습니다.';}return route.fulfill({json:{cancelled:!!job}});}
  if(!act){const job={id:'job-audio-1',caseId:am[1],kind:'audio-check',status:'running',message:'1/2 받아쓰는 중 · 01 첫 곡',createdAt:'2026-11-26T12:40:00Z'};state.jobs.unshift(job);return route.fulfill({status:202,json:{job}});}
  if(act==='apply'){
   const body=request.postDataJSON(),run=d.audioCheck.latest;assert.equal(body.runId,run.id);const track=run.tracks[0];const lines=d.tracks[0].lyrics.split('\n'),inserts=[];
   for(const it of body.items){const s=track.suggestions.find(x=>x.id===it.suggestionId);inserts.push({at:s.op.afterLine+1,lines:it.text!==undefined?it.text.split('\n'):s.op.lines});track.applied.push(s.id);}
   inserts.sort((a,b)=>b.at-a.at).forEach(x=>lines.splice(x.at,0,...x.lines));d.tracks[0].lyrics=lines.join('\n');d.audioCheck.staleTracks=[T1,T2];
   return route.fulfill({json:{detail:d,applied:body.items.length,onlineSync:null}});
  }
  return route.fulfill({status:400,json:{error:'Unexpected audio call'}});
 }
 const match=p.match(/^\/api\/cases\/([^/]+)(?:\/(\w+))?$/);
 if(match){const[,id,action]=match;const d=details.get(id);if(!d)return route.fulfill({status:404,json:{error:'missing'}});
  if(!action && request.method()==='DELETE'){ const c=state.cases.find(c=>c.id===id);state.cases=state.cases.filter(c=>c.id!==id);state.trashCases.push({...c,deletedAt:'2026-10-25T05:00:00Z'});calls.push({kind:'delete',id});return route.fulfill({json:{ok:true}}); }
  if(action==='restore'){ const c=state.trashCases.find(c=>c.id===id);state.trashCases=state.trashCases.filter(c=>c.id!==id);state.cases.push(c);calls.push({kind:'restore',id});return route.fulfill({json:{ok:true}}); }
  if(!action)return route.fulfill({json:d});
  calls.push({kind:action,id,method:request.method(),body:['local','translate'].includes(action)?request.postDataJSON():undefined});
  if(action==='local'){
   const patch=request.postDataJSON();Object.assign(d.local,patch);if(patch.overrides){Object.assign(d.submission,patch.overrides.submission);for(const t of patch.overrides.tracks||[]) {const old=d.tracks.find(x=>x.id===t.id);if(old)Object.assign(old,t);else d.tracks.push(t);}d.tracks=d.tracks.filter(t=>!t._deleted);d.screening.sourceHash='b'.repeat(64);}
   d.screening.acknowledged=d.local.reviewAcknowledgedRevision===d.screening.sourceHash;Object.assign(state.cases.find(c=>c.id===id),d.submission,{local:d.local});return route.fulfill({json:{local:d.local}});
  }
  if(action==='translate'){translationCalls++;assert.equal(request.postDataJSON().expectedSourceHash,d.screening.sourceHash);if(translationCalls===1)return route.fulfill({status:503,json:{error:'번역 연결 확인이 필요합니다.'}});d.tracks[0].original_lyrics=d.tracks[0].lyrics;d.tracks[0].translated_lyrics='예시 한국어 번역';d.tracks[0].korean_lyrics_translation='이전 한국어 번역';d.screening.sourceHash='c'.repeat(64);d.screening.findings=d.screening.findings.filter(f=>f.kind!=='translation_missing');d.screening.counts.translation_missing=0;d.screening.acknowledged=false;return route.fulfill({json:{detail:d,translatedCount:1,warnings:['번역을 원문과 대조하세요.']}});}
  if(action==='attachments'){d.localAttachments.push({name:url.searchParams.get('filename'),bytes:10,createdAt:'2026-10-25T03:00:00Z'});return route.fulfill({json:{attachment:d.localAttachments.at(-1)}});}
  if(action==='generate'){const g={id:'generation-1',createdAt:'2026-10-25T03:00:00Z',warnings:[],artifacts:d.submission.type==='ALBUM'?[{name:'음반_DOCX_모음.zip',bytes:100},{name:'가사_확인사항.txt',bytes:40}]:[{name:'가사_Derringer_가져온 뮤비.doc',bytes:100},{name:'영등위_복사용.html',bytes:40}]};d.generations.push(g);state.cases.find(c=>c.id===id).latestGeneration=g;return route.fulfill({status:202,json:{job:{id:'job-1'}}});}
  if(action==='reference')return route.fulfill({contentType:'application/octet-stream',headers:{'Content-Disposition':"attachment; filename*=UTF-8''reference.hwp"},body:'SYNTHETIC'});
  return route.fulfill({status:400,json:{error:'Unexpected service call'}});
 }
 if(p.startsWith('/api/artifacts/')){const name=decodeURIComponent(p.split('/').at(-1));return route.fulfill({contentType:'application/octet-stream',headers:{'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`},body:'SYNTHETIC ZIP FIXTURE'});}
 return route.fulfill({status:404,json:{error:'Unexpected endpoint'}});
});
try {
 await page.goto('https://manual-desk.test/');await page.locator('[data-case]').filter({hasText:'온라인 신청 예시'}).waitFor();assert.equal(await page.locator('#nav-count').textContent(),'1');assert.equal(await page.locator('#manual-count').textContent(),'2');assert.equal(await page.locator('[data-case]').filter({hasText:'수동 음반 예시'}).count(),0);
 await page.getByRole('button',{name:/관리자 수동 작업/}).click();await page.getByRole('heading',{name:'관리자 수동 작업 · 음반'}).waitFor();assert.equal(await page.locator('[data-case]').filter({hasText:'온라인 신청 예시'}).count(),0);assert.equal(await page.locator('[data-case]').filter({hasText:'수동 뮤비 예시'}).count(),0);assert.equal(await page.locator('#refresh-top').isVisible(),false);
 await page.locator('[data-case]').filter({hasText:'수동 음반 예시'}).click();await page.getByRole('tab',{name:'검토사항',exact:true}).click();await page.getByText('한국어 번역이 없습니다.',{exact:true}).waitFor();assert.equal(await page.getByRole('tab',{name:'심의 결과',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/이메일.*미리보기/}).count(),0);assert.equal(await page.locator('#screen script,#screen img').count(),0);assert.match(await page.locator('.preparation-warnings').innerText(),/의심 표현|한국어 번역/);
 await page.locator('#manual-review-ack').check();await page.waitForTimeout(120);assert.equal(details.get(albumId).local.reviewAcknowledgedRevision,'a'.repeat(64));await page.screenshot({path:path.join(artifacts,'manual-review.png'),fullPage:true});
 assert.equal(translationCalls,0);await page.getByRole('button',{name:'미번역 가사 번역',exact:true}).click();await page.getByText(/번역을 완료하지 못했습니다\./).first().waitFor();assert.equal(details.get(albumId).tracks[0].lyrics,'첫 번째 줄\n외국어 가사');await page.getByRole('button',{name:'미번역 가사 번역',exact:true}).click();await page.getByText('1개 가사의 한국어 번역을 추가했습니다. 원문과 대조해 주세요.',{exact:false}).first().waitFor();assert.equal(translationCalls,2);assert.equal(await page.locator('#manual-review-ack').isChecked(),false);assert.equal(details.get(albumId).tracks[0].translated_lyrics,'예시 한국어 번역');
 await page.getByRole('button',{name:'가사·정보 수정',exact:true}).click();await page.locator('[name=sub_applicant_name]').fill('변경 신청자');await page.locator('[name=track_0_lyrics]').fill('수정한 첫 번째 줄\n외국어 가사');await page.getByRole('button',{name:'수정 내용 저장',exact:true}).click();await page.waitForTimeout(150);assert.equal(details.get(albumId).submission.applicant_name,'변경 신청자');await page.getByRole('tab',{name:'검토사항',exact:true}).click();assert.equal(await page.locator('#manual-review-ack').isChecked(),false);
 await page.getByRole('button',{name:'가사·정보 수정',exact:true}).click();assert.equal(await page.locator('[name=track_0_translated_lyrics]').inputValue(),'예시 한국어 번역');await page.locator('[name=track_0_lyrics]').fill('');await page.locator('[name=track_0_translated_lyrics]').fill('');await page.getByRole('button',{name:'수정 내용 저장',exact:true}).click();await page.getByText('문서용 수정 내용을 저장했습니다. 새 문서를 생성해 적용하세요.',{exact:true}).waitFor();await page.getByRole('tab',{name:'검토사항',exact:true}).click();await page.getByRole('button',{name:'가사·정보 수정',exact:true}).click();assert.equal(await page.locator('[name=track_0_lyrics]').inputValue(),'');assert.equal(await page.locator('[name=track_0_translated_lyrics]').inputValue(),'');assert.equal(details.get(albumId).tracks[0].original_lyrics,'첫 번째 줄\n외국어 가사');assert.equal(details.get(albumId).tracks[0].korean_lyrics_translation,'이전 한국어 번역');
 await page.getByRole('tab',{name:'자료 준비',exact:true}).click();await page.getByRole('tab',{name:'원본 · 복사',exact:true}).click();await page.locator('#local-attachments').setInputFiles({name:'받은 음원.wav',mimeType:'audio/wav',buffer:Buffer.from('RIFF fixture')});await page.getByText('받은 음원.wav',{exact:true}).waitFor();assert.equal(details.get(albumId).localAttachments.length,1);
 const originalDownload=page.waitForEvent('download');await page.getByRole('link',{name:'기준파일 원본 다운로드'}).click();assert.equal((await originalDownload).suggestedFilename(),'이메일로 받은 기준파일.hwp');
 await page.getByRole('button',{name:'▱ 심의 자료 생성',exact:true}).click();await page.getByRole('tab',{name:/^생성 파일/}).click();await page.getByRole('button',{name:'↓ 전체 심의서류 다운로드 (DOCX ZIP)',exact:true}).waitFor();const download=page.waitForEvent('download');await page.getByRole('button',{name:'↓ 전체 심의서류 다운로드 (DOCX ZIP)',exact:true}).click();assert.equal((await download).suggestedFilename(),'음반_DOCX_모음.zip');
 await page.locator('[data-manual-type=MV]').click();await page.getByRole('heading',{name:'관리자 수동 작업 · 뮤비'}).waitFor();assert.equal(await page.locator('[data-case]').filter({hasText:'수동 음반 예시'}).count(),0);await page.getByRole('button',{name:'기준파일로 작업 만들기',exact:true}).click();assert.equal(calls.filter(c=>c.kind==='import').length,0);
 await page.locator('#manual-reference').setInputFiles({name:'뮤비 기준정보.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from('SYNTHETIC DOCX fixture')});await page.screenshot({path:path.join(artifacts,'manual-import.png'),fullPage:false});await page.getByRole('button',{name:'기준파일로 작업 만들기',exact:true}).click();await page.locator('[name=sub_title]').waitFor();assert.equal(await page.locator('[name=sub_title]').inputValue(),'가져온 뮤비');assert.equal(await page.locator('[name=sub_artist_name]').inputValue(),'Derringer');assert.equal(await page.locator('[name=sub_mv_director]').inputValue(),'검증 감독');assert.equal(await page.locator('[name=sub_mv_lead_actor]').inputValue(),'검증 주연');assert.equal(await page.locator('[name=sub_mv_storyline]').inputValue(),'기준파일의 줄거리');assert.equal(await page.locator('[name^=track_]').count(),0);assert.equal(calls.filter(c=>c.kind==='import').length,1);assert.equal(calls.find(c=>c.kind==='import').type,'MV_DISTRIBUTION');
 await page.locator('[name=sub_mv_lyrics]').fill('');await page.getByRole('button',{name:'수정 내용 저장',exact:true}).click();await page.getByText('문서용 수정 내용을 저장했습니다. 새 문서를 생성해 적용하세요.',{exact:true}).waitFor();await page.getByRole('tab',{name:'검토사항',exact:true}).click();await page.getByRole('button',{name:'가사·정보 수정',exact:true}).click();assert.equal(await page.locator('[name=sub_mv_lyrics]').inputValue(),'');
 await page.getByRole('tab',{name:'원본 · 복사',exact:true}).click();await page.getByRole('heading',{name:'영등위 심의 신청 입력용 정보'}).waitFor();assert.match(await page.locator('.copy-box pre').innerText(),/3분 30초/);assert.doesNotMatch(await page.locator('.copy-box pre').innerText(),/이전 뮤비 원문|하늘의 별빛/);await page.getByRole('button',{name:'▱ 심의 자료 생성',exact:true}).click();await page.getByRole('tab',{name:/^생성 파일/}).click();const mvDownload=page.waitForEvent('download');assert.equal(await page.locator('.artifact-button').count(),2);await page.locator('[data-artifact="가사_Derringer_가져온 뮤비.doc"]').click();assert.equal((await mvDownload).suggestedFilename(),'가사_Derringer_가져온 뮤비.doc');assert.equal(await page.locator('[data-artifact$=".zip"]').count(),0);await page.screenshot({path:path.join(artifacts,'mv-two-files.png'),fullPage:false});
 await page.getByRole('button',{name:/신청 관리/}).click();await page.locator('[data-case]').filter({hasText:'온라인 신청 예시'}).waitFor();assert.equal(await page.locator('[data-case]').filter({hasText:'가져온 뮤비'}).count(),0);assert.equal(await page.locator('#nav-count').textContent(),'1');assert.equal(await page.locator('#manual-count').textContent(),'3');
 await page.getByRole('button',{name:/관리자 수동 작업/}).click();await page.setViewportSize({width:950,height:1000});await page.screenshot({path:path.join(artifacts,'manual-compact.png'),fullPage:false});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.nav-item,#manual-subnav button')].every(el=>el.getBoundingClientRect().right<=document.querySelector('.sidebar').getBoundingClientRect().right)),true);assert.equal(calls.some(c=>['results','email-preview','certificate'].includes(c.kind)),false);
 await page.locator('[data-delete-case="manual-55555555-5555-4555-8555-555555555555"]').click();await page.getByRole('button',{name:'목록에서 삭제',exact:true}).last().click();await page.getByRole('button',{name:/목록 휴지통/}).click();await page.getByRole('heading',{name:'목록 휴지통',exact:true}).waitFor();assert.equal(await page.locator('.trash-list article').count(),1);assert.match(await page.locator('.trash-panel').innerText(),/온라인 서비스의 신청·결과는 유지/);await page.getByRole('button',{name:'목록으로 복원',exact:true}).click();await page.getByText('목록에서 삭제한 신청이 없습니다.',{exact:true}).waitFor();assert.equal(state.cases.length,4);assert.equal(calls.filter(c=>c.kind==='delete').length,1);assert.equal(calls.filter(c=>c.kind==='restore').length,1);assert.deepEqual(errors,[]);
 assert.equal(await page.getByRole('button',{name:'휴지통 비우기',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:/관리자 수동 작업/}).click();await page.locator('[data-delete-case="manual-55555555-5555-4555-8555-555555555555"]').click();await page.locator('#confirm-dialog [value=confirm]').click();await page.getByRole('button',{name:/목록 휴지통/}).click();
 await page.getByRole('button',{name:'휴지통 비우기',exact:true}).click();await page.getByRole('heading',{name:'휴지통을 영구적으로 비울까요?'}).waitFor();assert.match(await page.locator('#confirm-message').innerText(),/1건.*기준파일.*되돌릴 수 없습니다/);await page.locator('#confirm-dialog [value=cancel]').click();assert.equal(calls.filter(c=>c.kind==='empty-trash').length,0);assert.equal(state.trashCases.length,1);
 await page.getByRole('button',{name:'휴지통 비우기',exact:true}).click();await page.screenshot({path:path.join(artifacts,'empty-trash-confirm.png'),fullPage:false});await page.getByRole('button',{name:'1건 영구 삭제',exact:true}).click();await page.getByText('목록에서 삭제한 신청이 없습니다.',{exact:true}).waitFor();assert.equal(calls.filter(c=>c.kind==='empty-trash').length,1);assert.equal(state.cases.length,3);assert.equal(await page.getByRole('button',{name:'휴지통 비우기',exact:true}).isDisabled(),true);assert.deepEqual(errors,[]);
 // 음원 가사 대조 (검토사항 탭)
 {
  const d=details.get(albumId);d.local.overrides={};d.tracks=[{...d.tracks[0],id:T1,lyrics:'첫 번째 줄\n두 번째 줄\n세 번째 줄'},{id:T2,track_no:2,track_title:'둘째 곡 (MR)',lyrics:'둘째 가사',composer:'한별',lyricist:'한별'}];
  d.localAttachments=[{id:'a1',name:'01_첫 곡.wav',bytes:10},{id:'a2',name:'01_첫 곡.mp3',bytes:10},{id:'a3',name:'02_둘째 곡 (MR).wav',bytes:10},{id:'doc1',name:'메모.pdf',bytes:5}];
  const base={mapping:{},auto:{mapping:{[T1]:'a1',[T2]:'a3'},duplicates:[{trackId:T1,attachmentId:'a2'}],mrPairs:{[T2]:T1},unmapped:[]},effective:{[T1]:'a1',[T2]:'a3'},latest:null,staleTracks:[]};
  const sug=(id,kind,confidence,start,end,op,hint='')=>({id,trackId:T1,kind,confidence,start,end,op,hint,score:5,lines:[]});
  const makeRun=()=>({id:'run-1',status:'ok',createdAt:'2026-11-26T12:30:00Z',finishedAt:'2026-11-26T12:45:00Z',engineVersion:'1',tracks:[
   {trackId:T1,attachmentId:'a1',lyricsHash:'h1',separation:'demucs',duration:200,foreign:false,status:'ok',applied:[],suggestions:[
    sug('s1','repeat','high',174,180,{type:'insertLines',afterLine:1,lines:['반복되는 <script>줄</script>']}),
    sug('s2','new','check',15,20,{type:'insertLines',afterLine:-1,lines:['처음 듣는 구절']},'처음 듣는 구절'),
    sug('s3','replace','medium',57,60,{type:'replaceLine',lines:[2],from:'세 번째 줄',to:'세 번째 바뀐 줄'}),
    sug('s4','unclear','check',90,95,null),
    sug('s5','repeat','medium',100,104,{type:'deleteLines',from:0,to:0})]},
   {trackId:T2,attachmentId:'a3',lyricsHash:'h2',separation:'mr',duration:180,foreign:true,status:'ok',applied:[],suggestions:[]}]});
  const openReview=async()=>{await page.getByRole('button',{name:/관리자 수동 작업/}).click();await page.locator('[data-manual-type=ALBUM]').click();await page.locator('[data-case]').filter({hasText:'수동 음반 예시'}).click();await page.getByRole('tab',{name:'검토사항',exact:true}).click();};
  const section=page.locator('#audio-check');
  // 1. engine missing: install notice only (uv missing -> guidance, install disabled)
  d.audioCheck=clone(base);await openReview();await section.waitFor();
  assert.match(await section.innerText(),/약 2\.5–3GB, 처음 한 번/);assert.match(await section.innerText(),/brew install uv/);assert.equal(await page.getByRole('button',{name:'음원 대조 시작'}).count(),0);assert.equal(await page.locator('[data-action=audio-install]').isDisabled(),true);assert.equal(await section.locator('select').count(),0);
  audio.engine={installed:false,version:null,uv:'/opt/homebrew/bin/uv',needsUpdate:false};await page.locator('[data-case]').filter({hasText:'수동 음반 예시'}).click();await page.getByRole('tab',{name:'검토사항',exact:true}).click();
  assert.equal(await page.locator('[data-action=audio-install]').isDisabled(),false);assert.equal(await page.getByRole('button',{name:'음원 대조 시작'}).count(),0);
  await page.locator('[data-action=audio-install]').click();await page.getByRole('button',{name:'음원 대조 시작'}).waitFor();assert.equal(calls.filter(c=>c.kind==='audio-install').length,1);
  // 2. mapping rows, copy, mapping PATCH sends the full mapping (swap)
  assert.match(await section.innerText(),/약 15–25분 \(Mac 부하에 따라\) 예상 · 이 Mac에서만 처리/);assert.match(await section.innerText(),/연결된 음원 3개 · 트랙 2곡/);assert.match(await section.innerText(),/01_첫 곡\.mp3 중복·사용 안 함/);assert.match(await section.innerText(),/MR · 1번과 짝/);
  assert.equal(await section.locator(`[data-audio-map="${T1}"] option`).count(),4);
  await section.locator(`[data-audio-map="${T1}"]`).selectOption('a3');await page.waitForFunction(()=>document.querySelector('#audio-check [data-audio-map]'));
  const patch=calls.find(c=>c.kind==='audio-mapping');assert.equal(patch.method,'PATCH');assert.deepEqual(patch.body,{mapping:{[T1]:'a3',[T2]:'a1'}});
  await page.waitForFunction(([t])=>document.querySelector(`#audio-check [data-audio-map="${t}"]`).value==='a3',[T1]);
  // 3. results: defaults, count, escaping, diffs, foreign, stale, play
  d.audioCheck={...clone(base),latest:makeRun(),staleTracks:[T2]};await page.locator('[data-case]').filter({hasText:'수동 음반 예시'}).click();await page.getByRole('tab',{name:'검토사항',exact:true}).click();await page.locator('[data-audio-pick=s1]').waitFor();
  assert.equal(await page.locator('[data-audio-pick=s1]').isChecked(),true);assert.equal(await page.locator('[data-audio-pick=s2]').isChecked(),false);assert.equal(await page.locator('[data-audio-pick=s3]').isChecked(),false);assert.equal(await page.locator('[data-audio-pick=s4]').count(),0);
  const applyBtn=page.locator('[data-action=audio-apply]');assert.match(await applyBtn.innerText(),/선택한 제안 반영 \(1개\)/);
  const text=await section.innerText();assert.match(text,/반복 구절 누락/);assert.match(text,/새 구절/);assert.match(text,/다르게 불림/);assert.match(text,/알아듣지 못한 보컬 구간/);assert.match(text,/강함/);assert.match(text,/보통/);assert.match(text,/확인 필요/);assert.match(text,/2:54/);assert.match(text,/외국어 비중이 높아 정확도가 낮을 수 있음/);assert.match(text,/가사가 바뀌어 다시 대조가 필요합니다/);assert.match(text,/세 번째 줄.*→.*세 번째 바뀐 줄/s);assert.match(text,/\+ 반복되는/);
  assert.equal(await page.locator('#screen script').count(),0);assert.equal(await section.locator('del').count()>=2,true);
  assert.equal(await page.locator('[data-audio-text=s2]').inputValue(),'처음 듣는 구절');
  await page.locator('[data-audio-pick=s2]').check();assert.match(await applyBtn.innerText(),/\(2개\)/);
  // a cleared new-text box is not counted or sent (it would insert a blank line)
  await page.locator('[data-audio-text=s2]').fill('  \n ');assert.match(await applyBtn.innerText(),/\(1개\)/);
  await page.locator('[data-audio-text=s2]').fill('편집한 새 구절');assert.match(await applyBtn.innerText(),/\(2개\)/);
  await page.locator('[data-audio-pick=s2]').uncheck();await page.locator('[data-audio-pick=s2]').check();
  assert.equal(await page.locator('[data-audio-text=s2]').inputValue(),'편집한 새 구절');
  // 4. play: audio element lives outside the detail panel
  assert.equal(await page.locator('#detail-panel #audio-player').count(),0);assert.equal(await page.locator('#audio-player').count(),1);
  await page.locator('[data-action=audio-play]').first().click();assert.match(await page.locator('#audio-player').getAttribute('src'),/\/attachments\/a1\/stream$/);assert.equal(await page.locator('#audio-player').getAttribute('data-start-at'),'173');assert.equal(await page.locator('#audio-player').getAttribute('data-stop-at'),'181');
  // 5. dirty edits block applying
  await page.evaluate(()=>{ui.dirty=true;detailRender();});assert.equal(await applyBtn.isDisabled(),true);await page.evaluate(()=>{ui.dirty=false;detailRender();});assert.equal(await applyBtn.isDisabled(),false);
  // 6. apply
  await applyBtn.click();await page.locator('#audio-check').getByText('반영됨').first().waitFor();
  const applyCall=calls.find(c=>c.kind==='audio-apply');assert.equal(applyCall.body.runId,'run-1');assert.deepEqual(applyCall.body.items,[{suggestionId:'s1'},{suggestionId:'s2',text:'편집한 새 구절'}]);
  assert.equal(await page.locator('[data-audio-pick]').count(),0);
  await page.getByRole('button',{name:'가사·정보 수정',exact:true}).click();assert.equal(await page.locator('[name=track_0_lyrics]').inputValue(),'편집한 새 구절\n첫 번째 줄\n두 번째 줄\n반복되는 <script>줄</script>\n세 번째 줄');
  await page.getByRole('tab',{name:'검토사항',exact:true}).click();assert.match(await section.innerText(),/제안 반영|반영됨/);
  // 7. run in progress: progress + stop; generate button stays enabled; jobs table labels
  await page.getByRole('button',{name:'음원 대조 시작'}).click();await section.getByText('1/2 받아쓰는 중 · 01 첫 곡').waitFor();assert.equal(await page.getByRole('button',{name:'중지',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'음원 대조 시작'}).count(),0);assert.equal(await page.locator('.job-inline').count(),0);
  await page.getByRole('tab',{name:'자료 준비',exact:true}).click();assert.equal(await page.locator('[data-action=generate]').isDisabled(),false);assert.equal(await page.locator('.job-inline').count(),0);
  await page.getByRole('tab',{name:'검토사항',exact:true}).click();await page.getByRole('button',{name:'중지',exact:true}).click();await section.getByRole('button',{name:'음원 대조 시작'}).waitFor();assert.equal(calls.filter(c=>c.kind==='audio-cancel').length,1);
  await page.getByRole('button',{name:/작업 현황/}).click();await page.locator('.jobs-table').waitFor();const jobsText=await page.locator('.jobs-table').innerText();assert.match(jobsText,/음원 대조/);assert.match(jobsText,/분석 도구 설치/);assert.match(jobsText,/중지/);assert.doesNotMatch(jobsText,/audio-check|cancelled/);
  // 8. failed run: red notice with track errors and the re-run button
  d.audioCheck={...clone(base),latest:{...makeRun(),status:'failed',tracks:[{trackId:T1,attachmentId:'a1',lyricsHash:'h1',separation:'demucs',duration:0,foreign:false,status:'failed',error:'음원을 읽지 못했습니다.',suggestions:[],applied:[]}]}};
  await openReview();await section.locator('.notice.error').waitFor();assert.match(await section.locator('.notice.error').innerText(),/음원을 읽지 못했습니다\./);assert.equal(await section.getByRole('button',{name:'음원 대조 시작'}).isEnabled(),true);
  // 9. no audio attachment: disabled with the reason
  d.localAttachments=[{id:'doc1',name:'메모.pdf',bytes:5}];d.audioCheck={...clone(base),effective:{[T1]:null,[T2]:null},auto:{mapping:{[T1]:null,[T2]:null},duplicates:[],mrPairs:{},unmapped:[]}};
  await page.locator('[data-case]').filter({hasText:'수동 음반 예시'}).click();await page.getByRole('tab',{name:'검토사항',exact:true}).click();await section.getByText('연결된 음원이 없습니다.').waitFor();assert.equal(await section.getByRole('button',{name:'음원 대조 시작'}).isDisabled(),true);
  // 10. online and MV cases have no audio section
  await page.locator('[data-manual-type=MV]').click();await page.locator('[data-case]').first().click();await page.getByRole('tab',{name:'검토사항',exact:true}).click();assert.equal(await page.locator('#audio-check').count(),0);
  assert.deepEqual(errors,[]);
 }
 console.log(JSON.stringify({passed:true,checks:['separate manual/service lists and counts','album/MV subcategories','manual-only tabs and status','source text escaping','review findings and acknowledgement','translation only on explicit action','translation error preserves original and retry succeeds','acknowledgement reset after edit','cleared album lyrics and translation stay empty after save/reopen','cleared MV lyrics stay empty in edit and copy views','editable applicant contact','local media attachment','reference original download','album document ZIP','manual MV reference import','KMRB copy information','MV only two DOC/HTML downloads','MV one record fields and no tracks','top source and lyric warnings','recoverable local delete and restore','empty-trash cancellation and explicit permanent-delete confirmation','empty-trash disabled when empty','no remote result/mail calls','950px layout','audio check: install-only when engine missing','audio check: full mapping PATCH on swap','audio check: default picks, count, edited new-phrase text, apply','audio check: dirty blocks apply','audio check: progress/stop and generate stays enabled','audio check: jobs table labels','audio check: failed/no-audio states'],artifacts}));
}finally{await browser.close();}
