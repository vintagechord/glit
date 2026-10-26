"use client";

import { useId } from "react";
import { ArrowUpRight } from "lucide-react";
import type { RadioRequestProgress } from "@/lib/radio-request-workspace";
import { radioButtonClass, radioCardClass, radioControlClass, radioExternalUrl, radioNoteClass } from "./radio-request-ui";

export function RadioRequestOutcome({ progress, onChange, isEnglish = false }: {
  progress: RadioRequestProgress;
  onChange: (update: Partial<RadioRequestProgress>) => void;
  isEnglish?: boolean;
}) {
  const id = useId();
  const evidenceUrl = radioExternalUrl(progress.evidenceUrl);
  return <section className={`${radioCardClass} space-y-4`} aria-labelledby={`${id}-title`} data-testid="radio-airplay-record">
    <div><h4 id={`${id}-title`} className="text-base font-bold">{isEnglish ? "Did the story or the song air?" : "사연 소개와 실제 곡 방송을 따로 기록하세요"}</h4>
      <p className={`mt-2 ${radioNoteClass}`}>{isEnglish ? "A reply or a read-out does not establish song airplay. Check the dated official playlist or replay, then record your findings. These notes do not change your review result." : "답변이나 사연 소개만으로 곡이 방송된 것은 아닙니다. 방송일의 공식 선곡표 또는 다시듣기로 확인해 직접 기록하세요. 심의 결과에는 영향을 주지 않습니다."}</p></div>
    <div className="grid gap-3 sm:grid-cols-2">{([
      ["storyRead", isEnglish ? "I confirmed my story was read" : "내 사연이 소개된 것을 확인했어요"],
      ["songAired", isEnglish ? "I confirmed this song aired" : "이 곡이 방송된 것을 확인했어요"],
    ] as const).map(([key, label]) => <label key={key} className="flex min-h-11 items-start gap-2.5 text-sm leading-6"><input type="checkbox" checked={Boolean(progress[key])} onChange={event => onChange({ [key]: event.target.checked })} className="mt-1 size-4 shrink-0 accent-blue-700" /><span>{label}</span></label>)}</div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div><label htmlFor={`${id}-aired`} className="mb-2 block text-sm font-semibold">{isEnglish ? "Broadcast date (KST)" : "확인한 방송일 (한국시간)"}</label><input id={`${id}-aired`} type="date" className={radioControlClass} value={progress.airedDate ?? ""} onChange={event => onChange({ airedDate: event.target.value })} /></div>
      <div><label htmlFor={`${id}-follow-up`} className="mb-2 block text-sm font-semibold">{isEnglish ? "Next check date" : "다음 선곡표 확인일"}</label><input id={`${id}-follow-up`} type="date" className={radioControlClass} value={progress.followUpDate ?? ""} onChange={event => onChange({ followUpDate: event.target.value })} /></div>
    </div>
    <div><label htmlFor={`${id}-evidence`} className="mb-2 block text-sm font-semibold">{isEnglish ? "Playlist or replay evidence link" : "확인한 선곡표·다시듣기 주소"}</label><input id={`${id}-evidence`} type="url" className={radioControlClass} placeholder="https://" maxLength={2000} value={progress.evidenceUrl ?? ""} aria-invalid={Boolean(progress.evidenceUrl && !evidenceUrl)} onChange={event => onChange({ evidenceUrl: event.target.value })} />
      {progress.evidenceUrl && !evidenceUrl && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{isEnglish ? "Enter a valid https:// link." : "https://로 시작하는 올바른 링크를 입력해주세요."}</p>}
      {evidenceUrl && <a href={evidenceUrl} target="_blank" rel="noopener noreferrer" className={`${radioButtonClass} mt-2`}>{isEnglish ? "Open evidence" : "확인 근거 열기"}<ArrowUpRight size={14} aria-hidden /></a>}
    </div>
    <p className={radioNoteClass}>{isEnglish ? "The next check date is a personal note; no automatic notification is sent. Use ‘Save request & notes as TXT’ before closing this tab." : "다음 확인일은 개인 메모이며 자동 알림은 발송되지 않습니다. 탭을 닫기 전에 ‘신청글과 기록 TXT 저장’을 눌러 보관하세요."}</p>
  </section>;
}
