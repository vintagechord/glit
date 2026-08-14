import { NextResponse } from "next/server";

import { runSpellcheckPipeline } from "@/lib/spellcheck/engine";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import type { SpellcheckDomain, SpellcheckMode } from "@/lib/spellcheck/types";

const modes = new Set<SpellcheckMode>(["strict", "balanced", "fast"]);
const domains = new Set<SpellcheckDomain>(["general", "music"]);

export async function POST(request: Request) {
  try {
    const requestLimit = consumeRateLimit({
      namespace: "spellcheck",
      identifier: getRequestIdentifier(request.headers),
      limit: 50,
      windowMs: 10 * 60 * 1_000,
    });
    if (!requestLimit.allowed) {
      return NextResponse.json(
        { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
        {
          status: 429,
          headers: { "Retry-After": String(requestLimit.retryAfterSeconds) },
        },
      );
    }
    const bodyResult = await readBoundedJsonBody(request, 256 * 1024);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: "맞춤법 검사 요청이 너무 크거나 올바르지 않습니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    const body = bodyResult.value as {
      text?: unknown;
      mode?: unknown;
      domain?: unknown;
    } | null;

    const text = typeof body?.text === "string" ? body.text : "";
    if (!text.trim()) {
      return NextResponse.json(
        { error: "맞춤법을 검사할 가사를 입력해주세요." },
        { status: 400 },
      );
    }

    const mode =
      typeof body?.mode === "string" && modes.has(body.mode as SpellcheckMode)
        ? (body.mode as SpellcheckMode)
        : "balanced";
    const domain =
      typeof body?.domain === "string" &&
      domains.has(body.domain as SpellcheckDomain)
        ? (body.domain as SpellcheckDomain)
        : "music";

    const result = await runSpellcheckPipeline({ text, mode, domain });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[spellcheck][route][error]", error);
    return NextResponse.json(
      { error: "맞춤법 검사 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
