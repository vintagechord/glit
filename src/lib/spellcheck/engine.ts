import { createAdminClient } from "@/lib/supabase/admin";
import { buildCustomRules, MAX_TEXT_LENGTH, type SpellcheckRule } from "@/lib/spellcheck";
import { buildProtectedTermPatterns, dictionaryRules } from "./lexicon";
import {
  createCoreRuleProvider,
  createExternalProvider,
  createForeignProvider,
  createHybridProvider,
  createMorphologyProvider,
  createNormalizationProvider,
  createStyleProvider,
  createRuleProvider,
  type ProviderResult,
  type ProviderSuggestion,
  type SpellcheckProvider,
  type ProviderContext,
} from "./providers";
import { normalizeText } from "./normalize";
import { diffText } from "./diff";
import type {
  SpellcheckDomain,
  SpellcheckMode,
  SpellcheckResponse,
  SpellcheckSuggestion,
  SpellcheckDiff,
  SuggestionType,
} from "./types";

type PipelineInput = {
  text: string;
  mode?: SpellcheckMode;
  domain?: SpellcheckDomain;
  traceId?: string;
};

type ProviderState = {
  failures: number;
  openUntil: number;
};

type ProtectedSpan = { start: number; end: number; reason: string };

const MODE_THRESHOLD: Record<SpellcheckMode, number> = {
  strict: 0.45,
  balanced: 0.6,
  fast: 0.75,
};

const PROVIDER_TIMEOUT_MS = 2500;
const CACHE_TTL_MS = 1000 * 60 * 5;
const CIRCUIT_FAIL_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 30_000;
const MAX_SUGGESTIONS = 600;

const cache = new Map<string, { value: SpellcheckResponse; expiresAt: number }>();
const inflight = new Map<string, Promise<SpellcheckResponse>>();
const providerState = new Map<string, ProviderState>();

let cachedCustomRules: { rules: SpellcheckRule[]; expiresAt: number } | null = null;

const getTraceId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
};

const hashText = (value: string) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
};

const resolveMode = (mode?: SpellcheckMode): SpellcheckMode =>
  mode === "strict" || mode === "fast" ? mode : "balanced";

const resolveDomain = (domain?: SpellcheckDomain): SpellcheckDomain =>
  domain === "music" ? "music" : "general";

const buildProtectedSpans = (text: string, domain: SpellcheckDomain): ProtectedSpan[] => {
  const spans: ProtectedSpan[] = [];
  const addMatch = (match: RegExpExecArray, reason: string) => {
    if (!match[0]) return;
    spans.push({ start: match.index, end: match.index + match[0].length, reason });
  };

  const english = /[A-Za-z][A-Za-z0-9'_.-]*/g;
  let m: RegExpExecArray | null;
  while ((m = english.exec(text))) addMatch(m, "english");

  const acronyms = /\b[A-Z0-9]{2,}\b/g;
  while ((m = acronyms.exec(text))) addMatch(m, "acronym");

  const hashTags = /[#@][A-Za-z0-9_]+/g;
  while ((m = hashTags.exec(text))) addMatch(m, "tag");

  const protectedTerms = buildProtectedTermPatterns();
  protectedTerms.forEach(({ pattern }) => {
    let termMatch: RegExpExecArray | null;
    while ((termMatch = pattern.exec(text))) addMatch(termMatch, "protected_term");
  });

  if (domain === "music") {
    const terms = [
      "EP",
      "LP",
      "MV",
      "OST",
      "Dolby Atmos",
      "Dolby",
      "Atmos",
      "Hi-Res",
      "Remaster",
      "Remastered",
      "BPM",
      "Hz",
      "kHz",
      "FLAC",
      "WAV",
      "MP3",
      "AAC",
      "AIFF",
      "MIDI",
    ];
    terms.forEach((term) => {
      const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      let termMatch: RegExpExecArray | null;
      while ((termMatch = pattern.exec(text))) addMatch(termMatch, "domain_term");
    });
  }

  return spans;
};

const splitSentences = (text: string) => {
  const sentences: Array<{ start: number; end: number; text: string }> = [];
  let start = 0;
  const pushSentence = (end: number) => {
    if (end <= start) return;
    const slice = text.slice(start, end).trim();
    if (slice) {
      sentences.push({ start, end, text: slice });
    }
    start = end;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\n") {
      pushSentence(i + 1);
      continue;
    }
    if (ch === "." || ch === "?" || ch === "!" || ch === "…") {
      const next = text[i + 1];
      if (!next || next === " " || next === "\n") {
        pushSentence(i + 1);
      }
    }
  }
  if (start < text.length) {
    pushSentence(text.length);
  }
  return sentences;
};

const overlaps = (a: ProtectedSpan, start: number, end: number) =>
  start < a.end && end > a.start;

const shouldSkipForProtected = (suggestion: ProviderSuggestion, spans: ProtectedSpan[]) => {
  if (!spans.length) return false;
  const overlap = spans.some((span) => overlaps(span, suggestion.start, suggestion.end));
  if (!overlap) return false;
  if (suggestion.type === "spacing" || suggestion.type === "punctuation") {
    return false;
  }
  return true;
};

const mapCustomRules = (rules: SpellcheckRule[]) =>
  rules.map((rule) => ({
    pattern: rule.pattern,
    replace: rule.replace,
    reason: rule.reason ?? "custom_rule",
    confidence: 0.96,
    type: "custom" as SuggestionType,
  }));

const fetchCustomRules = async () => {
  const now = Date.now();
  if (cachedCustomRules && cachedCustomRules.expiresAt > now) {
    return cachedCustomRules.rules;
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    cachedCustomRules = { rules: [], expiresAt: now + 60_000 };
    return [];
  }
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("spellcheck_terms")
      .select("from_text, to_text, language")
      .eq("is_active", true);
    if (error) throw error;
    const rules = buildCustomRules(data ?? []);
    cachedCustomRules = { rules, expiresAt: now + 5 * 60_000 };
    return rules;
  } catch (error) {
    console.error("[spellcheck][custom_rules][error]", error);
    cachedCustomRules = { rules: [], expiresAt: now + 60_000 };
    return [];
  }
};

