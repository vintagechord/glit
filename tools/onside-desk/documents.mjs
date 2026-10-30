import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { DOMParser } from '@xmldom/xmldom';
import { reviewLyrics, screeningReport, hasMeaningfulLyrics, isInstrumentalTrack, currentLyrics, effectiveLyricSource, currentTranslation } from './screening.mjs';
import { OLE_SIGNATURE, readCompoundStreams } from './manual-ole.mjs';

const run = promisify(execFile);
const templateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');
const documentText = value => value.toWellFormed().normalize('NFC').replace(/\r\n?|[\u2028\u2029]/g,'\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'');
const text = v => typeof v === 'string' ? documentText(v).trim() : typeof v === 'number' ? String(v) : '';
const first = (...values) => values.map(text).find(Boolean) || '';
const settingText = (settings,key,fallback) => settings[key] === undefined ? fallback : text(settings[key]);
const html = v => text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeDocumentName(value, fallback='자료') {
  return [...(text(value).replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g,'').replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g,' ').replace(/\.{2,}/g,' ').replace(/\s+/g,' ').replace(/^[. ]+|[. ]+$/g,'') || fallback)].slice(0,85).join('');
}
// ZIP recipients may use a 255-byte filename limit even when this Mac accepts more.
function portableFilename(value) {
  if(Buffer.byteLength(value)<=240) return value;
  const candidate=path.extname(value),extension=Buffer.byteLength(candidate)<=12?candidate:'';
  const suffix=`_${createHash('sha256').update(value).digest('hex').slice(0,8)}${extension}`;
  let stem='';
  for(const character of value.slice(0,value.length-extension.length)) {
    if(Buffer.byteLength(stem+character+suffix)>240) break;
    stem+=character;
  }
  return stem+suffix;
}
function filenamePart(value,fallback,maxBytes) {
  let result='';
  for(const character of safeDocumentName(value,fallback)) {if(Buffer.byteLength(result+character)>maxBytes) break;result+=character;}
  return result.trim()||fallback;
}
const dateParts = value => {
  const m=text(value).match(/^(\d{4})[-.]\s*(\d{1,2})[-.]\s*(\d{1,2})(?:\.|T.*)?$/);
  if(!m) return null;
  const [y,mo,d]=m.slice(1).map(Number), v=new Date(Date.UTC(y,mo-1,d));
  return v.getUTCFullYear()===y && v.getUTCMonth()===mo-1 && v.getUTCDate()===d ? [y,mo,d] : null;
};
const pad = v => String(v).padStart(2,'0');
const dateFormats = value => {
  const p=dateParts(value);
  return p ? {long:`${p[0]}. ${pad(p[1])}. ${pad(p[2])}.`,short:`${String(p[0]).slice(-2)}.${pad(p[1])}.${pad(p[2])}`,md:`${pad(p[1])}/${pad(p[2])}`} : {long:text(value),short:text(value),md:text(value)};
};
const todaySeoul = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function genreCheckbox(genre) {
  const labels=['댄스','발라드','성인가요','락','일렉트로닉','R&B','O.S.T','포크','힙합','모던락','락발라드','레게'];
  const entries=[['락발라드',/락발라드|록발라드/],['모던락',/모던락|modern rock/i],['댄스',/댄스|dance/i],['발라드',/발라드|ballad/i],['성인가요',/성인가요|트로트/],['락',/록|락|rock/i],['일렉트로닉',/electronic|일렉트로닉/i],['R&B',/r&b|알앤비/i],['O.S.T',/o\.?s\.?t\.?/i],['포크',/포크|folk/i],['힙합',/힙합|hip.?hop/i],['레게',/레게|reggae/i]];
  const match=genre.split(/[,，/;]+/).map(g=>entries.find(([,r])=>r.test(g))).find(Boolean)?.[0];
  return labels.map(l=>l+(l===match?'■':'□')).join('  ')+(match?'':`  기타: ${genre}`);
}
function normalizedTracks(tracks,warnings,manual=false) {
  return [...tracks].sort((a,b)=>(Number(a.track_no)||1e6)-(Number(b.track_no)||1e6)).map((t,i)=>{
    const title=first(t.track_title,t.track_title_official,t.track_title_kr,t.track_title_en,t.title);
    const n=Number(t.track_no)||i+1;
    const selected=effectiveLyricSource(t,{manual}),original=text(selected.original),combined=text(selected.combined),translated=text(currentTranslation(t));
    // A conflicting instrumental flag must never discard provided lyrics.
    const inst=isInstrumentalTrack(t)&&!hasMeaningfulLyrics(combined||original)&&!hasMeaningfulLyrics(translated);
    let lyrics=inst?'가사 없음 / Instrumental':combined||original;
    if(!title) warnings.push(`${n}번 트랙 곡명 입력 필요`);
    if(!text(t.composer)) warnings.push(`${n}번 ${title}: 작곡자 정보 확인 필요`);
    if(!inst && !text(t.lyricist)) warnings.push(`${n}번 ${title}: 작사자 정보 확인 필요`);
    if(!lyrics) { lyrics='가사 입력 필요'; warnings.push(`${n}번 ${title}: 가사 입력 필요 (연주곡으로 추정하지 않음)`); }
    if(!inst && translated && !combined && !original.includes(translated)) {
      lyrics=`${original}\n\n[제공된 번역 — 원문 대응 확인 필요]\n${translated}`;
      warnings.push(`${n}번 ${title}: 별도로 제공된 번역을 보존했습니다. 원문과 구간 대응을 확인하세요.`);
    }
    const isTitle=t.is_title===true;
    return {...t,track_no:n,track_no_padded:pad(n),track_title:title,track_title_request:isTitle?`[T] ${title.replace(/^(?:\[T\]\s*)+/i,'')}`:title,
      track_title_with_title_mark:isTitle?title.replace(/(?:\s*\(타이틀\))+$/,'')+' (타이틀)':title,is_title:isTitle,is_instrumental:inst,
      lyricist_display:inst?'':text(t.lyricist),composer:text(t.composer),arranger:text(t.arranger),featuring:text(t.featuring),performer:first(t.performer,t.performers),
      lyrics_with_translation:lyrics,credit_line:['작사','작곡','편곡'].map((l,j)=>{const v=j===0?(inst?'':text(t.lyricist)):text(t[j===1?'composer':'arranger']);return v?`${l}: ${v}`:'';}).filter(Boolean).join('   ')};
  });
}
function makeData(submission,tracks,settings,warnings) {
  const artist=first(submission.artist_name,submission.artist_name_kr,submission.artist_name_en);
  const album=first(submission.title,submission.mv_album_title);
  const actualCompany=first(submission.production_company,submission.mv_production_company,submission.guest_company,submission.applicant_company,submission.company);
  const workDate=text(settings.applicationDate)||todaySeoul(), today=dateParts(workDate);
  if(!today) throw new Error('작업일은 유효한 YYYY-MM-DD 형식이어야 합니다.');
  const release=dateFormats(submission.release_date), production=dateFormats(first(submission.production_date,submission.mv_production_date,submission.release_date));
  if(!artist) warnings.push('아티스트명 입력 필요');
  if(!album) warnings.push('앨범명 또는 영상 제목 입력 필요');
  if(!actualCompany && submission.type==='ALBUM') warnings.push('실제 제작사 정보가 없어 앨범정보·방송사 신청서의 회사명 칸을 비웠습니다.');
  if(!text(submission.release_date)) warnings.push('발매일 정보가 없습니다. 날짜 칸을 확인하세요.');
  const titles=tracks.filter(t=>t.is_title), main=titles[0]||tracks[0];
  if(!titles.length && tracks.length && submission.type==='ALBUM') warnings.push('명시된 타이틀곡이 없어 방송사 대표곡 칸에 첫 트랙을 사용했습니다. 타이틀 표시는 추가하지 않았습니다.');
  const selection=Array.isArray(submission.wbs_track_numbers)?submission.wbs_track_numbers:[];
  let wbsTracks=selection.length?selection.map(n=>tracks.find(t=>t.track_no===Number(n))).filter(Boolean):[...titles,...tracks.filter(t=>!t.is_title)];
  if((titles.length>3&&!selection.length)||selection.length>3) {
    warnings.push('WBS 신청곡을 최대 3곡으로 지정해야 합니다. 임의로 타이틀곡을 제외하지 않고 신청곡 칸을 비웠습니다.'); wbsTracks=[];
  }
  const genre=text(submission.genre);
  return {album_title:album,artist_display:artist,artist_name:artist,artist_name_kr:text(submission.artist_name_kr),artist_name_en:text(submission.artist_name_en),genre,genre_checkbox_line:genreCheckbox(genre),
    today_year:String(today[0]),today_korean:`${today[0]}년 ${pad(today[1])}월 ${pad(today[2])}일`,today_md:`${pad(today[1])}/${pad(today[2])}`,application_date:workDate,
    release_date_full:release.long,release_date_short:release.short,release_date_md:release.md,production_date_long:production.long,production_date_short:production.short,
    production_company_for_review:settingText(settings,'companyName','빈티지코드'),company_name:actualCompany,company_actual:actualCompany,production_company_actual:actualCompany,
    distributor:first(submission.distributor,submission.mv_distribution_company),manager_name:settingText(settings,'managerName','정준영'),manager_phone:settingText(settings,'managerPhone','010-9068-9035'),manager_email:settingText(settings,'managerEmail','vintagechord@daum.net'),
    track_count:tracks.length,track_count_label:`${tracks.length}곡`,tracks:tracks.map(t=>({...t,artist_display:artist,genre:first(t.genre,genre)})),
    title_track_title:titles.map(t=>t.track_title).join(', ')||main?.track_title||'',title_track_title_primary:main?.track_title||'',title_track_title_secondary:titles.slice(1).map(t=>t.track_title).join(', '),review_songs_text:[...new Set(wbsTracks.slice(0,3).map(t=>t.track_title))].join(', '),row_no:1};
}
const templateMarkers={
  'song-review-request.docx':['{#tracks}','{/tracks}','{album_title}','{production_company_for_review}'],
  'review-form.docx':['{#tracks}','{/tracks}','{album_title}','{company_name}','{lyrics_with_translation}'],
  'lyrics-all.docx':['{#tracks}','{/tracks}','{manager_name}','{lyrics_with_translation}'],
  'lyrics-track.docx':['{manager_name}','{track_title_with_title_mark}','{lyrics_with_translation}'],
  'lyrics-mv.docx':['{artist_display}','{track_title}','{lyrics_with_translation}'],
  'pbc-integrated.docx':['{#albums}','{/albums}','{company_actual}','{release_date_md}','{title_track_title}'],
  'tbs-integrated.docx':['{#albums}','{/albums}','{album_title}','{title_track_title_primary}','{title_track_title_secondary}'],
  'wbs-integrated.docx':['{#albums}','{/albums}','{company_actual}','{review_songs_text}'],
};
function sanitizeTemplateData(value) {
  if(typeof value==='string') return documentText(value);
  if(Array.isArray(value)) return value.map(sanitizeTemplateData);
  if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sanitizeTemplateData(item)]));
  return value;
}
function validateDocumentPackage(zip,name) {
  for(const part of ['[Content_Types].xml','_rels/.rels','word/document.xml','word/styles.xml']) {
    if(!zip.file(part)) throw new Error(`${name}: 문서 구성 파일이 없습니다 (${part}).`);
  }
  for(const file of Object.values(zip.files).filter(file=>!file.dir&&/\.(?:xml|rels)$/.test(file.name))) {
    try {
      const source=new TextDecoder('utf-8',{fatal:true}).decode(file.asUint8Array());
      const parsed=new DOMParser({onError:(level,message)=>{
        // U+FFFD is valid XML, including the explicit repair of a lone surrogate.
        if(level==='warning'&&message.startsWith('Unicode replacement character detected')) return;
        throw new Error('Invalid XML');
      }}).parseFromString(source,'application/xml');
      if(!parsed.documentElement) throw new Error('Missing XML root');
    } catch {throw new Error(`${name}: 문서 XML 구성 검사에 실패했습니다 (${file.name}).`);}
  }
}
/** Validate the actual template and generated body before writing any DOCX. */
export function renderDocumentTemplate({template,templateName:name,data}) {
  const zip=new PizZip(template,{checkCRC32:true});
  validateDocumentPackage(zip,name);
  const doc=new Docxtemplater(zip,{paragraphLoop:true,linebreaks:true,nullGetter:()=>''});
  const sourceText=doc.getFullText();
  const missing=(templateMarkers[name]||[]).filter(marker=>!sourceText.includes(marker));
  if(missing.length) throw new Error(`${name}: 기준 양식의 필수 입력 위치가 없습니다 (${missing.join(', ')}).`);
  const payload=sanitizeTemplateData(data);
  doc.render(payload);
  const xml=doc.getZip().file('word/document.xml')?.asText()||'';
  if(!xml||/<w:tblpPr\b|<w:trHeight\b[^>]*w:hRule="exact"/.test(xml)) throw new Error(`${name}: 문서 구조 검사 실패`);
  if(name==='song-review-request.docx' && /<w:tblHeader\b/.test(xml)) throw new Error('요청서의 상단 정보 반복 설정이 남아 있습니다.');
  validateDocumentPackage(doc.getZip(),name);
  const comparable=value=>documentText(String(value)).replace(/\s+/g,'');
  const rendered=comparable(doc.getFullText());
  if(name.startsWith('lyrics-')||name==='review-form.docx') {
    const records=name==='lyrics-track.docx'||name==='lyrics-mv.docx'?[payload]:payload.tracks||[];
    for(const record of records) for(const value of [name==='lyrics-mv.docx'?record.track_title:record.track_title_with_title_mark||record.track_title,record.lyrics_with_translation]) {
      if(value&&!rendered.includes(comparable(value))) throw new Error(`${name}: 곡명 또는 가사 본문이 완전히 출력되지 않았습니다.`);
    }
  }
  return doc.getZip().generate({type:'nodebuffer',compression:'DEFLATE'});
}
async function renderTemplate(name,data) {
  const input=await fs.readFile(path.join(templateDir,name));
  return {buffer:renderDocumentTemplate({template:input,templateName:name,data}),templateHash:createHash('sha256').update(input).digest('hex')};
}
async function legacyWordDocument(docx,expectedValues) {
  if(process.platform!=='darwin') throw new Error('뮤비 가사 DOC 생성에는 이 Mac의 문서 변환기가 필요합니다.');
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'onside-mv-doc-'));
  try {
    const input=path.join(temporary,'lyrics.docx'),output=path.join(temporary,'lyrics.doc');
    await fs.writeFile(input,docx,{mode:0o600});
    await run('/usr/bin/textutil',['-convert','doc','-output',output,input],{timeout:30000,maxBuffer:100000});
    const buffer=await fs.readFile(output);
    if(!buffer.subarray(0,8).equals(OLE_SIGNATURE)) throw new Error('Word DOC 형식 검증에 실패했습니다.');
    const word=readCompoundStreams(buffer).get('WordDocument')?.();
    if(!word||word.length<32||word.readUInt16LE(0)!==0xa5ec) throw new Error('Word DOC 본문 검증에 실패했습니다.');
    const {stdout}=await run('/usr/bin/textutil',['-convert','txt','-stdout',output],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
    const comparable=value=>documentText(value).replace(/\s+/g,'');
    const roundTrip=comparable(stdout);
    if(expectedValues.some(value=>value&&!roundTrip.includes(comparable(value)))) throw new Error('Word DOC 변환 과정에서 곡명 또는 가사가 누락되었습니다.');
    return buffer;
  } catch { throw new Error('뮤비 가사를 Word DOC로 변환하지 못했습니다. Mac 문서 변환기와 저장 공간을 확인한 뒤 다시 생성하세요.'); }
  finally {await fs.rm(temporary,{recursive:true,force:true});}
}
function copyFields(submission,data,stations,stationReviews,files) {
  const stationNames=stationReviews.map(r=>stations.find(s=>s.id===r.station_id)?.name||r.station_name||r.station_code).filter(Boolean);
  const selected=Array.isArray(submission.mv_selected_station_codes)?submission.mv_selected_station_codes:[];
  const type=submission.type==='MV_DISTRIBUTION'?'온라인 뮤직비디오 (영등위)':submission.type==='MV_BROADCAST'?'방송용 뮤직비디오':'음반';
  return [
    ['심의 구분',type],['접수번호',first(submission.receipt_number,submission.receipt_no,submission.id)],['작성일',data.application_date],
    ['제목',first(submission.mv_song_title_official,submission.mv_song_title,submission.mv_song_title_kr,submission.title)],['가수',data.artist_display],['앨범명',first(submission.mv_album_title,submission.title)],
    ['상영시간',submission.mv_runtime],['영상 형식',submission.mv_format],['감독',submission.mv_director],['주연 및 출연',submission.mv_lead_actor],['내용 및 줄거리',submission.mv_storyline],
    ['제작사',submission.mv_production_company],['기획사',submission.mv_agency],['제작일',submission.mv_production_date],['공개 및 발매일',submission.release_date],['배급사',submission.mv_distribution_company],['사업자등록번호',submission.mv_business_reg_no],
    ['사용 목적',submission.mv_usage],['신청 희망등급',submission.mv_desired_rating],['작곡',submission.mv_composer],['작사',submission.mv_lyricist],['편곡',submission.mv_arranger],
    ['영상 특이사항',submission.mv_memo],['음악 특이사항',submission.mv_song_memo],['신청 방송국',[...new Set([...stationNames,...selected])].join(', ')],
    ['신청자',first(submission.applicant_name,submission.guest_name)],['신청자 이메일',first(submission.applicant_email,submission.guest_email)],['신청자 연락처',first(submission.applicant_phone,submission.guest_phone)],
    ['업무 담당자',data.manager_name],['업무 연락처',data.manager_phone],['업무 이메일',data.manager_email],
    ['자료 전달 상태',mediaDeliveryDescription(submission,files)],['가사 원문',currentLyrics(submission,'mv_lyrics')],['제공된 한글 번역',submission.korean_lyrics_translation]
  ].map(([label,value])=>({label,value:text(value)}));
}
export function mediaDeliveryDescription(submission,files=[]) {
  const delivery=first(submission.material_delivery_method,submission.delivery_method,submission.file_delivery_method,submission.materials_delivery_method,submission.file_delivery,submission.mv_delivery_method).toUpperCase();
  const email=/EMAIL|E-MAIL|이메일/.test(delivery)||submission.send_files_by_email===true||submission.email_submission===true||submission.files_submitted_by_email===true;
  if(submission.source==='manual') {
    const channel=email?'이메일':/SMS|TEXT|문자/.test(delivery)?'문자':'별도 전달';
    return `${channel} 접수 · 관리자 수동 작업 — ${files.length?`이 맥에 등록한 첨부 ${files.length}개 / 실제 음원·영상 수신 여부와 파일 종류를 확인하세요.`:'이 맥에 등록한 첨부 없음 / 실제 음원·영상 수신 여부를 확인하세요.'}`;
  }
  if(email) return `이메일 전달 선택 — 실제 이메일 수신 및 첨부 확인 필요${files.length?` / 서비스 업로드 ${files.length}개 있음`:''}`;
  return files.length?`서비스에 등록된 업로드 자료 ${files.length}개 — 다운로드 결과는 파일 수신 목록에서 확인`:'서비스 업로드 자료 없음 — 이메일 전달 여부와 실제 수신을 확인하세요.';
}
/** Optional isolated LibreOffice pagination. No customer data leaves this Mac. */
async function countPages(file,qaDir,settings) {
  if(settings.pagination===false) return null;
  const docker=settings.dockerPath||'/usr/local/bin/docker';
  try {
    await fs.mkdir(qaDir,{recursive:true,mode:0o700});
    await run(docker,['run','--rm','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','-v',`${path.dirname(file)}:/input:ro`,'-v',`${qaDir}:/out`,'onside-doc-qa:local','soffice','-env:UserInstallation=file:///tmp/onside-profile','--headless','--convert-to','pdf','--outdir','/out',`/input/${path.basename(file)}`],{timeout:90000,maxBuffer:100000});
    const pdf=path.basename(file).replace(/\.docx$/i,'.pdf');
    const {stdout}=await run(docker,['run','--rm','--network','none','--cap-drop','ALL','-v',`${qaDir}:/out:ro`,'onside-doc-qa:local','pdfinfo',`/out/${pdf}`],{timeout:20000,maxBuffer:100000});
    return Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1])||null;
  } catch { return null; }
}
export async function generateDocuments({submission,source,tracks=[],stations=[],stationReviews=[],files=[],outputDir,settings={}}) {
  if(!submission || !['ALBUM','MV_DISTRIBUTION','MV_BROADCAST'].includes(submission.type)) throw new Error('지원하지 않는 심의 유형입니다.');
  submission={...submission,source:source||submission.source||'online'};
  if(!outputDir || !path.isAbsolute(outputDir)) throw new Error('자료 저장 위치는 절대 경로여야 합니다.');
  outputDir=path.resolve(outputDir);
  await fs.mkdir(outputDir,{recursive:true,mode:0o700});
  const screening=reviewLyrics({submission,tracks});
  const warnings=[],artifacts=[],templateHashes={};
  if(screening.requiresReview) warnings.push(submission.type==='ALBUM'?`가사 자동 확인 ${screening.findings.length}건: 가사_확인사항.txt에서 트랙·행·원문을 확인하세요. 원문을 검열하거나 임의 번역하지 않았습니다.`:`가사 자동 확인 ${screening.findings.length}건: 자료 생성 전 확인사항에서 행·원문을 확인하세요. 원문을 검열하거나 임의 번역하지 않았습니다.`);
  const manual=submission.source==='manual';
  const list=normalizedTracks(submission.type==='ALBUM'?tracks:[],warnings,manual),data=makeData(submission,list,settings,warnings),label=safeDocumentName(`${data.artist_display||'가수 미입력'} - ${data.album_title||'제목 미입력'}`);
  const written=new Set();
  async function write(name,buffer,type) {
    name=name.split('/').map(portableFilename).join('/');
    let rel=name,counter=2;
    while(written.has(rel.normalize('NFC').toLowerCase())) {const ext=path.extname(name);rel=name.slice(0,-ext.length)+`_${counter++}`+ext;}
    written.add(rel.normalize('NFC').toLowerCase());
    const dest=path.join(outputDir,rel);
    if(!dest.startsWith(outputDir+path.sep)) throw new Error('잘못된 파일 경로입니다.');
    await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
    // Generation directories are versioned by the application; refuse an accidental overwrite.
    await fs.writeFile(dest,buffer,{mode:0o600,flag:'wx'});
    artifacts.push({name:rel,path:dest,type,bytes:Buffer.byteLength(buffer)});return dest;
  }
  async function doc(name,template,payload) {const {buffer,templateHash}=await renderTemplate(template,payload);templateHashes[template]=templateHash;return write(name,buffer,'docx');}
  let lyricPagination={baselinePages:null,finalPages:null,version:'원문 줄 구성'};
  if(submission.type==='ALBUM') {
    if(!list.length) warnings.push('신청 트랙이 없습니다. 트랙 정보를 보완한 뒤 다시 생성하세요.');
    await doc(`${label}/가요심의요청서_${label}.docx`,'song-review-request.docx',data);
    await doc(`${label}/심의폼_${label}.docx`,'review-form.docx',{...data,company_name:data.production_company_for_review});
    await doc(`${label}/앨범정보_${label}.docx`,'review-form.docx',data);
    const allFile=await doc(`${label}/가사전체파일_${label}.docx`,'lyrics-all.docx',data);
    const pages=await countPages(allFile,path.join(outputDir,'.검수','기본본'),settings);
    lyricPagination.baselinePages=pages;lyricPagination.finalPages=pages;
    if(pages>3) {
      const compact={...data,tracks:data.tracks.map(t=>({...t,lyrics_with_translation:t.lyrics_with_translation.split(/\n\s*\n/).map(p=>p.split('\n').map(s=>s.trim()).filter(Boolean).join(' ')).join('\n\n')}))};
      const {buffer}=await renderTemplate('lyrics-all.docx',compact); await fs.writeFile(allFile,buffer,{mode:0o600});
      const artifact=artifacts.find(a=>a.path===allFile);artifact.bytes=buffer.length;
      lyricPagination.version='인쇄용 용지 절약';lyricPagination.finalPages=await countPages(allFile,path.join(outputDir,'.검수','인쇄본'),settings);
      if(!lyricPagination.finalPages) warnings.push('인쇄용 가사전체파일의 최종 페이지 수를 확인하지 못했습니다.');
    } else if(!pages) warnings.push('가사전체파일의 실제 페이지 수를 확인하지 못해 원문 줄 구성을 유지했습니다. 인쇄 전 검수가 필요합니다.');
    for(const t of data.tracks) await doc(`${label}/${t.track_no_padded}_${safeDocumentName(t.track_title,'곡명 미입력')}.docx`,'lyrics-track.docx',{...data,...t});
    for(const station of ['PBC','TBS','WBS']) await doc(`통합신청서/${station}신청서_통합.docx`,`${station.toLowerCase()}-integrated.docx`,{...data,albums:[data],album_count:1,submission_count:1});
    warnings.push('첨부 파일명 기준을 유지했습니다: PBC는 「심의 음반 접수 목록」, TBS는 「음원심의신청서」입니다. 방송사 제출처와 양식의 일치를 확인하세요.');
  } else {
    const mvWarnings=[];
    const mv=normalizedTracks([{track_no:1,track_title:first(submission.mv_song_title_official,submission.mv_song_title,submission.mv_song_title_kr,submission.title),lyrics:currentLyrics(submission,'mv_lyrics'),lyrics_with_translation:submission.lyrics_with_translation,translated_lyrics:submission.korean_lyrics_translation,composer:submission.mv_composer,lyricist:submission.mv_lyricist,arranger:submission.mv_arranger,is_instrumental:submission.is_instrumental,instrumental_confirmed:submission.instrumental_confirmed}],mvWarnings,manual)[0];
    warnings.push(...mvWarnings.map(w=>w.replace(/^1번(?: 트랙)?\s*/,'')));
    const {buffer,templateHash}=await renderTemplate('lyrics-mv.docx',{...data,...mv});templateHashes['lyrics-mv.docx']=templateHash;
    const lyricName=`가사_${filenamePart(data.artist_display,'가수 미입력',100)}_${filenamePart(mv.track_title,'제목 미입력',100)}.doc`;
    await write(lyricName,await legacyWordDocument(buffer,[data.artist_display,mv.track_title,mv.lyrics_with_translation]),'doc');
    const fields=copyFields(submission,data,stations,stationReviews,files),name=submission.type==='MV_DISTRIBUTION'?'영등위_복사붙여넣기':'방송용_복사붙여넣기';
    await write(`${name}_${filenamePart(label,'자료',180)}.html`,`<!doctype html><html lang="ko"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${html(name)}</title><style>body{font:16px -apple-system,sans-serif;max-width:850px;margin:40px auto;color:#202620}h1{font-size:25px}section{margin:24px 0}label{display:block;font-weight:700;margin-bottom:8px}textarea{width:100%;box-sizing:border-box;padding:12px;font:inherit;border:1px solid #a8b5a9;border-radius:6px;line-height:1.6}p{color:#57625a}</style><h1>${html(name.replaceAll('_',' '))}</h1><p>각 칸을 클릭하고 전체 선택하여 복사하세요. 빈칸은 신청 자료에서 확인되지 않은 항목입니다. 심의기관의 실제 신청 화면에 맞춰 입력하세요.</p>${fields.map(f=>`<section><label>${html(f.label)}</label><textarea readonly rows="${Math.min(15,Math.max(2,f.value.split('\n').length+1))}">${html(f.value)}</textarea></section>`).join('')}</html>`,'html');
    return {artifacts,warnings,screening,summary:{type:submission.type,source:submission.source,caseCount:1,trackCount:0,docCount:1,docxCount:0,applicationDate:data.application_date,templateHashes,screeningCounts:screening.counts,requiresReview:warnings.length>0,visuallyVerified:false}};
  }
  await write('가사_확인사항.txt',screeningReport(screening),'text');
  const docs=artifacts.filter(a=>a.type==='docx');
  const zip=new PizZip();for(const a of docs) zip.file(a.name,await fs.readFile(a.path));
  await write(`심의서류_${label}.zip`,zip.generate({type:'nodebuffer',compression:'DEFLATE'}),'zip');
  if(submission.type==='ALBUM') {
    const albumZip=new PizZip();
    for(const a of docs.filter(a=>!a.name.startsWith('통합신청서/'))) albumZip.file(a.name,await fs.readFile(a.path));
    await write(`앨범별서류_${label}.zip`,albumZip.generate({type:'nodebuffer',compression:'DEFLATE'}),'zip');
  }
  const statusLines=[`심의자료 생성일: ${data.application_date}`,`유형: ${submission.type}`,`접수번호: ${text(submission.id)}`,`DOCX: ${docs.length}개`,`자료 전달: ${mediaDeliveryDescription(submission,files)}`,`가사전체파일: ${lyricPagination.version} / 기본 ${lyricPagination.baselinePages??'미검증'}쪽 / 최종 ${lyricPagination.finalPages??'미검증'}쪽`,'','확인사항',...warnings.map(w=>`- ${w}`),'','HWP 원본 양식을 참고해 편집 가능한 DOCX로 생성했습니다. ZIP에는 DOCX만 포함됩니다.','실제 신청별 문서는 인쇄 미리보기로 확인한 후 제출하세요. 생성은 제출이나 서비스 상태 변경을 수행하지 않습니다.'];
  await write('자료생성_확인사항.txt',statusLines.join('\n'),'text');
  return {artifacts,warnings,screening,summary:{type:submission.type,source:submission.source||'online',trackCount:submission.type==='ALBUM'?list.length:1,docxCount:docs.length,applicationDate:data.application_date,templateHashes,lyricPagination,screeningCounts:screening.counts,requiresReview:warnings.length>0,visuallyVerified:false}};
}
