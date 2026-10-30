import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewLyrics, screeningReport, SCREENING_LIMITS } from '../screening.mjs';
import { translateMissingLyrics } from '../manual-translation.mjs';
import { applyOverrides,validateLocalPatch } from '../core.mjs';
const album=tracks=>({submission:{type:'ALBUM',source:'manual'},tracks});
const track=lyrics=>({id:'t1',track_no:1,track_title:'검수곡',lyrics});
const json=translations=>new Response(JSON.stringify({translations}),{status:200,headers:{'Content-Type':'application/json'}});

test('offline review finds separated, masked and suspected profanity with the original location',()=>{
  const source='첫 줄\n씨 발 그대로\nf**k this\nㅅㅂ 말했어',input=album([track(source)]);
  const result=reviewLyrics(input);
  assert.equal(result.counts.profanity,2);assert.equal(result.counts.suspected,1);
  assert.deepEqual(result.findings.filter(f=>f.kind==='profanity').map(f=>[f.line,f.matchedText]),[[2,'씨 발'],[3,'f**k']]);
  assert.equal(result.findings.find(f=>f.kind==='suspected').trackTitle,'검수곡');
  assert.equal(input.tracks[0].lyrics,source);
  assert.match(screeningReport(result),/2행\n원문: 씨 발 그대로/);
});
test('safe phrases, section labels, adlibs, English titles and credits do not create noisy alerts',()=>{
  const result=reviewLyrics(album([{...track('[Verse 1]\nOh, yeah\n새끼고양이와 시발점\n다시 발걸음을 옮겨'),track_title:'Midnight Sky',composer:'John Smith'}]));
  assert.equal(result.requiresReview,false);assert.deepEqual(result.findings,[]);
});
test('translations are checked per occurrence, preserve supplied translations and flag unclear alignment',()=>{
  const result=reviewLyrics(album([track('I love you (번역 : 사랑해)\nI love you\nHello world\n(번역 : 안녕 세상아)')]));
  assert.deepEqual(result.findings.filter(f=>f.kind==='translation_missing').map(f=>f.line),[2]);
  const separated=reviewLyrics(album([{...track('I love you\nHello world'),translated_lyrics:'사랑해\n안녕 세상아'}]));
  assert.equal(separated.counts.translation_review,2);assert.equal(separated.counts.translation_missing,0);
  const censored=reviewLyrics(album([track('Fuck you (번역 : 널 사랑해)')]));
  assert.equal(censored.counts.profanity,1);assert.equal(censored.counts.translation_review,1);
});
test('instrumental designation never turns missing or conflicting lyrics into a clean pass',()=>{
  const result=reviewLyrics(album([track('가사 없음'),{...track(''),id:'t2',track_no:2,is_instrumental:true},{...track('실제 가사'),id:'t3',track_no:3,is_instrumental:true}]));
  assert.equal(result.counts.lyrics_missing,1);assert.equal(result.counts.instrumental_conflict,1);
  assert.equal(result.findings.find(f=>f.kind==='instrumental_conflict').trackNo,3);
});
test('review hash invalidates edited text and identifies incomplete large-input scanning',()=>{
  const input=album([track('우리 함께 가요')]);const before=reviewLyrics(input);
  assert.equal(before.sourceHash,reviewLyrics(structuredClone(input)).sourceHash);
  input.tracks[0].lyrics+='!';assert.notEqual(before.sourceHash,reviewLyrics(input).sourceHash);
  const large=reviewLyrics(album([track('가'.repeat(SCREENING_LIMITS.charactersPerField+1))]));
  assert.equal(large.incomplete,true);assert.ok(large.findings.some(f=>f.kind==='incomplete'));
  const many=reviewLyrics(album([track(Array.from({length:1600},()=> '씨발').join('\n'))]));
  assert.equal(many.incomplete,true);assert.ok(many.findings.length<=SCREENING_LIMITS.findings);
});
test('MV review uses MV lyrics and translation fields',()=>{
  const result=reviewLyrics({submission:{type:'MV_DISTRIBUTION',source:'manual',mv_song_title:'영상곡',mv_lyrics:'Hello world',korean_lyrics_translation:'안녕 세상아'}});
  assert.equal(result.findings[0].trackTitle,'영상곡');assert.equal(result.counts.translation_review,1);
});
test('parenthesized Korean translation on the next line is preserved without translating again',async()=>{
  const lyrics='I follow the shining light\n(나는 빛나는 빛을 따라가)\n\nWe dance into the night\n（우리는 밤속에서 춤춰）\n\nI love your ways\n(네가 움직이는(작동하는) 방식이 좋아)';
  const detail={source:'manual',submission:{type:'MV_DISTRIBUTION',mv_song_title:'다음 줄 번역',mv_lyrics:lyrics}};
  const review=reviewLyrics(detail);
  assert.equal(review.counts.translation_missing,0);
  assert.equal(review.counts.translation_review,0);
  const result=await translateMissingLyrics({detail,serviceUrl:'https://example.invalid',fetchImpl:async()=>{throw new Error('Supplied translations must not trigger a request');}});
  assert.equal(result.translatedCount,0);
  assert.equal(result.overrides.submission.mv_lyrics,lyrics);
});
test('ordinary Korean lyrics and ambiguous next-line annotations still require review',()=>{
  const result=reviewLyrics(album([track('Hello world\n다음 가사 원문\nHello 세상 goodbye\n(안녕 세상)\nHello again\n(다시 안녕) 이어지는 별도 가사')]));
  assert.deepEqual(result.findings.filter(f=>f.kind==='translation_missing').map(f=>f.line),[1,3,5]);
});
test('explicit translation only fills missing segments, repeats annotations and preserves source metadata',async()=>{
  const detail=album([track('I love you (번역 : 사랑해)\nHello world\nHello world\nOh, yeah')]);
  const before=structuredClone(detail),calls=[];
  const result=await translateMissingLyrics({detail,serviceUrl:'https://onside.test',fetchImpl:async(url,options)=>{
    calls.push({url,options});assert.deepEqual(JSON.parse(options.body).lines,['Hello world']);return json(['안녕 세상아']);
  }});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://onside.test/api/translate');
  assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.credentials,'omit');
  assert.equal(result.translatedCount,2);assert.deepEqual(detail,before);
  assert.equal(result.overrides.tracks[0].lyrics,'I love you (번역 : 사랑해)\nHello world (번역 : 안녕 세상아)\nHello world (번역 : 안녕 세상아)\nOh, yeah');
  assert.equal(result.overrides.tracks[0].original_lyrics,before.tracks[0].lyrics);
  assert.equal(reviewLyrics({...detail,tracks:result.overrides.tracks}).counts.translation_missing,0);
  const repeat=await translateMissingLyrics({detail:{...detail,tracks:result.overrides.tracks},serviceUrl:'https://onside.test',fetchImpl:()=>{throw new Error('must not call');}});
  assert.equal(repeat.translatedCount,0);
});
test('separate provided translations are never mapped by line number or overwritten',async()=>{
  const detail=album([{...track('Hello world\nI love you'),translated_lyrics:'두 구간의 의미를 합친 번역'}]);
  const result=await translateMissingLyrics({detail,serviceUrl:'https://onside.test',fetchImpl:()=>{throw new Error('must not call');}});
  assert.equal(result.translatedCount,0);assert.deepEqual(result.overrides.tracks,detail.tracks);assert.match(result.warnings[0],/별도 번역/);
});
test('partial, censored, cancelled or failed translation leaves the case untouched',async()=>{
  for(const fetchImpl of [async()=>json([]),async()=>json(['좋은 말']),async()=>new Response('{}',{status:502}),async()=>{throw new Error('network');}]) {
    const detail=album([track('Fuck you')]),before=structuredClone(detail);
    await assert.rejects(()=>translateMissingLyrics({detail,serviceUrl:'https://onside.test',fetchImpl}),/변경하지 않았습니다/);
    assert.deepEqual(detail,before);
  }
  const detail=album([track('Hello world')]);const controller=new AbortController();controller.abort();
  await assert.rejects(()=>translateMissingLyrics({detail,serviceUrl:'https://onside.test',signal:controller.signal,fetchImpl:async()=>json(['안녕 세상아'])}),/취소/);
});
test('translation preserves MV original and rejects nonmanual intake or insecure destination',async()=>{
  const detail={source:'manual',submission:{type:'MV_DISTRIBUTION',mv_lyrics:'Hello world'}};
  const result=await translateMissingLyrics({detail,serviceUrl:'https://onside.test',fetchImpl:async()=>json(['안녕 세상아'])});
  assert.equal(result.overrides.submission.mv_lyrics,'Hello world (번역 : 안녕 세상아)');
  assert.equal(result.overrides.submission.original_lyrics,'Hello world');assert.equal(detail.submission.mv_lyrics,'Hello world');
  await assert.rejects(()=>translateMissingLyrics({detail:album([]),serviceUrl:'http://localhost'}),/HTTPS/);
  await assert.rejects(()=>translateMissingLyrics({detail:{submission:{type:'ALBUM'}},serviceUrl:'https://onside.test'}),/수동 작업/);
});