const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => T,
): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(onTimeout()), ms);
    });
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const applySuggestions = (
  text: string,
  suggestions: SpellcheckSuggestion[],
): { corrected: string; applied: SpellcheckSuggestion[]; skipped: SpellcheckSuggestion[] } => {
  if (!suggestions.length) {
    return { corrected: text, applied: [], skipped: [] };
  }
  const sorted = [...suggestions].sort((a, b) => b.start - a.start);
  let output = text;
  const applied: SpellcheckSuggestion[] = [];
  const skipped: SpellcheckSuggestion[] = [];

  sorted.forEach((suggestion) => {
    const start = Math.max(0, suggestion.start);
    const end = Math.max(start, suggestion.end);
    const before = suggestion.original ?? "";
    const after = suggestion.replacement ?? "";
    if (!before && !after) {
      skipped.push(suggestion);
      return;
    }
    if (!before && after) {
      output = output.slice(0, start) + after + output.slice(start);
      applied.push({ ...suggestion, start, end: start });
      return;
    }
    const slice = output.slice(start, end);
    if (slice === before) {
      output = output.slice(0, start) + after + output.slice(end);
      applied.push({ ...suggestion, start, end });
      return;
    }
    const fallbackIndex = output.indexOf(before, Math.max(0, start - 12));
    if (fallbackIndex >= 0) {
      output =
        output.slice(0, fallbackIndex) +
        after +
        output.slice(fallbackIndex + before.length);
      applied.push({
        ...suggestion,
        start: fallbackIndex,
        end: fallbackIndex + before.length,
      });
      return;
    }
    skipped.push(suggestion);
  });

  applied.sort((a, b) => a.start - b.start);
  return { corrected: output, applied, skipped };
};

const toFinalSuggestion = (
  suggestion: ProviderSuggestion,
  index: number,
): SpellcheckSuggestion => ({
  id: suggestion.source + "-" + index,
  start: suggestion.start,
  end: suggestion.end,
  original: suggestion.before,
  replacement: suggestion.after,
  type: suggestion.type ?? "orthography",
  confidence: suggestion.confidence,
  message: suggestion.reason,
  source: suggestion.source,
});

