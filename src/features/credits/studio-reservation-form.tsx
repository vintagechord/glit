import { CalendarClock } from "lucide-react";

import { createStudioReservationFormAction } from "./actions";
import type { CreditReward } from "@/lib/credits";

export type StudioReservationContactDefaults = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
};

const inputClass =
  "w-full rounded-[8px] border-2 border-border bg-background px-3 py-2 text-xs font-semibold text-foreground outline-none transition focus:border-[#1556a4]";

const labelClass =
  "grid gap-1 text-[10px] font-black uppercase tracking-normal text-muted-foreground";

export function StudioReservationForm({
  reward,
  canRedeem,
  redirectTo,
  contactDefaults,
}: {
  reward: CreditReward;
  canRedeem: boolean;
  redirectTo: string;
  contactDefaults?: StudioReservationContactDefaults;
}) {
  return (
    <form
      action={createStudioReservationFormAction}
      className="rounded-[8px] border-2 border-border bg-background p-3"
    >
      <input type="hidden" name="rewardId" value={reward.id} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <input type="hidden" name="durationHours" value="1" />
      <div className="flex items-center gap-2 text-xs font-black text-foreground">
        <CalendarClock className="h-4 w-4 text-[#1556a4]" aria-hidden="true" />
        녹음실 예약 요청
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          희망 날짜
          <input
            name="preferredDate"
            type="date"
            required
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          희망 시간
          <input
            name="preferredTime"
            type="time"
            required
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          담당자명
          <input
            name="contactName"
            required
            defaultValue={contactDefaults?.name ?? ""}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          연락처
          <input
            name="contactPhone"
            required
            defaultValue={contactDefaults?.phone ?? ""}
            className={inputClass}
          />
        </label>
      </div>
      <label className={`${labelClass} mt-3`}>
        이메일
        <input
          name="contactEmail"
          type="email"
          defaultValue={contactDefaults?.email ?? ""}
          className={inputClass}
        />
      </label>
      <label className={`${labelClass} mt-3`}>
        요청사항
        <textarea
          name="notes"
          rows={3}
          placeholder="희망 시간대가 여러 개라면 함께 적어주세요."
          className={inputClass}
        />
      </label>
      <button
        type="submit"
        disabled={!canRedeem}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
      >
        {canRedeem ? "크레딧 사용해서 예약 요청" : "크레딧 부족"}
      </button>
    </form>
  );
}
