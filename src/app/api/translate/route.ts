import { NextResponse } from "next/server";

type TranslateRequest = {
  lines?: string[];
  source?: string;
  target?: string;
};

export const runtime = "nodejs";

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const translateLineOnce = async (
  text: string,
  source: string,
  target: string,
) => {
  if (!text.trim()) return "";
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", source);
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Translation request failed");
  }

  const data = (await response.json()) as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[0])) return "";
  return data[0]
    .map((chunk: unknown) =>
      Array.isArray(chunk) && typeof chunk[0] === "string" ? chunk[0] : "",
    )
    .join("");
};

const translateLine = async (
  text: string,
  source: string,
  target: string,
) => {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await translateLineOnce(text, source, target);
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts;
      console.error(
        "[translate] failed attempt",
        attempt,
        "length",
        text.length,
        error,
      );
      if (isLastAttempt) {
        return "";
      }
      await sleep(200 * attempt);
    }
  }
  return "";
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TranslateRequest;
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) {
      return NextResponse.json({ translations: [] });
    }

    const source = typeof body.source === "string" ? body.source : "en";
    const target = typeof body.target === "string" ? body.target : "ko";

    const translations: string[] = [];

    for (const line of lines) {
      const translation = await translateLine(line, source, target);
      translations.push(translation);
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