test('cleared editable lyrics and translations do not restore reference or stale combined text',async()=>{
  const detail={source:'manual',submission:{type:'ALBUM'},tracks:[{...track(''),original_lyrics:'Hello world',lyrics_with_translation:'Hello world (번역 : 안녕 세상아)',is_instrumental:true}]};
  assert.equal(reviewLyrics(detail).requiresReview,false);
  const result=await translateMissingLyrics({detail,serviceUrl:'https://onside.test',fetchImpl:()=>{throw new Error('must not call');}});
  assert.equal(result.translatedCount,0);assert.equal(result.overrides.tracks[0].lyrics,'');
  const mv={source:'manual',submission:{type:'MV_DISTRIBUTION',mv_lyrics:'',original_lyrics:'Hello world',lyrics_with_translation:'Hello world (번역 : 안녕 세상아)'}};
  assert.equal(reviewLyrics(mv).counts.lyrics_missing,1);assert.equal(reviewLyrics(mv).counts.translation_missing,0);
  assert.equal((await translateMissingLyrics({detail:mv,serviceUrl:'https://onside.test',fetchImpl:()=>{throw new Error('must not call');}})).translatedCount,0);
  const translationCleared=reviewLyrics(album([{...track('Hello world'),translated_lyrics:'',korean_lyrics_translation:'안녕 세상아'}]));
  assert.equal(translationCleared.counts.translation_missing,1);assert.equal(translationCleared.counts.translation_review,0);
});
test('editing translated lyrics through the local patch invalidates stale combined lyrics',()=>{
  const detail=album([{...track('Hello world'),lyrics_with_translation:'Hello world (번역 : 안녕 세상아)'}]);
  const local=validateLocalPatch({overrides:{tracks:[{id:'t1',lyrics:'새로운 가사'}]}},{},['t1']);
  const effective=applyOverrides(detail,local),review=reviewLyrics(effective);
  assert.equal(effective.tracks[0].lyrics_with_translation,'');assert.equal(review.counts.translation_missing,0);assert.equal(review.requiresReview,false);
});
