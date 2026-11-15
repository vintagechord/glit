/**
 * A short "did you mean" for application email fields. On 2026-11-15 a guest
 * typed hanmail.met and every mail about the application bounced. This only
 * suggests; it never blocks, so a real domain is never refused.
 */

/** Providers with exactly one mail domain: any other ending on the name is a typo. */
const SINGLE_DOMAIN_PROVIDERS: Record<string, string> = {
  gmail: "gmail.com",
  naver: "naver.com",
  hanmail: "hanmail.net",
  daum: "daum.net",
  nate: "nate.com",
  kakao: "kakao.com",
  icloud: "icloud.com",
};

const KNOWN_DOMAINS = [...Object.values(SINGLE_DOMAIN_PROVIDERS), "hotmail.com", "outlook.com", "yahoo.com"];

/** Real mail domains one letter away from a known one. */
const REAL_LOOKALIKES = new Set(["mail.com", "email.com"]);

/** Names this short have real neighbours (nate → gate, note); only their endings are checked. */
const MIN_NAME_FOR_LETTER_TYPOS = 5;

/** One substitution, insertion, deletion or swap of neighbouring letters. */
function isOneEditApart(a: string, b: string) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diffs: number[] = [];
    for (let i = 0; i < a.length && diffs.length <= 2; i += 1) if (a[i] !== b[i]) diffs.push(i);
    if (diffs.length === 1) return true;
    const [first, second] = diffs;
    return diffs.length === 2 && second === first + 1 && a[first] === b[second] && a[second] === b[first];
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < shorter.length && shorter[i] === longer[i]) i += 1;
  return shorter.slice(i) === longer.slice(i + 1);
}

/** The address with its domain corrected, or null when it looks right. */
export function suggestEmailFix(value: string): string | null {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (!domain || domain.startsWith(".") || KNOWN_DOMAINS.includes(domain) || REAL_LOOKALIKES.has(domain)) return null;
  const single = SINGLE_DOMAIN_PROVIDERS[domain.split(".")[0]];
  if (single) return `${local}@${single}`;
  const near = KNOWN_DOMAINS.find((known) =>
    known.split(".")[0].length >= MIN_NAME_FOR_LETTER_TYPOS && isOneEditApart(domain, known));
  return near ? `${local}@${near}` : null;
}
