import { NextResponse } from "next/server";

import { translateLyricsBatch } from "@/lib/server-lyrics-translation";
import { isUsableLyricsTranslation, LYRICS_TRANSLATION_LIMITS, lyricsTranslationModelBatches } from "@/lib/lyrics-translation-validation";
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
// and the desk translates review-document lyrics through this route too. One
// request can make many paid model calls (batches of up to 20 lines or 4,000
// characters, each resending the song context), so every shared limit below is
// counted in those calls, across instances: per network address, and one daily
// budget for the site.
const DAY_MS = 24 * 60 * 60 * 1_000;
const IP_WINDOW_LIMIT = { limit: 30, windowMs: 10 * 60 * 1_000 };
const IP_DAILY_LIMIT = { limit: 60, windowMs: DAY_MS };
// The AI Gateway key has its own monthly spending limit ($5 when it was made on
// 2026-11-20), which also pays for review documents translated on the server;
// those never pass this route. At about $0.01 a call (gpt-5-mini with a full
// batch and the 12,000-character context), 10 calls a day keep this route near
// $3 a month and leave the rest of the key for review documents. Raise
// TRANSLATE_DAILY_BATCH_BUDGET together with the key's limit.
const DEFAULT_DAILY_BATCH_BUDGET = 10;
const dailyBatchBudget = () => {
  const configured = Number(process.env.TRANSLATE_DAILY_BATCH_BUDGET);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_DAILY_BATCH_BUDGET;
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

    // Charged in the model calls this request makes, and only when it makes
    // any. A limiter outage denies: an unlimited route would spend the
    // provider budget.
    const cost = lyricsTranslationModelBatches(lines, target).length;
    if (cost > 0) {
      const identifier = getRequestIdentifier(request.headers);
      for (const window of [IP_WINDOW_LIMIT, IP_DAILY_LIMIT]) {
        const byAddress = await consumePersistentRateLimit({ namespace: `translate-ip-${window.windowMs}`, identifier, ...window, cost });
        if (!byAddress.allowed) {
          return limitedResponse("자동번역 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", byAddress.retryAfterSeconds);
        }
      }
      const budget = await consumePersistentRateLimit({
        namespace: "translate-daily-budget", identifier: "site",
        limit: dailyBatchBudget(), windowMs: DAY_MS, cost,
      });
      if (!budget.allowed) {
        // 503 lets the wizard fall back to its free in-browser translation.
        return limitedResponse("오늘 자동번역 사용량이 한도에 도달했습니다. 잠시 후 다시 시도하거나 번역을 직접 입력해주세요.", budget.retryAfterSeconds, 503);
      }
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
