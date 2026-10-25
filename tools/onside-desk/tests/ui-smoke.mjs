// Synthetic end-to-end UI check. No production credentials or customer data are used.
// Run: node tools/onside-desk/tests/ui-smoke.mjs
import { createDesk } from '../server.mjs';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'onside-ui-'));
const screenshots=path.join(root,'screenshots'); await fs.mkdir(screenshots);
const chromePath=process.env.ONSIDE_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const launchOptions={headless:true};
if (await fs.access(chromePath).then(()=>true,()=>false)) launchOptions.executablePath=chromePath;
const submissions=[
{id:'11111111-1111-4111-8111-111111111111',type:'ALBUM',title:'우리의 계절이 시작되는 곳',artist_name:'윤서 (YUNSEO)',created_at:'2026-10-25T00:15:00Z',release_date:'2026-11-02',status:'PRE_REVIEW',payment_status:'PAID',production_company:'숲 레코즈',distributor:'미러볼뮤직',genre:'인디 / 포크',applicant_name:'김윤서',applicant_email:'artist@example.test',files_submitted_by_email:true},
{id:'22222222-2222-4222-8222-222222222222',type:'MV_DISTRIBUTION',title:'Night Drive',artist_name:'LUNA WAVES',created_at:'2026-10-24T09:00:00Z',release_date:'2026-10-30',status:'IN_REVIEW',payment_status:'PAID',mv_lyrics:'별이 내리는 밤\n오늘도 너를 기다려',mv_director:'박준',mv_runtime:'3분 24초'},
{id:'33333333-3333-4333-8333-333333333333',type:'MV_BROADCAST',title:'겨울에 남겨진 편지',artist_name:'차민',created_at:'2026-10-23T09:00:00Z',status:'SUBMITTED',payment_status:'UNPAID'},
{id:'44444444-4444-4444-8444-444444444444',type:'ALBUM',title:'<img src=x onerror=alert(1)>',artist_name:'검수용 <테스트>',created_at:'2026-10-22T09:00:00Z',status:'SUBMITTED',payment_status:'PAID'}];
const tracks=[1,2,3,4].map(n=>({id:`track-${n}`,track_no:n,track_title:['새로운 시작','그날의 바람','우리의 계절','마지막 편지'][n-1],composer:'윤서',lyricist:'윤서',lyrics:'바람이 불어오는 이곳에\n우리의 이야기를 남겨요',is_title:n===1}));
const source={sourceStatus:()=>({configured:true}),fetchSubmissions:async()=>submissions,fetchSubmission:async id=>({submission:submissions.find(s=>s.id===id),tracks:submissions.find(s=>s.id===id).type==='ALBUM'?tracks:[],assets:[],files:[],stations:[{id:'kbs',name:'KBS 한국방송'}],stationReviews:[{station_id:'kbs',status:'NOT_SENT'}],warnings:[]}),downloadAsset:async()=>({bytes:0})};
const desk=await createDesk({dataRoot:root,port:0,source,generator:async({outputDir})=>{await fs.writeFile(outputDir+'/검증용 자료.txt','심의 자료 파일 검증'); return {artifacts:[{name:'검증용 자료.txt',type:'txt',bytes:30}],warnings:[]};},openFolder:()=>{},timers:false}); await desk.sync();
const browser=await chromium.launch(launchOptions); const page=await browser.newPage({viewport:{width:1440,height:1100}}); page.setDefaultTimeout(8000); const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
await page.goto(`http://127.0.0.1:${desk.server.address().port}`);const paidAlbum=page.locator('[data-case]').filter({hasText:'우리의 계절이 시작되는 곳'});assert.match(await paidAlbum.innerText(),/접수예정/);assert.match(await paidAlbum.innerText(),/결제 완료/);await paidAlbum.click();assert.match(await page.locator('.detail-statuses').innerText(),/접수예정/);assert.match(await page.locator('.detail-statuses').innerText(),/결제 완료/);await page.getByRole('tab',{name:'작업 메모',exact:true}).click();
await page.locator('#notes-form textarea').fill('검수 기록 저장 테스트');await page.locator('#local-stage').selectOption('CHECKING'); await page.waitForTimeout(200);
assert.equal(await page.locator('#notes-form textarea').inputValue(),'검수 기록 저장 테스트');await page.getByRole('button',{name:'메모 저장',exact:true}).click();
await page.evaluate(()=>window.scrollTo(0,0)); await page.screenshot({path:path.join(screenshots,'overview.png'),fullPage:false});
await page.getByRole('tab',{name:'자료 준비',exact:true}).click();await page.getByRole('tab',{name:'문서 정보 수정'}).click();await page.locator('[name="wbs_track_numbers"]').nth(0).check();await page.locator('[name="track_0_is_instrumental"]').check();await page.getByRole('button',{name:'수정 내용 저장',exact:true}).click(); await page.waitForTimeout(200);
assert.equal(desk.store.data.cases[submissions[0].id].local.overrides.tracks[0].is_instrumental,true);assert.deepEqual(desk.store.data.cases[submissions[0].id].local.overrides.submission.wbs_track_numbers,[1]);
await page.getByRole('button',{name:'＋ 트랙 추가',exact:true}).click(); await page.locator('[name="track_4_track_title"]').fill('로컬 추가 트랙');await page.locator('[name="track_4_lyrics"]').fill('추가 가사');await page.getByRole('button',{name:'수정 내용 저장',exact:true}).click();await page.waitForTimeout(200);assert.ok(desk.store.data.cases[submissions[0].id].local.overrides.tracks.find(t=>t.track_title==='로컬 추가 트랙' && t.id.startsWith('local-')));await page.locator('.track-editor').last().locator('summary').click();await page.getByRole('button',{name:'추가한 트랙 삭제',exact:true}).click();await page.getByRole('button',{name:'수정 내용 저장',exact:true}).click();await page.waitForTimeout(150);assert.ok(desk.store.data.cases[submissions[0].id].local.overrides.tracks.find(t=>t._deleted));
await page.getByRole('button',{name:'▱ 심의 자료 생성',exact:true}).click();await page.waitForTimeout(150);await desk.idle();await page.waitForTimeout(3500);await page.getByRole('tab',{name:/^생성 파일/}).click();const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:/검증용 자료.txt/}).click();assert.equal((await downloaded).suggestedFilename(),'검증용 자료.txt');
await page.getByRole('tab',{name:'원본 · 복사'}).click();await page.locator('#local-attachments').setInputFiles({name:'이메일로 받은 최종 음원.wav',mimeType:'audio/wav',buffer:Buffer.from('RIFF TEST')}); await page.waitForTimeout(250);assert.equal(desk.store.data.cases[submissions[0].id].attachments.length,1);
await page.getByRole('button',{name:/데스크 설정/}).click();await page.evaluate(()=>window.scrollTo(0,0)); await page.screenshot({path:path.join(screenshots,'settings.png'),fullPage:false});await page.getByRole('button',{name:'저장 폴더 열기 ↗',exact:true}).click();await page.getByRole('button',{name:'설정 저장',exact:true}).click();
await page.getByRole('button',{name:/신청 관리/}).click();await page.locator('[data-case]').filter({hasText:'Night Drive'}).click();await page.getByRole('tab',{name:'자료 준비',exact:true}).click();await page.getByRole('tab',{name:'원본 · 복사'}).click();await page.evaluate(()=>window.scrollTo(0,0)); await page.screenshot({path:path.join(screenshots,'mv.png'),fullPage:false});
await page.setViewportSize({width:900,height:1000}); await page.evaluate(()=>window.scrollTo(0,0)); await page.screenshot({path:path.join(screenshots,'compact.png'),fullPage:false}); assert.equal(await page.locator('.nav-item.active').count(),1);
assert.equal(await page.locator('#screen img').count(),0);assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['paid receipt remains 접수예정','case selection','XSS escaping','unsaved notes survive stage change','note save','WBS selection','instrumental checkbox','email attachment','settings save','open-output API','MV copy view','local track add/save/delete','cookie-authenticated artifact download'],screenshots:[path.join(screenshots,'overview.png'),path.join(screenshots,'settings.png'),path.join(screenshots,'mv.png'),path.join(screenshots,'compact.png')]}));
} finally {await browser.close(); await desk.close();}
