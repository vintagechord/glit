import {
  activityTimeline,
  CUSTOMER_ACTIVITY_EVENTS_SINCE,
  CUSTOMER_RESULT_FILE_LABELS,
  CUSTOMER_RESULT_FILES,
  downloadSummary,
  MAIL_READ_STATE_LABELS,
  mailOperationLabel,
  mailReadState,
  mailTrackingOf,
  resultSeenState,
  type ActivityTimelineEntry,
  type CustomerActivityEvent,
  type MailReadState,
  type ResultSeenState,
} from "@/lib/admin/customer-activity";
import type { CustomerViewRecord } from "@/lib/admin/customer-view-record";
import { EMAIL_STATUS_LABELS, type SubmissionCustomerEmail } from "@/lib/admin/submission-emails";
import { brandStatusTones } from "@/lib/brand-status-tones";

const seoul = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const time = (value: string | null | undefined) => (value ? seoul.format(new Date(value)) : "—");

const badge = "inline-flex items-center rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black";

const mailTone: Record<MailReadState, string> = {
  clicked: brandStatusTones.success,
  opened: brandStatusTones.progress,
  unopened: brandStatusTones.warning,
  untracked: brandStatusTones.neutral,
  not_delivered: brandStatusTones.danger,
};

const seenCopy: Record<ResultSeenState, { label: string; tone: string }> = {
  seen: { label: "결과 안내 후 결과 페이지·파일 확인함", tone: brandStatusTones.success },
  mail: { label: "결과 메일만 열람 · 결과 페이지 방문 없음", tone: brandStatusTones.progress },
  none: { label: "결과 안내 후 확인 기록 없음", tone: brandStatusTones.warning },
  unknown: { label: "결과 메일 열람 확인 불가 · 결과 페이지 방문 없음", tone: brandStatusTones.warning },
};

const timelineTone: Record<ActivityTimelineEntry["tone"], string> = {
  mail: "bg-white text-[#111111]",
  open: "bg-[#1556a4] text-white",
  click: "bg-[#1f7a5a] text-white",
  visit: "bg-[#f2cf27] text-[#111111]",
  download: "bg-[#d9362c] text-white",
};
const timelineLabel: Record<ActivityTimelineEntry["tone"], string> = {
  mail: "발송", open: "열람", click: "클릭", visit: "방문", download: "다운로드",
};

function MailReadDetail({ mail, compact = false }: { mail: SubmissionCustomerEmail; compact?: boolean }) {
  const state = mailReadState(mail);
  const tracking = mailTrackingOf(mail);
  return (
    <div className="space-y-1">
      <span className={`${badge} ${mailTone[state]}`}>{MAIL_READ_STATE_LABELS[state]}</span>
      {mail.openCount > 0 ? (
        <p>열람 {mail.openCount}회 · 첫 열람 {time(mail.openedAt)}{mail.openCount > 1 ? ` · 최근 ${time(mail.lastOpenedAt)}` : ""}</p>
      ) : null}
      {mail.clickCount > 0 ? (
        <p>링크 클릭 {mail.clickCount}회 · 첫 클릭 {time(mail.clickedAt)}{mail.clickCount > 1 ? ` · 최근 ${time(mail.lastClickedAt)}` : ""}</p>
      ) : null}
      {state === "untracked" && compact ? <p className="text-muted-foreground">2026-11-05 20:02 열람 확인 기능 도입 전 발송</p> : null}
      {state === "untracked" && !compact ? (
        <p className="text-muted-foreground">
          열람 확인 기능(2026-11-05 20:02) 전에 발송되어 메일 속 확인 이미지가 없습니다. 열람 여부는 알 수 없으며, 결과 메일을 다시 보내면 그 메일부터 기록됩니다.
        </p>
      ) : null}
      {state === "unopened" && !compact ? (
        <p className="text-muted-foreground">
          아직 열지 않았거나, 메일 앱이 이미지를 표시하지 않았습니다.{tracking === "open+click" ? " 메일 속 링크를 누르면 클릭으로 기록됩니다." : ""}
        </p>
      ) : null}
      {state === "not_delivered" ? <p className="text-muted-foreground">발송 상태: {EMAIL_STATUS_LABELS[mail.status] ?? mail.status}</p> : null}
    </div>
  );
}

