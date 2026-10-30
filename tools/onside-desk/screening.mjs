import { createHash } from 'node:crypto';
import { analyzeLyricsProfanity, findForeignLyricsSpans, inlineLyricTranslation, isUsableLyricsTranslation, SCREENING_ENGINE_VERSION } from './screening-engine.mjs';

const value=v=>typeof v==='string'?v:typeof v==='number'?String(v):'';
const first=(...values)=>values.map(value).find(v=>v.trim())||'';
export const SCREENING_LIMITS=Object.freeze({charactersPerField:100000,tracks:300,findings:1500});
const kinds=['profanity','suspected','translation_missing','translation_review','lyrics_missing','instrumental_conflict','incomplete'];
const placeholder=/^(?:가사\s*없음(?:\s*[/／-]\s*(?:instrumental|inst\.?|m\.?r\.?))?|instrumental|inst\.?|m\.?r\.?|연주곡|반주)\s*[.!]?$/i;
export const hasMeaningfulLyrics=lyrics=>!!value(lyrics).trim()&&!placeholder.test(value(lyrics).trim());
export const isInstrumentalTrack=t=>t.is_instrumental===true||t.instrumental_confirmed===true||(t.is_instrumental!==false&&/(?:^|[([])\s*(?:inst\.?|instrumental|m\.?r\.?|karaoke|연주곡|반주)(?:\s+(?:ver\.?|version))?\s*(?:$|[)\]])/i.test(first(t.track_title,t.title)));
// An explicit empty edit is intentional; reference lyrics must not resurrect it.
export function currentLyrics(record,field='lyrics') {
  if(typeof record[field]==='string') return record[field];
  if(field!=='lyrics'&&typeof record.lyrics==='string') return record.lyrics;
  return value(record.original_lyrics);
}
export function effectiveLyricSource(record,{manual=false,field='lyrics'}={}) {
  const original=currentLyrics(record,field);
  const editable=typeof record[field]==='string'||(field!=='lyrics'&&typeof record.lyrics==='string');
  const combined=manual&&editable&&original===''?'':value(record.lyrics_with_translation);
  return {original,combined,source:combined||original};
}
export function currentTranslation(record,field='translated_lyrics') {
  if(typeof record[field]==='string') return record[field];
  return value(record[field==='translated_lyrics'?'korean_lyrics_translation':'translated_lyrics']);
}
const sectionLabel=/^\s*[[({]?(?:(?:verse|chorus|hook|pre[- ]?chorus|post[- ]?chorus|intro|outro|bridge|interlude|refrain|instrumental|inst\.?|rap|repeat|break|solo)(?:\s*\d+)?(?:\s*[x×]\s*\d+)?)[\])}]?\s*[:：]?\s*$/i;
const excerpt=(input,start)=>{
  const from=input.lastIndexOf('\n',Math.max(0,start-1))+1;
  const end=input.indexOf('\n',start);
  const line=input.slice(from,end<0?input.length:end).replace(/\r$/,'');
  if(line.length<=260) return line;
  const relative=start-from,windowStart=Math.max(0,relative-100);
  return `${windowStart?'…':''}${line.slice(windowStart,windowStart+260)}${line.length>windowStart+260?'…':''}`;
};
const digest=v=>createHash('sha256').update(v).digest('hex');

