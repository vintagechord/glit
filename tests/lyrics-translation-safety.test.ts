import assert from "node:assert/strict";
import test from "node:test";
import { buildInlineTranslatedLyrics, collectForeignLyricsSegments, LyricsTranslationError, requestLyricsTranslations } from "../src/lib/lyrics-tools";
import { isUsableLyricsTranslation, splitLyricsTranslationText, truncateLyricsContext } from "../src/lib/lyrics-translation-validation";
import { translateLyricsBatch } from "../src/lib/server-lyrics-translation";

test("translation validity rejects echo, placeholders and obvious censorship while retaining explicit meaning",()=>{
  for(const value of ["", "Translation", "번역 실패", "I LOVE YOU!!!", "번역: I love you", "죄송하지만 번역을 제공할 수 없습니다"]){assert.equal(isUsableLyricsTranslation(value,"I love you"),false,value)}
  assert.equal(isUsableLyricsTranslation("너는 나빠","Fuck you"),false);
  for(const source of ['f.u.c.k you','f u c k you','phuck you','sh1t']){
    assert.equal(isUsableLyricsTranslation('너는 나빠',source),false,source);
    assert.equal(isUsableLyricsTranslation('씨발 너',source),true,source);
  }
  assert.equal(isUsableLyricsTranslation("[욕설] 너","Fuck you"),false);
  assert.equal(isUsableLyricsTranslation("씨발 너","Fuck you"),true);
  assert.equal(isUsableLyricsTranslation("친절한 말 ***","Fuck you"),false);
  assert.equal(isUsableLyricsTranslation("널 사랑해","Je t’aime"),true);
});

test("inline rendering preserves raw Korean, CRLF, repetitions and original punctuation; partials cannot impersonate full translations",()=>{
  const original="  한글 I love you!\t오늘\r\nI love you!\r\n君が好き 한글";
  const {lines,segmentMap}=collectForeignLyricsSegments(original);
  const partial=buildInlineTranslatedLyrics(lines,segmentMap,["사랑해!","사랑해!",""],{allowPartial:true}).join("\n");
  assert.equal(partial,"  한글 I love you! (번역 : 사랑해!)\t오늘\r\nI love you! (번역 : 사랑해!)\r\n君が好き 한글");
  assert.throws(()=>buildInlineTranslatedLyrics(lines,segmentMap,["사랑해!","사랑해!",""]),/Translation failed/);
  assert.throws(()=>buildInlineTranslatedLyrics(lines,segmentMap,["사랑해!","사랑해!","좋아","추가"]),/Translation failed/);
  assert.throws(()=>buildInlineTranslatedLyrics(["changed",...lines.slice(1)],segmentMap,["사랑해!","사랑해!","좋아"]),/source changed/);
  const unicode="A".repeat(1199)+"😀tail";
  assert.equal(splitLyricsTranslationText(unicode).join(""),unicode);
  assert.ok(splitLyricsTranslationText(unicode).every(chunk=>!/[\uD800-\uDBFF]$/.test(chunk)));
  assert.equal(truncateLyricsContext("A".repeat(11999)+"😀tail").length,11999);
});

test("browser helper batches more than 120 inputs without clipping and deduplicates repeated excerpts",async(t)=>{
  const calls:string[][]=[];let active=0,peak=0;const release:Array<()=>void>=[];
  t.mock.method(globalThis,"fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
    assert.equal(input,"/api/translate");assert.ok(init?.signal);
    const body=JSON.parse(String(init?.body));calls.push(body.lines);peak=Math.max(peak,++active);
    assert.ok(body.context.length<=12000);assert.ok(body.lines.length<=120);
    if(calls.length<=2)await new Promise<void>(resolve=>release.push(resolve));
    active--;return Response.json({translations:body.lines.map((line:string)=>`번역 ${line.match(/\d+/)?.[0]}`)});
  });
  const sources=Array.from({length:241},(_,index)=>`Foreign source ${index}`);
  const result=requestLyricsTranslations([...sources,sources[0]],{context:"맥락".repeat(10000)});
  assert.equal(calls.length,2);release.forEach(resolve=>resolve());
  const translated=await result;
  assert.equal(peak,2);assert.deepEqual(calls.map(batch=>batch.length),[120,120,1]);
  assert.equal(translated.length,242);assert.equal(translated[0],"번역 0");assert.equal(translated[240],"번역 240");assert.equal(translated[241],"번역 0");
});

