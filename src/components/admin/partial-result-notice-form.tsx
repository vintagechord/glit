import { ConfirmSubmitButton } from "@/components/admin/confirm-submit-button";
import { partialNoticeStage } from "@/lib/admin/submission-stages";
import { formatDateTime } from "@/lib/format";

/**
 * Sends an album on to 결과 통보 완료 while a station still has no result, or
 * puts it back into review (see partialNoticeStage). Shown on an album in
 * review with at least one station result, and on one already sent on.
 */
export function PartialResultNoticeForm({
  submissionId,
  returnTo,
  movedAt,
  pendingStations,
  action,
}: {
  submissionId: string;
  returnTo: string;
  /** When the operator sent the album on; null while it is still in review. */
  movedAt: string | null;
  pendingStations: string[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const moved = Boolean(movedAt);
  const pending = pendingStations.join(", ") || "없음";
  return (
    <form
      id="partial-result-notice"
      action={action}
      className={`scroll-mt-24 rounded-2xl border-2 p-4 text-sm ${moved ? "border-[#111111] bg-[#f2cf27] text-[#111111]" : "border-border bg-background/70"}`}
    >
      <input type="hidden" name="submissionId" value={submissionId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="mode" value={moved ? "reopen" : "close"} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black">{moved ? partialNoticeStage.label : "일부 방송사 결과 대기"}</p>
          <p className="mt-1 break-words text-xs font-bold">
            결과 대기: {pending}
            {movedAt ? ` · ${formatDateTime(movedAt)} 처리` : ""}
          </p>
        </div>
        <ConfirmSubmitButton
          className={moved
            ? "rounded-full border-2 border-[#111111] bg-white px-5 py-2.5 text-xs font-black text-[#111111] transition hover:bg-[#111111] hover:text-white"
            : "rounded-full border-2 border-[#111111] bg-[#111111] px-5 py-2.5 text-xs font-black text-white transition hover:bg-[#1556a4] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111]"}
          message={moved
            ? "이 음반을 심의 진행 중으로 되돌릴까요?"
            : `결과가 없는 방송사(${pending})는 대기로 둔 채 결과 통보 완료로 옮길까요? 고객 화면과 메일은 바뀌지 않고, 남은 결과는 나중에 저장할 수 있습니다.`}
        >
          {moved ? "심의 진행 중으로 되돌리기" : "결과 통보 완료로 이동"}
        </ConfirmSubmitButton>
      </div>
      <p className="mt-2 text-xs font-semibold leading-5 opacity-80">
        고객 화면에는 계속 결과 대기로 보입니다. 남은 결과를 저장해 모든 방송사가 채워지면 결과 안내 대기로 올라옵니다.
      </p>
    </form>
  );
}