function fullLineTranslation(line) {
  const inline=inlineLyricTranslation(line);
  if(inline&&!line.slice(inline.text.length).trim()) return inline;
  const value=line.trim();
  if(!/^[（(]\s*[가-힣]/.test(value)) return null;
  const closers=[];
  for(let i=0;i<value.length;i++) {
    const char=value[i];
    if(char==='('||char==='（') closers.push(char==='('?')':'）');
    else if(char===')'||char==='）') {
      if(closers.pop()!==char||(!closers.length&&i!==value.length-1)) return null;
    }
  }
  return !closers.length?{text:line,translation:value.slice(1,-1).trim()}:null;
}

function adjacentTranslation(tail,singleSpanLine) {
  const inline=inlineLyricTranslation(tail);
  if(inline) return inline;
  if(!singleSpanLine) return null;
  const next=tail.match(/^[ \t]*\r?\n([^\n\r]*)/);
  if(!next) return null;
  // The entire immediately following line must be a supplied annotation.
  // Plain Korean lyrics and annotations shared by multiple spans remain uncertain.
  return fullLineTranslation(next[1]);
}

/** Source spans that actually lack an adjacent supplied translation. No guessing. */
export function untranslatedLyricSpans(lyrics) {
  const source=value(lyrics),all=findForeignLyricsSpans(source).filter(span=>!sectionLabel.test(excerpt(source,span.start)));
  const lineCounts=new Map();
  for(const span of all) {const start=source.lastIndexOf('\n',span.start)+1;lineCounts.set(start,(lineCounts.get(start)||0)+1);}
  return all.filter(span=>{
    const tail=source.slice(span.end);
    if(adjacentTranslation(tail,lineCounts.get(source.lastIndexOf('\n',span.start)+1)===1)) return false;
    // Explicit but empty/invalid annotations are supplied content for manual review.
    return !/^[ \t]*(?:[（([{]\s*)?(?:번역|해석)\s*[:：]/.test(tail);
  });
}

function reviewTracks(submission,tracks,manual) {
  if(submission.type==='ALBUM') return tracks.map((track,index)=>({
    ...track,id:first(track.id,`track-${index+1}`),track_no:Number(track.track_no)||index+1,
    track_title:first(track.track_title,track.track_title_official,track.title),
    lyrics:currentLyrics(track),lyrics_with_translation:effectiveLyricSource(track,{manual}).combined,
    translated_lyrics:currentTranslation(track),
  }));
  return [{id:'mv',track_no:1,track_title:first(submission.mv_song_title_official,submission.mv_song_title,submission.mv_song_title_kr,submission.title),
    lyrics:currentLyrics(submission,'mv_lyrics'),
    lyrics_with_translation:effectiveLyricSource(submission,{manual,field:'mv_lyrics'}).combined,translated_lyrics:currentTranslation(submission,'korean_lyrics_translation'),
    is_instrumental:submission.is_instrumental,instrumental_confirmed:submission.instrumental_confirmed}];
}

/** Offline warnings, never a rating decision. Original text is not modified. */
export function reviewLyrics({submission={},source,tracks=[]}={}) {
  const list=reviewTracks(submission,Array.isArray(tracks)?tracks:[],source==='manual'||submission.source==='manual');
  const sourceHash=digest(JSON.stringify({version:3,engine:SCREENING_ENGINE_VERSION,type:submission.type,tracks:list.map(t=>({id:t.id,no:t.track_no,title:t.track_title,lyrics:t.lyrics,combined:value(t.lyrics_with_translation),translation:t.translated_lyrics,instrumental:t.is_instrumental,confirmed:t.instrumental_confirmed}))}));
  const findings=[],counts=Object.fromEntries(kinds.map(k=>[k,0]));
  const newlineCache=new Map();
  const linesAt=(input,start)=>{
    let breaks=newlineCache.get(input);
    if(!breaks) {breaks=[];for(let i=input.indexOf('\n');i>=0;i=input.indexOf('\n',i+1)) breaks.push(i);newlineCache.set(input,breaks);}
    let lo=0,hi=breaks.length;while(lo<hi) {const mid=(lo+hi)>>>1;if(breaks[mid]<start) lo=mid+1;else hi=mid;}
    return lo+1;
  };
  let incomplete=false,overflow=false;
  const add=(kind,track,field,input,start,message,matchedText='')=>{
    if(findings.length>=SCREENING_LIMITS.findings-1) {incomplete=true;overflow=true;return;}
    const line=start===null?null:linesAt(input,start);
    const finding={id:digest(`${sourceHash}|${kind}|${track?.id||''}|${field}|${start}|${message}`).slice(0,24),kind,severity:kind==='profanity'?'attention':'warning',
      trackId:track?.id||null,trackNo:track?.track_no||null,trackTitle:track?.track_title||'',field,line,
      excerpt:start===null?'':excerpt(input,start),matchedText:value(matchedText).slice(0,240),message};
    if(findings.some(f=>f.id===finding.id)) return;
    findings.push(finding);counts[kind]++;
    if(kind==='incomplete') incomplete=true;
  };
  if(!list.length) add('lyrics_missing',null,'lyrics','',null,'신청 트랙이 없습니다. 트랙과 가사를 입력하세요.');
  if(list.length>SCREENING_LIMITS.tracks) add('incomplete',null,'lyrics','',null,`자동 확인은 처음 ${SCREENING_LIMITS.tracks}개 트랙까지 수행했습니다. 나머지 트랙을 직접 확인하세요.`);
  for(const track of list.slice(0,SCREENING_LIMITS.tracks)) {
    const original=value(track.lyrics),combined=value(track.lyrics_with_translation),translation=value(track.translated_lyrics);
    const source=combined||original,inst=isInstrumentalTrack(track);
    if(inst&&(hasMeaningfulLyrics(source)||hasMeaningfulLyrics(translation))) add('instrumental_conflict',track,'lyrics',source,0,'연주곡 표시와 가사가 함께 있습니다. 연주곡 여부를 확인하세요. 제공된 가사는 삭제하지 않습니다.');
    if(!hasMeaningfulLyrics(source)&&!inst) add('lyrics_missing',track,'lyrics',source,null,'가사가 없거나 가사 없음으로만 표시되어 있습니다. 가사를 보완하거나 연주곡 여부를 직접 지정하세요.');
    const fields=[['lyrics',source]];
    // Do not lose a warning if an edited combined version omitted part of the original.
    if(combined&&original&&combined!==original&&!combined.includes(original)) fields.push(['original_lyrics',original]);
    if(translation&&!source.includes(translation)) fields.push(['translated_lyrics',translation]);
    for(const [field,input] of fields) {
      const analysis=analyzeLyricsProfanity(input);
      for(const match of analysis.matches) add(match.category==='confident'?'profanity':'suspected',track,field,input,match.start,
        match.category==='confident'?'욕설·비하 표현 규칙과 일치합니다. 원문과 문맥을 확인하세요.':'욕설로도 쓰일 수 있는 초성·발음·중의적 표현입니다. 문맥을 확인하세요.',match.matchedText);
      if(analysis.truncated) add('incomplete',track,field,input,null,'가사 길이 또는 탐지 건수 제한으로 자동 확인이 일부만 수행되었습니다. 원문 전체를 직접 확인하세요.');
    }
    if(inst&&!hasMeaningfulLyrics(source)) continue;
    const limited=source.slice(0,SCREENING_LIMITS.charactersPerField);
    if(source.length>limited.length) add('incomplete',track,'lyrics',source,null,`미번역 확인은 처음 ${SCREENING_LIMITS.charactersPerField.toLocaleString('ko-KR')}자까지 수행했습니다. 이후 가사도 직접 확인하세요.`);
    const spans=findForeignLyricsSpans(limited).filter(span=>!sectionLabel.test(excerpt(limited,span.start)));
    const lineCounts=new Map();for(const span of spans) {const line=linesAt(limited,span.start);lineCounts.set(line,(lineCounts.get(line)||0)+1);}
    const warnedLines=new Set();
    for(const span of spans) {
      const tail=limited.slice(span.end);
      const annotation=adjacentTranslation(tail,lineCounts.get(linesAt(limited,span.start))===1);
      if(annotation&&isUsableLyricsTranslation(annotation.translation,span.source)) continue;
      const line=linesAt(limited,span.start);
      if(warnedLines.has(line)) continue;
      warnedLines.add(line);
      if(annotation) add('translation_review',track,'lyrics',source,span.start,'제공된 번역의 내용 또는 표기를 확인하세요. 빈 번역·검열 표기 등은 완성된 번역으로 판단하지 않습니다.',span.source);
      else if(translation.trim()) add('translation_review',track,'lyrics',source,span.start,'번역이 별도로 제공되어 있습니다. 이 원문 구간에 대응하는 번역인지 확인한 뒤 원문 바로 뒤에 배치하세요.',span.source);
      else add('translation_missing',track,'lyrics',source,span.start,'이 외국어 구간에 대응하는 한글 번역을 확인하지 못했습니다. 의미 있는 가사는 번역을 보완하고, 고유명사·추임새라면 문맥을 직접 확인하세요.',span.source);
    }
    if(translation.trim()&&!spans.length&&!source.includes(translation)) add('translation_review',track,'translated_lyrics',translation,0,'별도 번역의 원문 대응을 확인하세요. 제공된 번역을 임의로 삭제하거나 다시 번역하지 않습니다.');
  }
  if(overflow) {const message=`확인사항 ${SCREENING_LIMITS.findings-1}건 이후는 표시를 생략했습니다. 가사 전체를 직접 확인하세요.`;findings.push({id:digest(`${sourceHash}|overflow`).slice(0,24),kind:'incomplete',severity:'warning',trackId:null,trackNo:null,trackTitle:'',field:'lyrics',line:null,excerpt:'',matchedText:'',message});counts.incomplete++;}
  return {version:3,sourceHash,revision:sourceHash,findings,counts,requiresReview:findings.length>0,incomplete,
    notice:'자동 확인은 규칙 기반 참고 정보이며 심의 적격·등급 판정이나 모든 욕설·미번역의 탐지를 보장하지 않습니다. 원문을 유지하며 자동 검열·임의 번역을 하지 않습니다.'};
}

export function screeningReport(screening) {
  const labels={profanity:'욕설 표현',suspected:'욕설 의심',translation_missing:'번역 필요',translation_review:'번역 대응 확인',lyrics_missing:'가사 누락',instrumental_conflict:'연주곡 표시 확인',incomplete:'자동 확인 제한'};
  return ['가사 확인사항',screening.notice,`확인사항: ${screening.findings.length}건`,
    '',...(screening.findings.length?screening.findings.flatMap(f=>[
      `[${labels[f.kind]||'확인 필요'}] ${f.trackNo?`${f.trackNo}번 `:''}${f.trackTitle||'전체'}${f.line?` / ${f.field==='translated_lyrics'?'제공된 번역 ':f.field==='original_lyrics'?'별도 원문 ':''}${f.line}행`:''}`,
      f.excerpt?`원문: ${f.excerpt}`:'',f.matchedText?`확인 구간: ${f.matchedText}`:'',f.message,'',
    ]):['자동 규칙에 해당하는 확인사항이 없습니다. 제출 전 원문과 번역을 직접 검토하세요.'])].join('\n');
}
