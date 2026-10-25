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

/** Explicit administrator action only. Caller persists returned overrides atomically. */
export async function translateMissingLyrics({detail,serviceUrl,fetchImpl=fetch,signal}={}) {
  if(!detail?.submission||(detail.source!=='manual'&&detail.submission.source!=='manual')) throw new Error('관리자 수동 작업에서만 번역을 보완할 수 있습니다.');
  const base=new URL(serviceUrl);
  if(base.protocol!=='https:'||base.username||base.password) throw new Error('번역 서비스에는 HTTPS 온사이드 주소를 사용하세요.');
  const endpoint=new URL('/api/translate',base);
  const album=detail.submission.type==='ALBUM',warnings=[],plans=[];
  const tracks=album?(detail.tracks||[]):[{
    id:'mv',lyrics:effectiveLyricSource(detail.submission,{manual:true,field:'mv_lyrics'}).source,
    lyrics_with_translation:detail.submission.lyrics_with_translation,translated_lyrics:currentTranslation(detail.submission,'korean_lyrics_translation'),
    track_title:first(detail.submission.mv_song_title,detail.submission.title),is_instrumental:detail.submission.is_instrumental,
  }];
  for(const [index,track] of tracks.entries()) {
    const source=effectiveLyricSource(track,{manual:true}).source;
    const separate=currentTranslation(track);
    if(separate.trim()&&!source.includes(separate)) {warnings.push(`${index+1}번 ${text(track.track_title)}: 별도 번역이 있어 자동 보완을 건너뛰었습니다. 원문 대응을 확인하세요.`);continue;}
    if(isInstrumentalTrack(track)&&!hasMeaningfulLyrics(source)) continue;
    if(source.length>100000) throw new Error('가사가 자동 번역 확인 한도를 넘었습니다. 트랙을 나누거나 직접 번역을 입력하세요. 저장된 가사는 변경하지 않았습니다.');
    const spans=untranslatedLyricSpans(source);
    if(!spans.length) continue;
    if(spans.some(s=>s.source.length>5000)) throw new Error('한 외국어 구간이 너무 깁니다. 원문에 줄바꿈을 보완한 뒤 다시 실행하세요. 저장된 가사는 변경하지 않았습니다.');
    plans.push({index,track,source,spans,translations:new Map()});
  }
  const segmentCount=plans.reduce((n,p)=>n+p.spans.length,0),characters=plans.reduce((n,p)=>n+p.spans.reduce((n,s)=>n+s.source.length,0),0);
  if(segmentCount>2400||characters>60000) throw new Error('한 번에 번역할 수 있는 가사 분량을 넘었습니다. 일부 트랙을 먼저 보완하세요. 저장된 가사는 변경하지 않았습니다.');
  const batches=[];
  for(const plan of plans) {
    const unique=[...new Set(plan.spans.map(s=>s.source))];
    for(let i=0;i<unique.length;i+=120) batches.push({plan,lines:unique.slice(i,i+120)});
  }
  if(batches.length>20) throw new Error('한 번에 번역할 수 있는 트랙 수를 넘었습니다. 일부 트랙을 먼저 보완하세요. 저장된 가사는 변경하지 않았습니다.');
  for(const {plan,lines} of batches) {
    const context=plan.source.slice(0,12000).replace(/[\uD800-\uDBFF]$/,'');
    const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(55000)]):AbortSignal.timeout(55000);
    let response;
    try {response=await fetchImpl(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lines,source:'auto',target:'ko',context}),signal:requestSignal,redirect:'error',credentials:'omit'});}
    catch {throw new Error('번역 서비스에 연결하지 못했거나 요청이 취소되었습니다. 저장된 가사는 변경하지 않았습니다.');}
    if(!response.ok) throw new Error(response.status===429?'번역 요청이 일시적으로 많습니다. 잠시 후 다시 시도하세요. 저장된 가사는 변경하지 않았습니다.':'번역 서비스가 모든 구간을 완료하지 못했습니다. 저장된 가사는 변경하지 않았습니다.');
    const result=await responseJSON(response);
    if(!Array.isArray(result.translations)||result.translations.length!==lines.length||result.failedIndexes?.length) throw new Error('번역 응답의 구간 수가 일치하지 않습니다. 저장된 가사는 변경하지 않았습니다.');
    for(const [index,line] of lines.entries()) {
      const translated=result.translations[index];
      if(typeof translated!=='string'||!isUsableLyricsTranslation(translated,line,'ko')) throw new Error('일부 번역의 내용·형식 또는 욕설 보존을 확인하지 못했습니다. 저장된 가사는 변경하지 않았습니다.');
      // Single-line annotation format; reject embedded annotation delimiters instead of rewriting meaning.
      const normalized=translated.trim().replace(/\s*\r?\n\s*/g,' ');
      if(/[)）]/.test(normalized)) throw new Error('번역에 괄호가 포함되어 원문 대응을 직접 확인해야 합니다. 저장된 가사는 변경하지 않았습니다.');
      plan.translations.set(line,normalized);
    }
  }
  if(signal?.aborted) throw new Error('번역 요청이 취소되었습니다. 저장된 가사는 변경하지 않았습니다.');
  const changed=[];
  for(const plan of plans) {
    let combined=plan.source;
    for(const span of [...plan.spans].reverse()) combined=combined.slice(0,span.end)+` (번역 : ${plan.translations.get(span.source)})`+combined.slice(span.end);
    // Keep source in the editable lyrics field so repeat translation can see inline annotations.
    // The uploaded original document and original_lyrics are retained separately by the case.
    changed.push({index:plan.index,track:{...plan.track,original_lyrics:first(plan.track.original_lyrics,plan.track.lyrics),lyrics:combined,...(plan.track.lyrics_with_translation?{lyrics_with_translation:combined}:{})},combined});
  }
  const overrides=album?{tracks:tracks.map((track,index)=>changed.find(c=>c.index===index)?.track||track)}:
    {submission:{...detail.submission,...(changed.length?{original_lyrics:first(detail.submission.original_lyrics,detail.submission.mv_lyrics,detail.submission.lyrics),mv_lyrics:changed[0].combined,...(detail.submission.lyrics_with_translation?{lyrics_with_translation:changed[0].combined}:{})}:{})}};
  if(changed.length) warnings.push('기존 온사이드 번역 서비스로 미번역 구간만 보완했습니다. 번역의 의미·욕설 표현·고유명사와 원문 대응을 제출 전에 확인하세요.');
  return {overrides,translatedCount:segmentCount,warnings};
}