const dedupeAndResolve = (
  suggestions: ProviderSuggestion[],
  priorityMap: Map<string, number>,
): ProviderSuggestion[] => {
  const bestByKey = new Map<string, ProviderSuggestion>();
  suggestions.forEach((s) => {
    const key = `${s.start}:${s.end}:${s.after}`;
    const current = bestByKey.get(key);
    if (!current || s.confidence > current.confidence) {
      bestByKey.set(key, s);
    }
  });

  const unique = Array.from(bestByKey.values());
  unique.sort((a, b) => {
    const pa = priorityMap.get(a.source) ?? 50;
    const pb = priorityMap.get(b.source) ?? 50;
    if (pa !== pb) return pa - pb;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return (b.end - b.start) - (a.end - a.start);
  });

  const accepted: ProviderSuggestion[] = [];
  const overlapsRange = (a: ProviderSuggestion, b: ProviderSuggestion) =>
    a.start < b.end && b.start < a.end;

  unique.forEach((candidate) => {
    const existingIndex = accepted.findIndex((s) => overlapsRange(s, candidate));
    if (existingIndex < 0) {
      accepted.push(candidate);
      return;
    }
    const existing = accepted[existingIndex];
    const candPriority = priorityMap.get(candidate.source) ?? 50;
    const existingPriority = priorityMap.get(existing.source) ?? 50;
    if (candPriority < existingPriority && candidate.confidence >= existing.confidence - 0.1) {
      accepted.splice(existingIndex, 1, candidate);
      return;
    }
    if (candidate.confidence > existing.confidence + 0.15) {
      accepted.splice(existingIndex, 1, candidate);
    }
  });

  return accepted.sort((a, b) => a.start - b.start).slice(0, MAX_SUGGESTIONS);
};

const buildProviders = async () => {
  const customRules = mapCustomRules(await fetchCustomRules());
  const providers: SpellcheckProvider[] = [
    createNormalizationProvider(),
    createRuleProvider("dictionary_rules", dictionaryRules),
    createRuleProvider("custom_rules", customRules),
    createCoreRuleProvider(),
    createHybridProvider(),
    createForeignProvider(),
    createStyleProvider(),
    createMorphologyProvider(),
  ];

  const serviceUrl = process.env.SPELLCHECK_SERVICE_URL;
  if (serviceUrl) {
    const endpoint = serviceUrl.endsWith("/spellcheck")
      ? serviceUrl
      : serviceUrl.endsWith("/")
        ? `${serviceUrl}spellcheck`
        : `${serviceUrl}/spellcheck`;
    providers.unshift(createExternalProvider(endpoint, process.env.SPELLCHECK_SHARED_SECRET));
  }

  return providers;
};

const runProvider = async (
  provider: SpellcheckProvider,
  text: string,
  context: ProviderContext,
  traceId: string,
) => {
  const state = providerState.get(provider.name);
  if (state && state.openUntil > Date.now()) {
    return {
      ok: false,
      ms: 0,
      warnings: ["circuit_open"],
      result: { suggestions: [], confidence: 0, warnings: ["circuit_open"] } satisfies ProviderResult,
    };
  }

  const start = Date.now();
  const controller = new AbortController();
  const signal = context.signal ?? controller.signal;
  const result = await withTimeout(
    provider.check(text, { ...context, signal }),
    PROVIDER_TIMEOUT_MS,
    () => ({ suggestions: [], confidence: 0, warnings: ["timeout"] }),
  );
  const ms = Date.now() - start;
  const warnings = result?.warnings ?? [];
  const ok =
    !warnings.includes("timeout") &&
    !warnings.includes("service_error") &&
    !warnings.includes("circuit_open");

  if (!ok) {
    const next = {
      failures: (state?.failures ?? 0) + 1,
      openUntil:
        (state?.failures ?? 0) + 1 >= CIRCUIT_FAIL_THRESHOLD
          ? Date.now() + CIRCUIT_OPEN_MS
          : state?.openUntil ?? 0,
    };
    providerState.set(provider.name, next);
  } else {
    providerState.set(provider.name, { failures: 0, openUntil: 0 });
  }

  return {
    ok,
    ms,
    warnings,
    result,
  };
};

