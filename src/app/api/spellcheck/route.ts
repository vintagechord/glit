import { NextResponse } from "next/server";

const MAX_TEXT_LENGTH = 20000;
const DEFAULT_TIMEOUT_MS = 12_000;

type SpellcheckPayload = {
  text?: unknown;
};

type SpellcheckServiceResponse = {
  ok?: boolean;
  original?: string;
  corrected?: string;
  diffCount?: number;
  chunks?: number;
  warnings?: string[];
  suggestions?: Array<{
    start?: number;
    end?: number;
    before?: string;
    after?: string;
    reason?: string;
  }>;
};

const buildFallback = (text: string, warnings: string[], status = 502) =>
  NextResponse.json(
    {
      ok: false,
      original: text,
      corrected: text,
      diffCount: 0,
      chunks: 1,
      warnings,
      suggestions: [],
      error: { message: warnings[0] ?? "proxy_error" },
    },
    { status },
  );

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

  if (text.length > MAX_TEXT_LENGTH) {
    return buildFallback(text.slice(0, MAX_TEXT_LENGTH), ["payload_too_large"], 413);
  }

  const serviceUrl = process.env.SPELLCHECK_SERVICE_URL;
  if (!serviceUrl) {
    return buildFallback(text, ["service_unconfigured"], 500);
  }

  const endpoint = serviceUrl.endsWith("/spellcheck")
    ? serviceUrl
    : serviceUrl.endsWith("/")
      ? `${serviceUrl}spellcheck`
      : `${serviceUrl}/spellcheck`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const sharedSecret = process.env.SPELLCHECK_SHARED_SECRET;
    if (sharedSecret) {
      headers["x-spellcheck-secret"] = sharedSecret;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    const servicePayload: SpellcheckServiceResponse | null = await response.json().catch(() => null);

    if (!response.ok || !servicePayload) {
      return buildFallback(text, ["proxy_error"], response.status || 502);
    }

    return NextResponse.json(servicePayload, { status: 200 });
  } catch (error: any) {
    const isAbort = error?.name === "AbortError";
    return buildFallback(text, [isAbort ? "proxy_timeout" : "proxy_error"], isAbort ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
}
