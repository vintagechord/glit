export type SpellcheckProxyResult = {
  ok: boolean;
  original: string;
  corrected: string;
  warnings: string[];
};

type Options = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export const spellcheckText = async (text: string, options: Options = {}): Promise<SpellcheckProxyResult> => {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const controller = options.signal ? null : new AbortController();
  const signal = options.signal ?? controller?.signal;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch("/api/spellcheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    const payload = await response.json().catch(() => null);
    const corrected = typeof payload?.corrected === "string" ? payload.corrected : text;
    const original = typeof payload?.original === "string" ? payload.original : text;
    const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
    return {
      ok: payload?.ok === true && response.ok,
      original,
      corrected,
      warnings,
    };
  } catch {
    return {
      ok: false,
      original: text,
      corrected: text,
      warnings: ["client_error"],
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
};