export const runSpellcheckPipeline = async (
  input: PipelineInput,
): Promise<SpellcheckResponse> => {
  const mode = resolveMode(input.mode);
  const domain = resolveDomain(input.domain);
  const traceId = input.traceId ?? getTraceId();

  const rawText = input.text ?? "";
  const truncated = rawText.length > MAX_TEXT_LENGTH;
  const workingText = truncated ? rawText.slice(0, MAX_TEXT_LENGTH) : rawText;

  const cacheKey = `${hashText(workingText)}:${mode}:${domain}:${workingText.length}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  if (inflight.has(cacheKey)) {
    return inflight.get(cacheKey)!;
  }

  const promise = (async () => {
    const normalizeStats = normalizeText(workingText);
    const protectedSpans = buildProtectedSpans(workingText, domain);
    const threshold = MODE_THRESHOLD[mode];

    console.info("[spellcheck][start]", {
      traceId,
      length: workingText.length,
      normalizedLength: normalizeStats.normalized.length,
      mode,
      domain,
      truncated,
    });
    console.info("[spellcheck][normalize]", {
      traceId,
      removedZeroWidth: normalizeStats.removedZeroWidth,
      replacedQuotes: normalizeStats.replacedQuotes,
      replacedDashes: normalizeStats.replacedDashes,
      replacedEllipsis: normalizeStats.replacedEllipsis,
      collapsedSpaces: normalizeStats.collapsedSpaces,
    });

    const sentences = splitSentences(workingText);
    console.info("[spellcheck][sentences]", {
      traceId,
      count: sentences.length,
      sample: sentences.slice(0, 3).map((s) => s.text.slice(0, 80)),
    });

    const providers = await buildProviders();
    const priorityMap = new Map<string, number>();
    providers.forEach((provider, index) => priorityMap.set(provider.name, index));

    const providerRuns = await Promise.all(
      providers.map((provider) =>
        runProvider(provider, workingText, { mode, domain }, traceId),
      ),
    );

    const providerMeta = providerRuns.map((run, index) => ({
      name: providers[index].name,
      ok: run.ok,
      ms: run.ms,
      warnings: run.warnings?.length ? run.warnings : undefined,
    }));
    console.info("[spellcheck][providers]", { traceId, providers: providerMeta });

    let suggestions: ProviderSuggestion[] = [];
    providerRuns.forEach((run, index) => {
      const providerName = providers[index].name;
      const result = run.result;
      if (!result) return;
      suggestions = suggestions.concat(
        (result.suggestions ?? []).map((s) => ({ ...s, source: providerName })),
      );
    });

    const stats = {
      total: suggestions.length,
      filteredProtected: 0,
      filteredThreshold: 0,
      filteredInvalid: 0,
    };

    suggestions = suggestions.filter((s) => {
      if (!Number.isFinite(s.start) || !Number.isFinite(s.end) || s.end < s.start) {
        stats.filteredInvalid += 1;
        return false;
      }
      if (!s.before && !s.after) {
        stats.filteredInvalid += 1;
        return false;
      }
      if (s.confidence < threshold) {
        stats.filteredThreshold += 1;
        return false;
      }
      if (shouldSkipForProtected(s, protectedSpans)) {
        stats.filteredProtected += 1;
        return false;
      }
      return true;
    });

    const resolved = dedupeAndResolve(suggestions, priorityMap);
    const finalSuggestions = resolved.map(toFinalSuggestion);
    const { corrected, skipped } = applySuggestions(workingText, finalSuggestions);

    let reasonIfEmpty: string | undefined;
    if (finalSuggestions.length === 0) {
      if (providerMeta.every((p) => !p.ok)) {
        reasonIfEmpty = "all_providers_failed";
      } else if (stats.filteredThreshold > 0) {
        reasonIfEmpty = "filtered_by_confidence";
      } else if (stats.filteredProtected > 0) {
        reasonIfEmpty = "filtered_by_protected_terms";
      } else if (stats.total === 0) {
        reasonIfEmpty = "no_matches";
      } else {
        reasonIfEmpty = "filtered_or_invalid";
      }
    }

    if (finalSuggestions.length === 0 || skipped.length > 0) {
      console.info("[spellcheck][empty_or_skipped]", {
        traceId,
        total: stats.total,
        filteredThreshold: stats.filteredThreshold,
        filteredProtected: stats.filteredProtected,
        filteredInvalid: stats.filteredInvalid,
        skipped: skipped.length,
        reasonIfEmpty,
      });
    }

    const diffs: SpellcheckDiff[] = diffText(workingText, corrected);

    const response: SpellcheckResponse = {
      originalText: workingText,
      normalizedText: normalizeStats.normalized,
      correctedText: corrected,
      suggestions: finalSuggestions,
      diffs,
      meta: {
        mode,
        providers: providerMeta,
        reasonIfEmpty,
        traceId,
        truncated,
      },
    };

    cache.set(cacheKey, { value: response, expiresAt: Date.now() + CACHE_TTL_MS });
    return response;
  })();

  inflight.set(cacheKey, promise);
  try {
    const result = await promise;
    return result;
  } finally {
    inflight.delete(cacheKey);
  }
};
