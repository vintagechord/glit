import { untranslatedLyricSpans, isInstrumentalTrack, hasMeaningfulLyrics, effectiveLyricSource, currentTranslation } from './screening.mjs';
import { isUsableLyricsTranslation } from './screening-engine.mjs';

const text=v=>typeof v==='string'?v:'';
const first=(...v)=>v.map(text).find(v=>v.trim())||'';
const MAX_RESPONSE=2*1024*1024;
async function responseJSON(response) {
  if(Number(response.headers?.get('content-length'))>MAX_RESPONSE) throw new Error('번역 응답이 너무 큽니다. 저장된 가사는 변경하지 않았습니다.');
  const reader=response.body?.getReader();
  if(!reader) throw new Error('번역 응답을 읽을 수 없습니다. 저장된 가사는 변경하지 않았습니다.');
  const chunks=[];let bytes=0;
  while(true) {const {done,value}=await reader.read();if(done) break;bytes+=value.byteLength;if(bytes>MAX_RESPONSE) {await reader.cancel();throw new Error('번역 응답이 너무 큽니다. 저장된 가사는 변경하지 않았습니다.');}chunks.push(value);}
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new Error('번역 응답 형식이 올바르지 않습니다. 저장된 가사는 변경하지 않았습니다.');}
}

const HANGUL=/[가-힣]/;
/** Consecutive lines that still need a translation, so one "(번역: …)" line can
 * follow each run. A foreign-only line is translated whole; in a line mixing
 * Korean and foreign words only the foreign parts are, then put back in place. */
function untranslatedBlocks(source) {
  const lines=[];
  for(const span of untranslatedLyricSpans(source)) {
    const start=source.lastIndexOf('\n',span.start-1)+1;
    if(lines.at(-1)?.start===start) {lines.at(-1).spans.push(span);continue;}
    let end=source.indexOf('\n',span.start);if(end<0) end=source.length;
    lines.push({start,end,text:source.slice(start,end).replace(/\r$/,'').trim(),spans:[span]});
  }
  for(const line of lines) {
    line.mixed=HANGUL.test(line.text);
    line.units=line.mixed?line.spans.map(span=>span.source.trim()).filter(Boolean):[line.text];
  }
  const blocks=[];
  for(const line of lines) {
    const last=blocks.at(-1);
    if(last&&line.start===last.at(-1).end+1) last.push(line); else blocks.push([line]);
  }
  return blocks.filter(block=>block.some(line=>line.text));
}

function lyricTargets(detail,{manual}) {
  const album=detail.submission.type==='ALBUM';
  return album?(detail.tracks||[]):[{
    id:'mv',lyrics:effectiveLyricSource(detail.submission,{manual,field:'mv_lyrics'}).source,
    lyrics_with_translation:detail.submission.lyrics_with_translation,translated_lyrics:currentTranslation(detail.submission,'korean_lyrics_translation'),
    track_title:first(detail.submission.mv_song_title,detail.submission.title),is_instrumental:detail.submission.is_instrumental,
  }];
}
function planTranslations(detail,{manual}) {
  const warnings=[],plans=[];
  for(const [index,track] of lyricTargets(detail,{manual}).entries()) {
    const source=effectiveLyricSource(track,{manual}).source;
    const separate=currentTranslation(track);
    if(separate.trim()&&!source.includes(separate)) {warnings.push(`${index+1}번 ${text(track.track_title)}: 별도 번역이 있어 자동 보완을 건너뛰었습니다. 원문 대응을 확인하세요.`);continue;}
    if(isInstrumentalTrack(track)&&!hasMeaningfulLyrics(source)) continue;
    if(source.length>100000) throw new Error('가사가 자동 번역 확인 한도를 넘었습니다. 트랙을 나누거나 직접 번역을 입력하세요. 저장된 가사는 변경하지 않았습니다.');
    const blocks=untranslatedBlocks(source);
    if(!blocks.length) continue;
    if(blocks.some(block=>block.some(line=>line.text.length>5000))) throw new Error('한 외국어 구간이 너무 깁니다. 원문에 줄바꿈을 보완한 뒤 다시 실행하세요. 저장된 가사는 변경하지 않았습니다.');
    plans.push({index,track,source,blocks,translations:new Map()});
  }
  return {plans,warnings};
}

/** Whether any lyrics still have foreign lines without a Korean translation. No network. */
export function needsLyricsTranslation(detail) {
  if(!detail?.submission) return false;
  const manual=detail.source==='manual'||detail.submission.source==='manual';
  try {return planTranslations(detail,{manual}).plans.length>0;} catch {return true;}
}

