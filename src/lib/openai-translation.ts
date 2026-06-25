type OpenAIResponseOutputContent = {
  type?: string;
  text?: string;
};

type OpenAIResponseOutputItem = {
  type?: string;
  content?: OpenAIResponseOutputContent[];
};

type OpenAIResponsesPayload = {
  output_text?: string;
  output?: OpenAIResponseOutputItem[];
};

type TranslateWithOpenAIOptions = {
  apiKey?: string;
  model?: string;
  source?: string;
  target?: string;
  fetchImpl?: typeof fetch;
};

const openAIResponsesEndpoint = "https://api.openai.com/v1/responses";
const defaultOpenAITranslationModel = "gpt-5.5";
const defaultOpenAITranslationTimeoutMs = 15000;

const getOpenAITranslationModel = (model?: string) =>
  model?.trim() ||
  process.env.OPENAI_TRANSLATION_MODEL?.trim() ||
  process.env.OPENAI_MODEL?.trim() ||
  defaultOpenAITranslationModel;

const getOpenAITranslationTimeoutMs = () => {
  const raw = Number(process.env.OPENAI_TRANSLATION_TIMEOUT_MS ?? "");
  return Number.isFinite(raw) && raw > 0
    ? raw
    : defaultOpenAITranslationTimeoutMs;
};

export const extractOpenAIResponseText = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as OpenAIResponsesPayload;
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((content) => {
      if (
        (content.type === "output_text" || content.type === "text") &&
        typeof content.text === "string"
      ) {
        return content.text;
      }
      return "";
    })
    .join("")
    .trim();
};

export const parseOpenAITranslations = (
  payload: unknown,
  expectedCount: number,
) => {
  const outputText = extractOpenAIResponseText(payload);
  if (!outputText) {
    throw new Error("OpenAI translation returned empty output");
  }

  const parsed = JSON.parse(outputText) as { translations?: unknown };
  if (!Array.isArray(parsed.translations)) {
    throw new Error("OpenAI translation response is missing translations");
  }

  const translations = parsed.translations.map((item) =>
    typeof item === "string" ? item.trim() : "",
  );
  if (translations.length !== expectedCount) {
    throw new Error("OpenAI translation count mismatch");
  }

  return translations;
};

export const translateLyricsWithOpenAI = async (
  lines: string[],
  options: TranslateWithOpenAIOptions = {},
) => {
  const apiKey = options.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const nonEmptyLines = lines.map((line) => line.trim());
  if (!nonEmptyLines.some(Boolean)) return lines.map(() => "");

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    getOpenAITranslationTimeoutMs(),
  );

  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(openAIResponsesEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: getOpenAITranslationModel(options.model),
        reasoning: { effort: "low" },
        instructions:
          "You translate song lyrics into natural Korean for music-video and album review support. Preserve line order and meaning, keep names/titles as-is when appropriate, avoid adding commentary, and return only JSON that matches the schema.",
        input: JSON.stringify({
          source_language: options.source ?? "auto",
          target_language: options.target ?? "ko",
          lines: nonEmptyLines.map((text, index) => ({ index, text })),
        }),
        text: {
          format: {
            type: "json_schema",
            name: "lyrics_translation_batch",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["translations"],
              properties: {
                translations: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
          },
        },
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        `OpenAI translation request failed (${response.status})`,
      );
    }

    return parseOpenAITranslations(payload, lines.length);
  } finally {
    clearTimeout(timeoutId);
  }
};
