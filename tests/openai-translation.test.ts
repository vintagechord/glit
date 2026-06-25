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
                  text: "{\"translations\":[\"사랑해\"]}",
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
  assert.equal(
    (requestBody?.text as { format?: { type?: string } }).format?.type,
    "json_schema",
  );
});