test("partial responses retry only missing inputs and expose aligned successful results for review",async(t)=>{
  const requests:string[][]=[];
  t.mock.method(globalThis,"fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
    if(input!=="/api/translate")return Response.json([]);
    const {lines}=JSON.parse(String(init?.body));requests.push(lines);
    return Response.json({translations:lines.map((line:string)=>line==='I love you'?'사랑해':"")},{status:502});
  });
  await assert.rejects(requestLyricsTranslations(["I love you","Stay with me","I love you"]),error=>{
    assert.ok(error instanceof LyricsTranslationError);assert.deepEqual(error.translations,["사랑해","","사랑해"]);assert.deepEqual(error.failedIndexes,[1]);return true;
  });
  assert.deepEqual(requests,[["I love you","Stay with me"],["Stay with me"]]);
});

test("API rate/size limits are not bypassed and malformed or echoed translations never pass validation",async(t)=>{
  let calls=0;
  t.mock.method(globalThis,"fetch",async(input:RequestInfo|URL)=>{calls++;assert.equal(input,"/api/translate");return Response.json({error:"limited"},{status:429})});
  await assert.rejects(requestLyricsTranslations(["Foreign source"]),LyricsTranslationError);assert.equal(calls,1);
  await assert.rejects(requestLyricsTranslations(["A".repeat(60001)]),LyricsTranslationError);assert.equal(calls,1);
  t.mock.method(globalThis,"fetch",async()=>Response.json({translations:["Foreign source"]}));
  await assert.rejects(requestLyricsTranslations(["Foreign source"]),LyricsTranslationError);
  t.mock.method(globalThis,"fetch",async()=>Response.json({translations:["번역","추가"]}));
  await assert.rejects(requestLyricsTranslations(["Foreign source"]),LyricsTranslationError);
  // An error response with an inexplicably complete payload is not success.
  t.mock.method(globalThis,"fetch",async()=>Response.json({translations:["완료 번역"]},{status:502}));
  await assert.rejects(requestLyricsTranslations(["Foreign source"]),LyricsTranslationError);
});

test("browser preserves the existing Google path only for server provider failures or network errors",async(t)=>{
  for(const serverStatus of [502,503,'network'] as const){
    const urls:string[]=[];
    t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
      urls.push(String(input));
      if(input==='/api/translate'){
        if(serverStatus==='network')throw new TypeError('fixture network failure');
        return Response.json({translations:['']},{status:serverStatus});
      }
      const url=new URL(String(input));assert.equal(url.origin,'https://translate.googleapis.com');assert.equal(url.searchParams.get('q'),'A clean fixture');
      return Response.json([[["깨끗한 예시"]]]);
    });
    assert.deepEqual(await requestLyricsTranslations(['A clean fixture']),['깨끗한 예시']);
    assert.equal(urls.length,2);assert.equal(urls[0],'/api/translate');
  }
  for(const status of [400,401,403,413,429]){
    const urls:string[]=[];
    t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{urls.push(String(input));return Response.json({error:'fixture failure'},{status})});
    await assert.rejects(requestLyricsTranslations(['A clean fixture']),LyricsTranslationError);assert.deepEqual(urls,['/api/translate']);
  }
});

test("Google fallback retains server successes, rejects echoes/censorship and has bounded concurrency",async(t)=>{
  const googleSources:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    assert.ok(init?.signal);
    if(input==='/api/translate')return Response.json({translations:['완료된 예시','']},{status:502});
    const url=new URL(String(input));googleSources.push(url.searchParams.get('q')!);return Response.json([[["남은 예시"]]]);
  });
  assert.deepEqual(await requestLyricsTranslations(['Complete sample','Missing sample']),['완료된 예시','남은 예시']);assert.deepEqual(googleSources,['Missing sample']);
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>input==='/api/translate'?Response.json({translations:['']},{status:503}):Response.json([[["너는 나빠"]]]));
  await assert.rejects(requestLyricsTranslations(['f.u.c.k you']),LyricsTranslationError);
  let active=0,peak=0;const release:Array<()=>void>=[];
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
    if(input==='/api/translate')return Response.json({error:'fixture unavailable'},{status:503});
    const url=new URL(String(input));assert.equal(url.origin,'https://translate.googleapis.com');assert.ok(url.searchParams.get('q')!.length<=1200);
    peak=Math.max(peak,++active);if(release.length<3)await new Promise<void>(resolve=>release.push(resolve));
    active--;return Response.json([[["예시 번역"]]]);
  });
  const result=requestLyricsTranslations(Array.from({length:10},(_,index)=>`Foreign sample ${index}`));
  for(let attempt=0;attempt<30&&release.length<3;attempt++)await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(release.length,3);release.forEach(resolve=>resolve());assert.equal((await result).length,10);assert.equal(peak,3);
});

