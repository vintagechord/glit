import { NextResponse } from "next/server";

import { runSpellcheckPipeline } from "@/lib/spellcheck/engine";
import type { SpellcheckDomain, SpellcheckMode } from "@/lib/spellcheck/types";

const modes = new Set<SpellcheckMode>(["strict", "balanced", "fast"]);
const domains = new Set<SpellcheckDomain>(["general", "music"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
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
