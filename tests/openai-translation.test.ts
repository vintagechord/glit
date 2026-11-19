import assert from "node:assert/strict";
import test from "node:test";

import { extractOpenAIResponseText, parseOpenAITranslations, translateLyricsWithOpenAI, isTranslationModelConfigured } from "../src/lib/openai-translation";

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

// Production had no translation key, and the free routes refuse the server
// (2026-11-19). A key made in the Vercel account reaches the same Responses
// API through Vercel AI Gateway, so no OpenAI account is needed.
test("the model is reached through Vercel AI Gateway when only its key is set, and OpenAI's own key wins", async (t) => {
  const saved = Object.fromEntries(["OPENAI_API_KEY", "OPENAI_TRANSLATION_MODEL", "OPENAI_MODEL", "AI_GATEWAY_API_KEY", "AI_GATEWAY_TRANSLATION_MODEL"].map((name) => [name, process.env[name]]));
  t.after(() => { for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  for (const name of Object.keys(saved)) delete process.env[name];
  const calls: Array<{ url: string; authorization: string; model: string }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), authorization: String((init?.headers as Record<string, string>).Authorization), model: JSON.parse(String(init?.body)).model });
    return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ translations: [{ index: 0, source: "I love you", translation: "사랑해" }] }) }] }] });
  };

  // No key at all: nothing is asked.
  assert.equal(await translateLyricsWithOpenAI(["I love you"], { fetchImpl }), null);
  assert.equal(isTranslationModelConfigured(), false);
  assert.equal(calls.length, 0);

  process.env.AI_GATEWAY_API_KEY = " gateway-key ";
  assert.equal(isTranslationModelConfigured(), true);
  assert.deepEqual(await translateLyricsWithOpenAI(["I love you"], { fetchImpl }), ["사랑해"]);
  assert.deepEqual(calls.pop(), { url: "https://ai-gateway.vercel.sh/v1/responses", authorization: "Bearer gateway-key", model: "openai/gpt-5-mini" });

  process.env.AI_GATEWAY_TRANSLATION_MODEL = "anthropic/claude-haiku-5.5";
  await translateLyricsWithOpenAI(["I love you"], { fetchImpl });
  assert.equal(calls.pop()?.model, "anthropic/claude-haiku-5.5");

  // An OpenAI key set next to it keeps talking to OpenAI with OpenAI's model names.
  process.env.OPENAI_API_KEY = "openai-key";
  await translateLyricsWithOpenAI(["I love you"], { fetchImpl });
  assert.deepEqual(calls.pop(), { url: "https://api.openai.com/v1/responses", authorization: "Bearer openai-key", model: "gpt-5.5" });
});

// Measured through the gateway on 2026-11-20: a batch of 20 lyric lines takes
// about 13 seconds with openai/gpt-5-mini (reasoning effort low, the setting
// that keeps explicit wording). The 15 seconds allowed for OpenAI's own
// endpoint would cut off an ordinary batch.
test("a batch through the gateway is given 30 seconds, and the configured limit still applies", async (t) => {
  const saved = Object.fromEntries(["OPENAI_API_KEY", "AI_GATEWAY_API_KEY", "OPENAI_TRANSLATION_TIMEOUT_MS"].map((name) => [name, process.env[name]]));
  t.after(() => { for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  for (const name of Object.keys(saved)) delete process.env[name];
  process.env.AI_GATEWAY_API_KEY = "gateway-key";
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stalled: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });
  const settle = async (promise: Promise<unknown>) => {
    let state = "pending";
    promise.then(() => { state = "resolved"; }, (error: Error) => { state = error.name; });
    return async () => { for (let turn = 0; turn < 20; turn += 1) await Promise.resolve(); return state; };
  };

  const viaGateway = await settle(translateLyricsWithOpenAI(["I love you"], { fetchImpl: stalled }));
  t.mock.timers.tick(29_999);
  assert.equal(await viaGateway(), "pending");
  t.mock.timers.tick(1);
  assert.equal(await viaGateway(), "TimeoutError");

  process.env.OPENAI_TRANSLATION_TIMEOUT_MS = "5000";
  const configured = await settle(translateLyricsWithOpenAI(["I love you"], { fetchImpl: stalled }));
  t.mock.timers.tick(5_000);
  assert.equal(await configured(), "TimeoutError");

  delete process.env.OPENAI_TRANSLATION_TIMEOUT_MS; delete process.env.AI_GATEWAY_API_KEY; process.env.OPENAI_API_KEY = "openai-key";
  const direct = await settle(translateLyricsWithOpenAI(["I love you"], { fetchImpl: stalled }));
  t.mock.timers.tick(15_000);
  assert.equal(await direct(), "TimeoutError");
});