const ENDS_SENTENCE=/[.!?。…~♪"'」』]$/;
/** Translates foreign lyric lines that lack a Korean translation and writes
 * "(번역: …)" on its own line under each run of such lines. Online cases are
 * included only when the caller asks (document generation). The caller
 * persists the returned overrides, which hold only the changed lyric fields. */
export async function translateMissingLyrics({detail,serviceUrl,fetchImpl=fetch,signal,allowOnline=false}={}) {
  const manual=detail?.source==='manual'||detail?.submission?.source==='manual';
  if(!detail?.submission||(!manual&&!allowOnline)) throw new Error('관리자 수동 작업에서만 번역을 보완할 수 있습니다.');
  const base=new URL(serviceUrl);
  if(base.protocol!=='https:'||base.username||base.password) throw new Error('번역 서비스에는 HTTPS 온사이드 주소를 사용하세요.');
  const endpoint=new URL('/api/translate',base);
  const album=detail.submission.type==='ALBUM';
  const {plans,warnings}=planTranslations(detail,{manual});
  const segmentCount=plans.reduce((n,p)=>n+p.blocks.reduce((m,b)=>m+b.length,0),0),characters=plans.reduce((n,p)=>n+p.blocks.reduce((m,b)=>m+b.reduce((k,l)=>k+l.units.join('').length,0),0),0);
  if(segmentCount>2400||characters>60000) throw new Error('한 번에 번역할 수 있는 가사 분량을 넘었습니다. 일부 트랙을 먼저 보완하세요. 저장된 가사는 변경하지 않았습니다.');
  const batches=[];
  for(const plan of plans) {
    const unique=[...new Set(plan.blocks.flat().flatMap(line=>line.units))];
    for(let i=0;i<unique.length;i+=120) batches.push({plan,lines:unique.slice(i,i+120)});
  }
  if(batches.length>20) throw new Error('한 번에 번역할 수 있는 트랙 수를 넘었습니다. 일부 트랙을 먼저 보완하세요. 저장된 가사는 변경하지 않았습니다.');
  for(const {plan,lines} of batches) {
    const context=plan.source.slice(0,12000).replace(/[\uD800-\uDBFF]$/,'');
    const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(55000)]):AbortSignal.timeout(55000);
    let response;
    try {response=await fetchImpl(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lines,source:'auto',target:'ko',context}),signal:requestSignal,redirect:'error',credentials:'omit'});}
    catch {throw new Error('번역 서비스에 연결하지 못했거나 요청이 취소되었습니다. 저장된 가사는 변경하지 않았습니다.');}
    if(response.status===429) throw new Error('번역 요청이 일시적으로 많습니다. 잠시 후 다시 시도하세요. 저장된 가사는 변경하지 않았습니다.');
    // The service reports segments it could not translate (502) next to the ones it did.
    const result=response.ok||response.status===502?await responseJSON(response).catch(()=>null):null;
    if(!result) throw new Error('번역 서비스가 모든 구간을 번역하지 못했습니다. 저장된 가사는 변경하지 않았습니다.');
    if(!Array.isArray(result.translations)||result.translations.length!==lines.length) throw new Error('번역 응답의 구간 수가 일치하지 않습니다. 저장된 가사는 변경하지 않았습니다.');
    for(const [index,line] of lines.entries()) {
      const translated=result.translations[index];
      // Unusable or censored output is never applied; that segment stays for manual review.
      if(typeof translated!=='string'||!translated.trim()||!isUsableLyricsTranslation(translated,line,'ko')) continue;
      // One annotation line per run: no line breaks, and no brackets that would close it early.
      plan.translations.set(line,translated.trim().replace(/\s*\r?\n\s*/g,' ').replace(/[()（）]/g,' ').replace(/\s{2,}/g,' ').trim());
    }
  }
  if(plans.length&&plans.every(plan=>!plan.translations.size)) throw new Error('번역 서비스가 번역을 돌려주지 않았거나 내용·욕설 보존을 확인하지 못했습니다. 저장된 가사는 변경하지 않았습니다.');
  if(signal?.aborted) throw new Error('번역 요청이 취소되었습니다. 저장된 가사는 변경하지 않았습니다.');
  const changed=[],failed=new Set();
  // A foreign-only line becomes its translation; a mixed line keeps its Korean
  // words with each translated foreign part put back where it was.
  const rendition=(plan,line)=>{
    if(!line.mixed) {const value=plan.translations.get(line.text);if(!value) failed.add(line.text);return value||null;}
    let text=line.text,any=false;
    for(const span of [...line.spans].reverse()) {
      const value=plan.translations.get(span.source.trim());
      if(!value) {failed.add(span.source.trim());continue;}
      const from=text.lastIndexOf(span.source.trim());
      if(from<0) continue;
      text=text.slice(0,from)+value+text.slice(from+span.source.trim().length);any=true;
    }
    return any?text:null;
  };
  let applied=0;
  for(const plan of plans) {
    let combined=plan.source;
    for(const block of [...plan.blocks].reverse()) {
      const sentences=block.map(line=>rendition(plan,line)).filter(Boolean).map(value=>ENDS_SENTENCE.test(value)?value:`${value}.`);
      if(!sentences.length) continue;
      applied+=sentences.length;
      const end=block.at(-1).end;
      combined=combined.slice(0,end)+`\n(번역: ${sentences.join(' ')})`+combined.slice(end);
    }
    if(combined!==plan.source) changed.push({index:plan.index,track:plan.track,combined});
  }
  // Only the changed lyric fields: an online case keeps following later service edits elsewhere.
  const overrides=album
    ?{tracks:changed.map(({track,combined})=>({id:track.id,lyrics:combined,...(manual?{original_lyrics:first(track.original_lyrics,track.lyrics)}:{}),...(track.lyrics_with_translation?{lyrics_with_translation:combined}:{})}))}
    :{submission:changed.length?{mv_lyrics:changed[0].combined,...(manual?{original_lyrics:first(detail.submission.original_lyrics,detail.submission.mv_lyrics,detail.submission.lyrics)}:{}),...(detail.submission.lyrics_with_translation?{lyrics_with_translation:changed[0].combined}:{})}:{}};
  if(changed.length) warnings.push('온사이드 번역 서비스로 미번역 가사를 번역해 원문 아래 (번역: …) 줄로 넣었습니다. 번역의 의미·욕설 표현·고유명사와 원문 대응을 제출 전에 확인하세요.');
  if(failed.size) warnings.push(`번역하지 못한 구간 ${failed.size}개는 원문 그대로 두었습니다. 고유명사·추임새인지 확인하고 필요하면 직접 번역하세요: ${[...failed].slice(0,8).join(', ')}${failed.size>8?' …':''}`);
  return {overrides,translatedCount:applied,warnings};
}
