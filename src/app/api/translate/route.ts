import { NextResponse } from "next/server";

import { translateLyricsBatch } from "@/lib/server-lyrics-translation";
import { isUsableLyricsTranslation, LYRICS_TRANSLATION_LIMITS } from "@/lib/lyrics-translation-validation";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumePersistentRateLimit,
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";

type TranslateRequest = {
  lines?: string[];
  source?: string;
  target?: string;
  context?: string;
};

export const runtime = "nodejs";
export const maxDuration = 60;

const maxTranslateLines = LYRICS_TRANSLATION_LIMITS.apiSegments;
const maxTranslateLineLength = LYRICS_TRANSLATION_LIMITS.apiLine;
const maxTranslateTotalLength = LYRICS_TRANSLATION_LIMITS.total;

// The album and MV wizards translate one track per click (guests included),
// usually in one or two requests. Each request may fan out to up to 15
// OpenAI batches, so the shared limits below bound the provider bill even
// across instances: per network address, and one daily budget for the site
// counted in provider batches.
const IP_WINDOW_LIMIT = { limit: 30, windowMs: 10 * 60 * 1_000 };
const IP_DAILY_LIMIT = { limit: 150, windowMs: 24 * 60 * 60 * 1_000 };
const TRANSLATE_DAILY_BATCH_BUDGET = 3_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

/** Upper bound of OpenAI calls for one request (see translateLyricsBatch). */
const estimateProviderBatches = (lines: string[]) => {
  const characters = lines.reduce((total, line) => total + line.length, 0);
  return Math.min(15, Math.max(1,
    Math.ceil(lines.length / LYRICS_TRANSLATION_LIMITS.batch),
    Math.ceil(characters / LYRICS_TRANSLATION_LIMITS.batchCharacters),
  ));
};

const limitedResponse = (error: string, retryAfterSeconds: number, status = 429) =>
  NextResponse.json({ error }, { status, headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) } });

const normalizeLanguageCode = (value: string, fallback: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "auto") return "auto";
  return /^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/.test(normalized)
    ? normalized
    : fallback;
};

export async function POST(request: Request) {
  try {
    const requestLimit = consumeRateLimit({
      namespace: "translate",
      identifier: getRequestIdentifier(request.headers),
      limit: 20,
      windowMs: 10 * 60 * 1_000,
    });
    if (!requestLimit.allowed) {
      return limitedResponse("자동번역 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", requestLimit.retryAfterSeconds);
    }
    const bodyResult = await readBoundedJsonBody(request, 256 * 1024);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: "Translation request is invalid or too large" },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    const rawBody = bodyResult.value;
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json(
        { error: "Translation request is invalid" },
        { status: 400 },
      );
    }
    const body = rawBody as TranslateRequest;
    if ((body.lines !== undefined && (!Array.isArray(body.lines) || body.lines.some(line => typeof line !== "string"))) || (body.context !== undefined && typeof body.context !== "string")) {
      return NextResponse.json({ error: "Translation request is invalid" }, { status: 400 });
    }
    if (
      (body.lines !== undefined && !Array.isArray(body.lines)) ||
      (body.lines?.length ?? 0) > maxTranslateLines ||
      (body.context?.length ?? 0) > LYRICS_TRANSLATION_LIMITS.context ||
      (body.lines ?? []).some(
        (line) => typeof line === "string" && line.length > maxTranslateLineLength,
      ) ||
      (body.lines ?? []).reduce(
        (total, line) => total + String(line ?? "").length,
        0,
      ) > maxTranslateTotalLength
    ) {
      return NextResponse.json(
        { error: "Translation request is too large" },
        { status: 413 },
      );
    }
    const lines = Array.isArray(body.lines)
      ? body.lines
          .map((line) => line)
      : [];
    if (!lines.length) {
      return NextResponse.json({ translations: [] });
    }

    const source =
      typeof body.source === "string" && body.source.trim()
        ? normalizeLanguageCode(body.source, "auto")
        : "auto";
    const target =
      typeof body.target === "string" && body.target.trim()
        ? normalizeLanguageCode(body.target, "ko")
        : "ko";

    // Counted only for requests that reach the provider. A limiter outage
    // denies: an unlimited route would spend the provider budget.
    const identifier = getRequestIdentifier(request.headers);
    for (const window of [IP_WINDOW_LIMIT, IP_DAILY_LIMIT]) {
      const byAddress = await consumePersistentRateLimit({ namespace: `translate-ip-${window.windowMs}`, identifier, ...window });
      if (!byAddress.allowed) {
        return limitedResponse("자동번역 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", byAddress.retryAfterSeconds);
      }
    }
    const budget = await consumePersistentRateLimit({
      namespace: "translate-daily-budget", identifier: "site",
      limit: TRANSLATE_DAILY_BATCH_BUDGET, windowMs: DAY_MS, cost: estimateProviderBatches(lines),
    });
    if (!budget.allowed) {
      // 503 lets the wizard fall back to its free in-browser translation.
      return limitedResponse("오늘 자동번역 사용량이 한도에 도달했습니다. 잠시 후 다시 시도하거나 번역을 직접 입력해주세요.", budget.retryAfterSeconds, 503);
    }

    const deadline = AbortSignal.timeout(50_000);
    const signal = AbortSignal.any([request.signal, deadline]);
    const result = await translateLyricsBatch(lines, { source, target, context: body.context, signal });
    const translations = lines.map((line, index) => result.length === lines.length && typeof result[index] === "string" && (!line.trim() || isUsableLyricsTranslation(result[index], line, target)) ? result[index] : "");
    const failedIndexes = lines.flatMap((line, index) => line.trim() && !translations[index].trim() ? [index] : []);

    if (result.length !== lines.length || failedIndexes.length || signal.aborted) {
      return NextResponse.json(
        { error: "Translation provider did not translate every requested segment", translations, failedIndexes },
        { status: signal.aborted ? 504 : 502 },
      );
    }

    return NextResponse.json({ translations });
  } catch (error) {
    console.error("[translate] request failed", { category: error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? error.name : "unknown" });
    return NextResponse.json(
      { error: "Translation failed" },
      { status: 500 },
    );
  }
}
