import assert from "node:assert/strict";
import test from "node:test";

import {
  extractOpenAIResponseText,
  parseOpenAITranslations,
  translateLyricsWithOpenAI,
} from "../src/lib/openai-translation";

test("extractOpenAIResponseText reads SDK-style output_text", () => {
  assert.equal(
    extractOpenAIResponseText({
      output_text: "{\"translations\":[\"사랑해\"]}",
    }),
    "{\"translations\":[\"사랑해\"]}",
  );
});

test("extractOpenAIResponseText reads Responses API output content", () => {
  assert.equal(
    extractOpenAIResponseText({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "{\"translations\":[\"사랑해\",\"테스트입니다\"]}",
            },
          ],
        },
      ],
    }),
    "{\"translations\":[\"사랑해\",\"테스트입니다\"]}",
  );
});

test("parseOpenAITranslations validates translation count", () => {
  assert.deepEqual(
    parseOpenAITranslations(
      { output_text: "{\"translations\":[\"사랑해\",\"테스트입니다\"]}" },
      2,
    ),
    ["사랑해", "테스트입니다"],
  );

  assert.throws(
    () =>
      parseOpenAITranslations(
        { output_text: "{\"translations\":[\"사랑해\"]}" },
        2,
      ),
    /count mismatch/,
  );
});

test("translateLyricsWithOpenAI sends a structured Responses request", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  const translations = await translateLyricsWithOpenAI(["I love you"], {
    apiKey: "test-key",
    model: "gpt-test",
    fetchImpl: async (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({translations:[{index:0,source:"I love you",translation:"사랑해"}]}),
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  const requestBody = requestBodies[0];
  assert.deepEqual(translations, ["사랑해"]);
  assert.equal(requestBody?.model, "gpt-test");
  assert.deepEqual(requestBody?.reasoning, { effort: "low" });
  assert.equal(requestBody?.store, false);
  assert.match(String(requestBody?.instructions), /never censor, soften, sanitize, summarize, omit/);
  assert.equal(
    (requestBody?.text as { format?: { type?: string } }).format?.type,
    "json_schema",
  );
});

test("provider completion rejects incomplete/refused, reordered-source and duplicate-index responses", () => {
  const output=(entries:unknown[],extra={})=>({status:"completed",output_text:JSON.stringify({translations:entries}),...extra});
  const one={index:0,source:"First",translation:"첫째"};const two={index:1,source:"Second",translation:"둘째"};
  assert.deepEqual(parseOpenAITranslations(output([two,one]),2,["First","Second"]),["첫째","둘째"]);
  assert.deepEqual(parseOpenAITranslations(output([{...one,translation:""},two]),2,["First","Second"]),["","둘째"]);
  for(const payload of [output([one,two],{status:"incomplete"}),output([one,two],{incomplete_details:{reason:"max_output_tokens"}}),output([one,two],{output:[{type:"message",content:[{type:"refusal"}]}]}),output([one,one]),output([{...one,source:"Second"},two])]){
    assert.throws(()=>parseOpenAITranslations(payload,2,["First","Second"]));
  }
});

test("the adapter bounds a stalled response body and obeys caller cancellation without real requests",async()=>{
  await assert.rejects(translateLyricsWithOpenAI(["Fixture"],{apiKey:"fixture-key",timeoutMs:5,fetchImpl:async()=>new Response(new ReadableStream({start(){}}))}),{name:"TimeoutError"});
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(translateLyricsWithOpenAI(["Fixture"],{apiKey:"fixture-key",signal:controller.signal,fetchImpl:async()=>{calls++;throw new Error("must not fetch")}}),{name:"AbortError"});
  assert.equal(calls,0);
});
