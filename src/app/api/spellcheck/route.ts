import { NextResponse } from "next/server";

import { MAX_TEXT_LENGTH } from "@/lib/spellcheck";
import { runSpellcheckPipeline } from "@/lib/spellcheck/engine";
import type { SpellcheckDomain, SpellcheckMode } from "@/lib/spellcheck/types";

type SpellcheckPayload = {
  text?: unknown;
  mode?: SpellcheckMode;
  domain?: SpellcheckDomain;
};

export async function POST(req: Request) {
  let payload: SpellcheckPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const text = typeof payload?.text === "string" ? payload.text : "";
  if (!text.trim()) {
    return NextResponse.json({ error: "TEXT_REQUIRED" }, { status: 400 });
  }

  const truncated = text.length > MAX_TEXT_LENGTH;
  const workingText = truncated ? text.slice(0, MAX_TEXT_LENGTH) : text;

  const response = await runSpellcheckPipeline({
    text: workingText,
    mode: payload?.mode,
    domain: payload?.domain,
  });

  return NextResponse.json(response, { status: 200 });
}
