"use client";

import * as React from "react";

type Track = { id: string; trackNo: number; title: string; isTitle: boolean; selected: boolean };

const MAX = 3;

/** Picks the three songs 원음방송 reviews; other stations keep every track. */
export function WbsTrackSelectionForm({
  submissionId,
  returnTo,
  tracks,
  action,
}: {
  submissionId: string;
  returnTo: string;
  tracks: Track[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const saved = tracks.filter((track) => track.selected).map((track) => track.id);
  const hasSaved = saved.length > 0;
  // Without a saved choice, suggest the title songs (up to three).
  const [checked, setChecked] = React.useState<string[]>(
    hasSaved ? saved : tracks.filter((track) => track.isTitle).slice(0, MAX).map((track) => track.id),
  );
  const toggle = (id: string, on: boolean) =>
    setChecked((current) => (on ? [...current, id].slice(0, MAX) : current.filter((value) => value !== id)));

  return (
    <form
      id="wbs-track-selection"
      action={action}
      className={`scroll-mt-24 rounded-2xl border-2 p-4 text-sm ${hasSaved ? "border-border bg-background/70" : "border-[#111111] bg-[#f2cf27] text-[#111111]"}`}
      onSubmit={(event) => {
        if (!window.confirm(`원음방송 심의곡을 ${checked.length}곡으로 지정할까요? 원음방송 결과 입력과 고객 화면에는 선택한 곡만 표시되고, 다른 방송사와 신청서의 트랙은 그대로입니다.`)) event.preventDefault();
      }}
    >
      <input type="hidden" name="submissionId" value={submissionId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-black">원음방송 심의곡 지정 (최대 {MAX}곡)</p>
        <span className="text-xs font-bold">
          {hasSaved ? `현재 ${saved.length}곡 지정됨` : "지정 안 됨 · 원음방송에 전체 곡이 표시되고 있습니다"}
        </span>
      </div>
      <p className="mt-1 text-xs font-semibold leading-5 opacity-80">
        원음방송은 앨범당 3곡만 심의합니다. 실제로 원음방송에 접수할 곡만 남기면 나머지 곡은 원음방송에서만 빠집니다.
        {hasSaved ? "" : " 타이틀곡을 먼저 골라 두었습니다. 확인 후 저장해주세요."}
      </p>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {tracks.map((track) => {
          const on = checked.includes(track.id);
          return (
            <li key={track.id}>
              <label className={`flex cursor-pointer items-center gap-2 rounded-[8px] border-2 px-3 py-2 font-semibold ${on ? "border-[#111111] bg-[#1556a4] text-white" : "border-border bg-background text-foreground"} ${!on && checked.length >= MAX ? "opacity-50" : ""}`}>
                <input
                  type="checkbox"
                  name="trackIds"
                  value={track.id}
                  checked={on}
                  disabled={!on && checked.length >= MAX}
                  onChange={(event) => toggle(track.id, event.target.checked)}
                />
                <span className="min-w-0 truncate">
                  {track.trackNo}. {track.title}
                  {track.isTitle ? <span className="ml-1 text-[11px] font-black">(타이틀)</span> : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={checked.length === 0}
          className="rounded-full border-2 border-[#111111] bg-[#111111] px-5 py-2 text-xs font-black text-white disabled:opacity-50"
        >
          원음방송 심의곡 {checked.length}곡 저장
        </button>
        <span className="text-xs font-semibold">{checked.length}/{MAX}곡 선택</span>
      </div>
    </form>
  );
}
