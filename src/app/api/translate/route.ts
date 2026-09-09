import { NextResponse } from "next/server";

import { translateLyricsBatch } from "@/lib/server-lyrics-translation";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";

type TranslateRequest = {
  lines?: string[];
  source?: string;
  target?: string;
};

export const runtime = "nodejs";

const maxTranslateLines = 120;
const maxTranslateLineLength = 5000;
const maxTranslateTotalLength = 60_000;

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
      return NextResponse.json(
        { error: "Translation requests are temporarily limited. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(requestLimit.retryAfterSeconds) },
        },
      );
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
    if (
      (body.lines !== undefined && !Array.isArray(body.lines)) ||
      (body.lines?.length ?? 0) > maxTranslateLines ||
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
          .slice(0, maxTranslateLines)
          .map((line) => String(line ?? "").slice(0, maxTranslateLineLength))
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

    const translations = await translateLyricsBatch(lines, { source, target });
    const requestedCount = lines.filter((line) => line.trim()).length;
    const translatedCount = translations.filter((line) => line.trim()).length;

    if (translatedCount < requestedCount) {
      return NextResponse.json(
        { error: "Translation provider did not translate every requested segment", translations },
        { status: 502 },
      );
    }

    return NextResponse.json({ translations });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Translation failed" },
      { status: 500 },
    );
  }
}