export function CustomerActivityRecord({
  notifiedAt, view, viewUnavailable, events, eventsUnavailable, emails, emailsUnavailable, hasResultFiles,
}: {
  notifiedAt: string | null | undefined;
  view: CustomerViewRecord | undefined;
  viewUnavailable: boolean;
  events: CustomerActivityEvent[];
  eventsUnavailable: boolean;
  emails: SubmissionCustomerEmail[];
  emailsUnavailable: boolean;
  /** Online MV results come with three files the customer downloads. */
  hasResultFiles: boolean;
}) {
  const resultMail = emails.find((mail) => mail.operation === "review result") ?? null;
  const seen = viewUnavailable || eventsUnavailable ? null : resultSeenState({ notifiedAt, view, events, resultMail });
  const downloads = downloadSummary(events);
  const detailedDownloads = [...downloads.values()].reduce((sum, entry) => sum + entry.count, 0);
  const undetailedDownloads = Math.max(0, (view?.downloadCount ?? 0) - detailedDownloads);
  const timeline = activityTimeline(events, emails);
  const recent = timeline.slice(0, 15);
  const older = timeline.slice(15);
  const visitedAfterNotice = Boolean(view && notifiedAt && Date.parse(view.lastViewedAt) >= Date.parse(notifiedAt));

  const row = (entry: ActivityTimelineEntry) => (
    <li key={entry.key} className="grid gap-x-3 gap-y-0.5 py-1.5 sm:grid-cols-[150px_70px_1fr]">
      <span className="font-mono text-[11px] text-muted-foreground">{time(entry.at)}</span>
      <span><span className={`${badge} border-[#111111] ${timelineTone[entry.tone]}`}>{timelineLabel[entry.tone]}</span></span>
      <span>
        <span className="font-bold text-foreground">{entry.title}</span>
        {entry.detail ? <span className="text-muted-foreground"> · {entry.detail}</span> : null}
      </span>
    </li>
  );

  return (
    <section aria-label="고객 확인 기록" className="mt-4 rounded-[12px] border-2 border-[#111111] bg-white p-4 text-xs text-[#111111] dark:border-[#f2cf27] dark:bg-[#111111] dark:text-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black">고객 확인 기록</p>
        {seen ? <span className={`${badge} ${seenCopy[seen].tone}`}>{seenCopy[seen].label}</span> : null}
        {!notifiedAt ? <span className={`${badge} ${brandStatusTones.neutral}`}>결과 안내 메일 발송 전</span> : null}
      </div>

      <div className={`mt-3 grid gap-3 ${hasResultFiles ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
        <div className="rounded-[8px] border-2 border-[#111111] p-3 dark:border-[#f2cf27]">
          <p className="font-black">결과 안내 메일</p>
          {emailsUnavailable ? <p role="alert" className="mt-2 text-[#d9362c]">메일 기록을 불러오지 못했습니다.</p>
            : resultMail ? (
              <div className="mt-2 space-y-1">
                <p>메일 서버 접수 {time(resultMail.acceptedAt)}</p>
                <MailReadDetail mail={resultMail} />
              </div>
            ) : <p className="mt-2 text-muted-foreground">결과 안내 메일을 보낸 기록이 없습니다.</p>}
        </div>

        <div className="rounded-[8px] border-2 border-[#111111] p-3 dark:border-[#f2cf27]">
          <p className="font-black">결과 페이지</p>
          {viewUnavailable ? <p role="alert" className="mt-2 text-[#d9362c]">방문 기록을 불러오지 못했습니다.</p>
            : view ? (
              <div className="mt-2 space-y-1">
                <span className={`${badge} ${visitedAfterNotice ? brandStatusTones.success : brandStatusTones.neutral}`}>
                  {visitedAfterNotice ? "결과 안내 후 방문함" : notifiedAt ? "결과 안내 후 방문 없음" : "방문 기록 있음"}
                </span>
                <p>방문 {view.viewCount}회 (30분 이상 간격을 새 방문으로 셉니다)</p>
                <p>첫 방문 {time(view.firstViewedAt)}</p>
                <p>최근 방문 {time(view.lastViewedAt)}</p>
              </div>
            ) : (
              <div className="mt-2 space-y-1">
                <span className={`${badge} ${notifiedAt ? brandStatusTones.warning : brandStatusTones.neutral}`}>방문 기록 없음</span>
                <p className="text-muted-foreground">고객이 결과 페이지를 연 기록이 없습니다.</p>
              </div>
            )}
        </div>

        {hasResultFiles ? (
          <div className="rounded-[8px] border-2 border-[#111111] p-3 dark:border-[#f2cf27]">
            <p className="font-black">결과 파일 다운로드</p>
            {eventsUnavailable ? <p role="alert" className="mt-2 text-[#d9362c]">다운로드 기록을 불러오지 못했습니다.</p> : (
              <ul className="mt-2 space-y-1">
                {CUSTOMER_RESULT_FILES.map((file) => {
                  const entry = downloads.get(file);
                  return (
                    <li key={file} className="flex flex-wrap items-center justify-between gap-2">
                      <span>{CUSTOMER_RESULT_FILE_LABELS[file]}</span>
                      <span className={`${badge} ${entry ? brandStatusTones.success : brandStatusTones.neutral}`}>
                        {entry ? `${entry.count}회 · ${time(entry.lastAt)}` : "받지 않음"}
                      </span>
                    </li>
                  );
                })}
                {undetailedDownloads ? (
                  <li className="text-muted-foreground">
                    파일 구분 없는 다운로드 {undetailedDownloads}회 · 상세 기록 시작 전 (마지막 {time(view?.lastDownloadAt)})
                  </li>
                ) : null}
              </ul>
            )}
            <p className="mt-2 text-muted-foreground">메일 첨부파일을 연 것은 여기에 기록되지 않습니다.</p>
          </div>
        ) : null}
      </div>

      {!emailsUnavailable && emails.length ? (
        <div className="mt-3">
          <p className="font-black">고객 안내 메일별 열람</p>
          <ul className="mt-1 divide-y divide-border/60">
            {emails.slice(0, 10).map((mail) => (
              <li key={mail.id} className="grid gap-2 py-2 sm:grid-cols-[170px_1fr]">
                <span>
                  <span className="font-bold">{mailOperationLabel(mail.operation)}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">{time(mail.acceptedAt ?? mail.createdAt)}</span>
                </span>
                <MailReadDetail mail={mail} compact />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3">
        <p className="font-black">상세 기록 (최신순)</p>
        {eventsUnavailable ? <p role="alert" className="mt-1 text-[#d9362c]">상세 기록을 불러오지 못했습니다.</p> : null}
        {timeline.length ? (
          <>
            <ul className="mt-1 divide-y divide-border/60">{recent.map(row)}</ul>
            {older.length ? (
              <details className="mt-1">
                <summary className="cursor-pointer font-bold underline underline-offset-4">이전 기록 {older.length}건 더 보기</summary>
                <ul className="mt-1 divide-y divide-border/60">{older.map(row)}</ul>
              </details>
            ) : null}
          </>
        ) : <p className="mt-1 text-muted-foreground">아직 기록이 없습니다.</p>}
      </div>

      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
        열람: 메일 속 확인 이미지가 표시될 때 기록합니다. 이미지를 막은 메일 앱에서는 열어도 기록되지 않고, 일부 메일 서비스는 이미지를 미리 받아 실제 열람이 아닐 수 있습니다(환경 표시 참고).
        링크 클릭: 메일 속 온사이드 링크를 누를 때 기록하며, 열람보다 확실한 신호입니다({CUSTOMER_ACTIVITY_EVENTS_SINCE} 배포 이후 발송한 메일부터).
        방문·다운로드: 회원 본인과 조회 코드 소지자만 기록하고 관리자 미리보기는 제외합니다. 방문 합계는 2026-11-05 20:02부터, 시각별 상세 기록과 파일별 다운로드는 {CUSTOMER_ACTIVITY_EVENTS_SINCE} 배포 이후부터 쌓입니다. IP 주소는 저장하지 않고 이용 환경 종류만 남깁니다.
      </p>
    </section>
  );
}
