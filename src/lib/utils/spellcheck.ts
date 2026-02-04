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
    const corrected =
      typeof payload?.correctedText === "string"
        ? payload.correctedText
        : typeof payload?.corrected === "string"
          ? payload.corrected
          : text;
    const original =
      typeof payload?.originalText === "string"
        ? payload.originalText
        : typeof payload?.original === "string"
          ? payload.original
          : text;
    const providers = Array.isArray(payload?.meta?.providers)
      ? (payload.meta.providers as unknown[])
      : [];
    const warnings = providers.length
      ? providers.flatMap((provider) => {
          if (typeof provider !== "object" || provider === null) return [];
          const record = provider as Record<string, unknown>;
          const warningsValue = record.warnings;
          return Array.isArray(warningsValue) ? warningsValue : [];
        })
      : Array.isArray(payload?.warnings)
        ? payload.warnings
        : [];
    return {
      ok: response.ok,
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
