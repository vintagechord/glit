// Reference request forms end with submission guidance and page footers
// ("작성하신 신청서를 … 보내주시면 …", "페이지 1 / 2"). They are instructions
// for the applicant, never lyrics or application values, so documents and
// imported fields must not carry them. Only whole lines that match are
// removed; lyrics that merely mention a page or an e-mail stay intact.
const GUIDANCE = [
  /작성하신\s*신청서를/,
  /HYPERLINK\s+["“]?mailto:/i,
  /신청서를?\s*\S+@\S+\s*(?:으로|로)\s*보내\s*주시면/,
  /보내\s*주시면\s*해당\s*내용으로\s*(?:심의|접수)/,
  /기타\s*문의\s*사항(?:은|이\s*있으시면)?\s*(?:이메일|메일|전화|연락처)/,
];
const PAGE_FOOTER = /^\s*(?:페이지|page)\s*(?:\d+\s*)?[/／]\s*(?:\d+\s*)?$|^\s*-\s*\d+\s*-\s*$/i;

export const isReferenceBoilerplateLine = (line) => {
  const text = String(line ?? '').replace(/　/g, ' ').trim();
  return !!text && (PAGE_FOOTER.test(text) || GUIDANCE.some((pattern) => pattern.test(text)));
};

/** Removes guidance and page-footer lines; trims the blank lines they leave at the end. */
export function stripReferenceBoilerplate(value) {
  if (typeof value !== 'string' || !value) return value;
  const lines = value.split('\n');
  const kept = lines.filter((line) => !isReferenceBoilerplateLine(line));
  if (kept.length === lines.length) return value;
  return kept.join('\n').replace(/\s+$/, '');
}

const LYRIC_FIELDS = ['lyrics', 'original_lyrics', 'lyrics_with_translation', 'translated_lyrics', 'mv_lyrics', 'korean_lyrics_translation', 'mv_storyline', 'mv_memo'];
/** A copy of a record with boilerplate removed from its lyric and story fields. */
export function cleanLyricRecord(record) {
  if (!record || typeof record !== 'object') return record;
  let changed = false;
  const next = { ...record };
  for (const field of LYRIC_FIELDS) {
    if (typeof next[field] !== 'string') continue;
    const cleaned = stripReferenceBoilerplate(next[field]);
    if (cleaned !== next[field]) { next[field] = cleaned; changed = true; }
  }
  return changed ? next : record;
}

// Form labels sometimes carry their qualifier on a separate line, e.g.
// "아티스트" then "(한글 및 영문)". That line belongs to the label.
export const isLabelHint = (value) => {
  const text = String(value ?? '').replace(/　/g, ' ').trim();
  return /^[（(][^()（）]{1,30}[)）]$/.test(text) && /(?:한글|영문|국문|영어|미기입|없을\s*시|선택|필수|예시|국적|기재|입력|작성|띄어쓰기)/.test(text);
};
