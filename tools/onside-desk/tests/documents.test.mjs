import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import PizZip from 'pizzip';
import {readCompoundStreams,OLE_SIGNATURE} from '../manual-ole.mjs';
import { generateDocuments,safeDocumentName,mediaDeliveryDescription } from '../documents.mjs';
const output=()=>fs.mkdtemp(path.join(os.tmpdir(),'onside-doc-test-'));
const base={id:'fixture-only',type:'ALBUM',title:'별 & 달',artist_name:'가수 <이름>',release_date:'2026-10-25',genre:'발라드',production_company:'실제 회사',distributor:'유통사'};
const tracks=[{track_no:1,track_title:'밤 / 낮',is_title:true,lyrics:'첫 줄\n두 번째 & <세 번째>\n\n반복\n반복',composer:'작곡가',lyricist:'작사가',arranger:'편곡가'},{track_no:2,track_title:'밤 / 낮 (Inst.)',composer:'작곡가'},{track_no:3,track_title:'Mr. Sunshine',lyrics:''}];
const xml=async p=>new PizZip(await fs.readFile(p),{checkCRC32:true}).file('word/document.xml').asText();
const docText=async p=>(await promisify(execFile)('/usr/bin/textutil',['-convert','txt','-stdout',p],{encoding:'utf8',maxBuffer:2000000})).stdout.replaceAll('\u2028','\n');
test('album packet preserves original lyrics, title roles, source broadcaster mapping, and DOCX-only archive',async()=>{
 const dir=await output();try {
 const result=await generateDocuments({submission:base,tracks,outputDir:dir,settings:{pagination:false,applicationDate:'2026-10-25'}});
 assert.equal(result.summary.docxCount,10);assert.equal(result.summary.trackCount,3);
 const request=await xml(result.artifacts.find(a=>a.name.includes('가요심의요청서')).path);
 assert.match(request,/\[T\] 밤 \/ 낮/);assert.doesNotMatch(request,/tblHeader/);assert.match(request,/가수 &lt;이름&gt;/);
 const inst=await xml(result.artifacts.find(a=>a.name.includes('/02_')).path);assert.match(inst,/가사 없음 \/ Instrumental/);assert.doesNotMatch(inst,/\(타이틀\)/);
 const missing=await xml(result.artifacts.find(a=>a.name.includes('/03_')).path);assert.match(missing,/가사 입력 필요/);assert.doesNotMatch(missing,/가사 없음 \/ Instrumental/);
 const form=await xml(result.artifacts.find(a=>a.name.includes('/심의폼_')).path),info=await xml(result.artifacts.find(a=>a.name.includes('/앨범정보_')).path);
 assert.equal(form.replaceAll('빈티지코드','실제 회사'),info);
 const pbc=await xml(result.artifacts.find(a=>a.name.includes('PBC신청서')).path),tbs=await xml(result.artifacts.find(a=>a.name.includes('TBS신청서')).path);
 assert.match(pbc,/심의 음반 접수 목록/);assert.match(tbs,/음원심의신청서/);
 const zip=new PizZip(await fs.readFile(result.artifacts.find(a=>a.type==='zip').path),{checkCRC32:true});
 assert.equal(Object.values(zip.files).filter(f=>!f.dir).length,10);assert.ok(Object.values(zip.files).every(f=>f.dir||f.name.endsWith('.docx')));
 const lyrics=await xml(result.artifacts.find(a=>a.name.includes('/01_')).path);assert.match(lyrics,/첫 줄/);assert.match(lyrics,/&amp; &lt;세 번째&gt;/);
 const plain=lyrics.replace(/<[^>]+>/g,'').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>').replace(/\s+/g,'');
 assert.ok(plain.includes(tracks[0].lyrics.replace(/\s+/g,'')));
 const all=await xml(result.artifacts.find(a=>a.name.includes('가사전체파일_')).path);
 assert.equal((all.match(/반복/g)||[]).length,2);
 const albumZip=new PizZip(await fs.readFile(result.artifacts.find(a=>a.name.startsWith('앨범별서류_')).path),{checkCRC32:true});
 assert.equal(Object.values(albumZip.files).filter(f=>!f.dir).length,7);
 assert.ok(Object.keys(albumZip.files).every(n=>!n.startsWith('통합신청서/')));
 assert.ok(result.warnings.some(w=>w.includes('Mr. Sunshine')));
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('MV types produce exactly one genuine legacy DOC and one safe copy-paste HTML', {skip:process.platform!=='darwin'},async()=>{
 for(const type of ['MV_DISTRIBUTION','MV_BROADCAST']) {
  const dir=await output();try {
   const result=await generateDocuments({submission:{...base,type,mv_song_title:'영상 제목',mv_lyrics:'하나\n둘',mv_storyline:'</textarea><script>alert(1)</script>',delivery_method:'EMAIL'},outputDir:dir,settings:{pagination:false}});
   assert.equal(result.summary.docxCount,0);assert.equal(result.summary.docCount,1);assert.equal(result.summary.trackCount,0);assert.equal(result.artifacts.length,2);
   assert.equal((await fs.readdir(dir)).length,2);
   const lyrics=result.artifacts.find(a=>a.type==='doc');assert.equal(lyrics.name,'가사_가수 이름_영상 제목.doc');
   const bytes=await fs.readFile(lyrics.path);assert.ok(bytes.subarray(0,8).equals(OLE_SIGNATURE));assert.ok(readCompoundStreams(bytes).has('WordDocument'));
   const content=await docText(lyrics.path);assert.match(content,/가수 <이름>/);assert.match(content,/영상 제목/);assert.match(content,/하나\n둘/);
   const page=await fs.readFile(result.artifacts.find(a=>a.type==='html').path,'utf8');assert.ok(page.includes('&lt;/textarea&gt;&lt;script&gt;'));assert.doesNotMatch(page,/<script>/);
   assert.match(page,/이메일 전달 선택/);assert.match(page,/실제 이메일 수신/);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
 }
});
test('filenames and empty delivery state never claim receipt',()=>{
 assert.equal(safeDocumentName('../a/b:*?'), 'a b');
 assert.match(mediaDeliveryDescription({},[]),/확인/);
 assert.match(mediaDeliveryDescription({files_submitted_by_email:true},[]),/이메일 전달 선택/);
});
test('MV filenames fit filesystem byte limits without shortening document content',{skip:process.platform!=='darwin'},async()=>{
 const dir=await output();try {
  const artist='가나다라마바사'.repeat(15),title='영상제목'.repeat(25);
  const result=await generateDocuments({submission:{...base,type:'MV_DISTRIBUTION',artist_name:artist,title,mv_song_title:title,mv_lyrics:'원문 유지'},outputDir:dir,settings:{pagination:false}});
  assert.equal(result.artifacts.length,2);for(const artifact of result.artifacts)assert.ok(Buffer.byteLength(artifact.name)<=255);
  const content=await docText(result.artifacts.find(a=>a.type==='doc').path);assert.ok(content.includes(artist));assert.ok(content.includes(title));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('explicitly cleared contact settings remain blank instead of restoring defaults',async()=>{
 const dir=await output();try {
  const result=await generateDocuments({submission:base,tracks:tracks.slice(0,1),outputDir:dir,settings:{pagination:false,managerName:'',managerPhone:'',managerEmail:'',companyName:''}});
  const form=await xml(result.artifacts.find(a=>a.name.includes('/심의폼_')).path);
  assert.doesNotMatch(form,/정준영|010-9068-9035|vintagechord@daum.net|빈티지코드/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('manual packets preserve flagged lyrics, report source lines and keep reports out of DOCX-only ZIP',async()=>{
 const dir=await output();try {
  const original='가사를 보존합니다\n씨 발 그대로\nHello world';
  const result=await generateDocuments({source:'manual',submission:{...base,delivery_method:'EMAIL'},tracks:[{track_no:1,track_title:'확인곡',is_instrumental:true,lyrics:original,lyricist:'작사가',composer:'작곡가'}],files:[{name:'기준.docx'}],outputDir:dir,settings:{pagination:false}});
  assert.equal(result.screening.counts.profanity,1);assert.equal(result.screening.counts.instrumental_conflict,1);
  const lyrics=await xml(result.artifacts.find(a=>a.name.includes('/01_')).path);
  assert.match(lyrics,/씨 발 그대로/);assert.match(lyrics,/Hello world/);assert.doesNotMatch(lyrics,/가사 없음 \/ Instrumental/);
  const report=await fs.readFile(result.artifacts.find(a=>a.name==='가사_확인사항.txt').path,'utf8');assert.match(report,/2행/);assert.match(report,/씨 발 그대로/);assert.match(report,/번역 필요/);
  const summary=await fs.readFile(result.artifacts.find(a=>a.name==='자료생성_확인사항.txt').path,'utf8');assert.match(summary,/관리자 수동 작업/);assert.doesNotMatch(summary,/서비스에 등록된|서비스 업로드/);
  const zip=new PizZip(await fs.readFile(result.artifacts.find(a=>a.type==='zip').path));assert.ok(Object.values(zip.files).every(f=>f.dir||f.name.endsWith('.docx')));
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('manual documents honor intentionally cleared lyrics instead of restoring reference lyrics',async()=>{
 for(const type of ['ALBUM','MV_DISTRIBUTION']) {
  if(type!=='ALBUM'&&process.platform!=='darwin') continue;
  const dir=await output();try {
   const result=await generateDocuments({source:'manual',submission:{...base,type,mv_lyrics:'',original_lyrics:'보관된 원문',lyrics_with_translation:'보관된 통합본'},tracks:[{track_no:1,track_title:'연주곡',lyrics:'',original_lyrics:'보관된 원문',lyrics_with_translation:'보관된 통합본',is_instrumental:true}],outputDir:dir,settings:{pagination:false}});
   const lyricDoc=result.artifacts.find(a=>a.type==='doc'||a.type==='docx'&&a.name.includes('/01_'));
   const content=lyricDoc.type==='doc'?await docText(lyricDoc.path):await xml(lyricDoc.path);assert.doesNotMatch(content,/보관된 원문|보관된 통합본/);
   if(type==='ALBUM') assert.match(content,/가사 없음 \/ Instrumental/);else assert.match(content,/가사 입력 필요/);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
 }
});
