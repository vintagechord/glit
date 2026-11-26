import type { ReactNode } from "react";

import {
  LYRICS_PROFANITY_INCOMPLETE_MESSAGE,
  LYRICS_PROFANITY_MASKING_GUIDANCE,
  LYRICS_PROFANITY_NOTICE_MESSAGE,
  LYRICS_PROFANITY_SUSPECTED_MESSAGE,
} from "@/lib/album-lyrics-review";
import type { LyricsProfanityAnalysis, LyricsProfanityMatch } from "@/lib/profanity/check";

const markClass = (match: LyricsProfanityMatch) => match.category === "confident"
  ? "rounded bg-[var(--bauhaus-red)] text-white dark:text-[#06111f]"
  : "rounded bg-[var(--bauhaus-yellow)] text-[#111111]";

/** The lyrics with each finding marked, for the overlay over a textarea. */
export function renderProfanityMarks(value: string, matches: LyricsProfanityMatch[]): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    parts.push(value.slice(cursor, match.start));
    parts.push(<mark key={`${match.start}-${match.end}`} className={markClass(match)}>{value.slice(match.start, match.end)}</mark>);
    cursor = match.end;
  }
  parts.push(value.slice(cursor));
  return parts;
}

export type ProfanityPanelItem = { label: string; text: string; analysis: LyricsProfanityAnalysis };

/**
 * What the lyrics check found, for album and MV alike. It only informs: an
 * application with profanity can always be submitted (owner decision
 * 2026-11-26).
 */
export function LyricsProfanityPanel({ items }: { items: ProfanityPanelItem[] }) {
  const confident = items.some(({ analysis }) => analysis.hasProfanity);
  const suspected = items.some(({ analysis }) => analysis.hasSuspectedProfanity);
  const truncated = items.some(({ analysis }) => analysis.truncated);
  return (
    <section aria-label="가사 욕설 검사 결과" className="space-y-3 rounded-2xl border-2 border-border bg-background p-4 text-sm text-foreground">
      <p className="font-bold">{confident ? "욕설 표현 있음" : suspected ? "확인 필요 표현 있음" : truncated ? "가사 일부만 검사" : "가사 텍스트 검사 결과"}</p>
      {confident && <>
        <p className="font-semibold">{LYRICS_PROFANITY_NOTICE_MESSAGE}</p>
        <p className="leading-6">{LYRICS_PROFANITY_MASKING_GUIDANCE}</p>
      </>}
      {suspected && <p className="leading-6">{LYRICS_PROFANITY_SUSPECTED_MESSAGE}</p>}
      {truncated && <p className="font-semibold">{LYRICS_PROFANITY_INCOMPLETE_MESSAGE}</p>}
      {!confident && !suspected && !truncated && <p>욕설·확인 필요 표현이 없습니다.</p>}
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {items.flatMap(({ label, text, analysis }) => analysis.matches.slice(0, 30).map((match) => (
          <div key={`${label}-${match.start}-${match.end}-${match.ruleId}`} className="space-y-1 rounded-xl border border-border p-3">
            <p className="text-xs font-bold"><span>{label}</span> · <span>{match.category === "confident" ? "욕설" : "확인 필요"}</span></p>
            <p data-no-translate className="whitespace-pre-wrap break-words">{text.slice(Math.max(0, match.start - 24), match.start)}<mark className={markClass(match)}>{text.slice(match.start, match.end)}</mark>{text.slice(match.end, match.end + 24)}</p>
            <p className="text-xs leading-5 text-muted-foreground">{match.reason}</p>
          </div>
        )))}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">입력한 가사를 기준으로 검사합니다. 제출할 음원과 가사를 똑같이 맞춰주세요.</p>
    </section>
  );
}