test("browser cancellation returns a recoverable partial error even when fetch ignores its signal",async(t)=>{
  const controller=new AbortController();let calls=0;
  t.mock.method(globalThis,"fetch",async()=>{calls++;controller.abort();return new Promise<Response>(()=>{})});
  await assert.rejects(requestLyricsTranslations(["Foreign source"],{signal:controller.signal}),error=>{
    assert.ok(error instanceof LyricsTranslationError);assert.deepEqual(error.translations,[""]);assert.deepEqual(error.failedIndexes,[0]);return true;
  });assert.equal(calls,1);
});

test("server model batches are bounded, source-bound and preserve repeats without paid calls",async(t)=>{
  const originalKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY="fixture-key";
  t.after(()=>{if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey});
  const calls:string[][]=[];const sources=Array.from({length:43},(_,index)=>`Sample lyric ${index}`);
  const translated=await translateLyricsBatch([...sources,sources[0],"한국어 보존"],{context:"한국어 context",fetchImpl:async(input,init)=>{
    assert.equal(new URL(String(input)).hostname,"api.openai.com");const body=JSON.parse(String(init?.body));const data=JSON.parse(body.input);
    assert.equal(body.store,false);assert.equal(data.context,"한국어 context");assert.ok(data.lines.length<=20);assert.ok(data.lines.reduce((sum:number,line:{text:string})=>sum+line.text.length,0)<=4000);
    calls.push(data.lines.map((line:{text:string})=>line.text));
    return Response.json({status:"completed",output_text:JSON.stringify({translations:data.lines.map((line:{index:number;text:string})=>({index:line.index,source:line.text,translation:`가사 ${line.text.match(/\d+/)?.[0]}`}))})});
  }});
  assert.deepEqual(calls.map(batch=>batch.length).sort((a,b)=>b-a),[20,20,3]);assert.equal(translated[43],translated[0]);assert.equal(translated[44],"한국어 보존");
});

test("server deadline keeps completed excerpts while rejecting unavailable or euphemized excerpts",async(t)=>{
  const originalKey=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;t.mock.method(console,"error",()=>{});
  t.after(()=>{if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey});
  const result=await translateLyricsBatch(["Good sample","Unavailable sample"],{timeoutMs:10,fetchImpl:async input=>{
    const url=new URL(String(input));if(url.searchParams.get('q')==='Good sample')return Response.json([[["좋은 예시"]]]);return new Promise<Response>(()=>{});
  }});assert.deepEqual(result,["좋은 예시",""]);
  assert.deepEqual(await translateLyricsBatch(["Fuck you"],{fetchImpl:async input=>new URL(String(input)).hostname==='translate.googleapis.com'?Response.json([[["너는 나빠"]]]):Response.json({translation:"너는 나빠"})}),[""]);
});

test("one empty source-bound model item does not discard successful siblings or resend them to fallbacks",async(t)=>{
  const originalKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY="fixture-key";
  t.after(()=>{if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey});
  const fallbackSources:string[]=[];
  const result=await translateLyricsBatch(["Good source","Missing source","Good source"],{fetchImpl:async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==='api.openai.com'){
      const {lines}=JSON.parse(JSON.parse(String(init?.body)).input);
      return Response.json({status:'completed',output_text:JSON.stringify({translations:lines.map((line:{index:number;text:string})=>({index:line.index,source:line.text,translation:line.text==='Good source'?'완료된 번역':''}))})});
    }
    fallbackSources.push(url.searchParams.get('q')!);return Response.json([[["보완한 번역"]]]);
  }});
  assert.deepEqual(result,["완료된 번역","보완한 번역","완료된 번역"]);assert.deepEqual(fallbackSources,["Missing source"]);
});
