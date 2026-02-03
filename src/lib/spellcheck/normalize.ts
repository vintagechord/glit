export type NormalizeResult = {
  normalized: string;
  removedZeroWidth: number;
  replacedQuotes: number;
  replacedDashes: number;
  replacedEllipsis: number;
  collapsedSpaces: number;
};

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const CURLY_QUOTES = /[“”]/g;
const CURLY_SINGLE_QUOTES = /[’‘]/g;
const DASHES = /[\u2012\u2013\u2014\u2015\u2212]/g;
const ELLIPSIS = /…/g;
const MULTI_SPACE = /[ \t]{2,}/g;

export const normalizeText = (text: string): NormalizeResult => {
  const original = text ?? "";
  let normalized = typeof original.normalize === "function" ? original.normalize("NFKC") : original;
  normalized = normalized.replace(/\r\n?/g, "\n");

  const removedZeroWidth = (normalized.match(ZERO_WIDTH) ?? []).length;
  normalized = normalized.replace(ZERO_WIDTH, "");

  const replacedQuotes = (normalized.match(CURLY_QUOTES) ?? []).length;
  normalized = normalized.replace(CURLY_QUOTES, '"');

  const replacedSingle = (normalized.match(CURLY_SINGLE_QUOTES) ?? []).length;
  normalized = normalized.replace(CURLY_SINGLE_QUOTES, "'");

  const replacedDashes = (normalized.match(DASHES) ?? []).length;
  normalized = normalized.replace(DASHES, "-");

  const replacedEllipsis = (normalized.match(ELLIPSIS) ?? []).length;
  normalized = normalized.replace(ELLIPSIS, "...");

  const collapsedSpaces = (normalized.match(MULTI_SPACE) ?? []).length;
  normalized = normalized.replace(MULTI_SPACE, " ");

  return {
    normalized,
    removedZeroWidth,
    replacedQuotes: replacedQuotes + replacedSingle,
    replacedDashes,
    replacedEllipsis,
    collapsedSpaces,
  };
};
