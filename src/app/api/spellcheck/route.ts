import { NextResponse } from "next/server";

import {
  applyReplacementRules,
  buildCustomRules,
  MAX_TEXT_LENGTH,
  runLocalRuleEngine,
  type LocalRuleSuggestion,
  type SpellcheckRule,
} from "@/lib/spellcheck";
import { KO_SPELLCHECK_RULES } from "@/lib/spellcheck-rules";
import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_TIMEOUT_MS = 12_000;
const CUSTOM_RULE_CACHE_MS = 1000 * 60 * 5;

type SpellcheckPayload = {
  text?: unknown;
};

type SpellcheckSuggestion = {
  start?: number;
  end?: number;
  before?: string;
  after?: string;
  reason?: string;
};

type SpellcheckChange = {
  from?: string;
  to?: string;
  index?: number;
};

type SpellcheckServiceResponse = {
  ok?: boolean;
  original?: string;
  corrected?: string;
  diffCount?: number;
  chunks?: number;
  warnings?: string[];
  suggestions?: SpellcheckSuggestion[];
  changes?: SpellcheckChange[];
  receivedLength?: number;
  meta?: { truncated?: boolean; source?: "service" | "local" };
  error?: { message?: string };
};

const baseLocalRules: SpellcheckRule[] = KO_SPELLCHECK_RULES.map((rule) => ({
  pattern: rule.pattern,
  replace: rule.replace,
  reason: rule.reason,
}));

let cachedCustomRules: { rules: SpellcheckRule[]; expiresAt: number } | null = null;

const normalizeNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

const normalizeSuggestions = (items: LocalRuleSuggestion[], textLength: number): Required<SpellcheckSuggestion>[] => {
  const seen = new Map<string, Required<SpellcheckSuggestion>>();
  items.forEach((item) => {
    const start = normalizeNumber(item.start);
    const end = normalizeNumber(item.end);
    const before = typeof item.before === "string" ? item.before : "";
    const after = typeof item.after === "string" ? item.after : "";
    if (start === null || end === null) return;
    const safeStart = Math.max(0, Math.min(textLength, start));
    const safeEnd = Math.max(safeStart, Math.min(textLength, end));
    if (!before || !after) return;
    const key = `${safeStart}:${safeEnd}:${after}`;
    if (!seen.has(key)) {
      seen.set(
        key,
        Object.freeze({
          start: safeStart,
          end: safeEnd,
          before,
          after,
          reason: item.reason ?? "local_rule",
        }),
      );
    }
  });
  return Array.from(seen.values()).sort((a, b) => a.start - b.start || a.end - b.end);
};

const fetchCustomRules = async () => {
  const now = Date.now();
  if (cachedCustomRules && cachedCustomRules.expiresAt > now) {
    return cachedCustomRules.rules;
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("spellcheck_terms")
      .select("from_text, to_text, language")
      .eq("is_active", true);
    if (error) {
      throw error;
    }
    const rules = buildCustomRules(data ?? []);
    cachedCustomRules = { rules, expiresAt: now + CUSTOM_RULE_CACHE_MS };
    return rules;
  } catch (error) {
    console.error("[spellcheck][custom_rules][error]", error);
    cachedCustomRules = { rules: [], expiresAt: now + 60_000 };
    return [];
  }
};

const buildLocalResponse = async (text: string, warnings: string[], truncated: boolean) => {
  const rules = [...(await fetchCustomRules()), ...baseLocalRules];
  const { corrected, changes } = applyReplacementRules(text, rules);
  const { suggestions: rawSuggestions } = runLocalRuleEngine(text, rules);
  const suggestions = normalizeSuggestions(rawSuggestions, text.length);
  const warningsWithLocal = [...warnings, "local_rules"];
  if (truncated) {
    warningsWithLocal.push("text_truncated");
  }

  return {
    ok: true,
    original: text,
    corrected,
    diffCount: changes.length,
    chunks: 1,
    warnings: warningsWithLocal,
    suggestions,
    changes: changes.map((change) => ({
      from: change.from,
      to: change.to,
      index: change.index,
    })),
    receivedLength: text.length,
    meta: { source: "local", truncated },
  };
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

  const serviceUrl = process.env.SPELLCHECK_SERVICE_URL;
  if (!serviceUrl) {
    const localPayload = await buildLocalResponse(workingText, ["service_unconfigured"], truncated);
    return NextResponse.json(localPayload, { status: 200 });
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
      body: JSON.stringify({ text: workingText }),
      signal: controller.signal,
    });

    const servicePayload: SpellcheckServiceResponse | null = await response.json().catch(() => null);
    const canUseService = response.ok && servicePayload && servicePayload.ok !== false;

    if (canUseService && servicePayload) {
      const baseWarnings = Array.isArray(servicePayload.warnings) ? servicePayload.warnings : [];
      const warnings = truncated ? [...baseWarnings, "text_truncated"] : baseWarnings;
      const suggestions = Array.isArray(servicePayload.suggestions) ? servicePayload.suggestions : [];
      return NextResponse.json(
        {
          ok: servicePayload.ok ?? true,
          original: servicePayload.original ?? workingText,
          corrected: servicePayload.corrected ?? workingText,
          diffCount: servicePayload.diffCount ?? suggestions.length,
          chunks: servicePayload.chunks ?? 1,
          warnings,
          suggestions,
          changes: Array.isArray(servicePayload.changes) ? servicePayload.changes : undefined,
          receivedLength: workingText.length,
          meta: { ...(servicePayload.meta ?? {}), source: "service", truncated },
        },
        { status: 200 },
      );
    }

    const localPayload = await buildLocalResponse(workingText, ["proxy_error"], truncated);
    return NextResponse.json(localPayload, { status: 200 });
  } catch (error: any) {
    const isAbort = error?.name === "AbortError";
    const warning = isAbort ? "proxy_timeout" : "proxy_error";
    const localPayload = await buildLocalResponse(workingText, [warning], truncated);
    return NextResponse.json(localPayload, { status: 200 });
  } finally {
    clearTimeout(timeout);
  }
}
