import Link from "next/link";

import { markCustomerContactedAction } from "@/app/admin/unread-mail-actions";
import { buildAdminSubmissionDetailPath } from "@/lib/admin/submission-navigation";
import { UNREAD_MAIL_AFTER_DAYS, type UnreadCustomerMail } from "@/lib/admin/unread-customer-mail";
import { brandStatusTones } from "@/lib/brand-status-tones";
import { formatDateTime } from "@/lib/format";

const typeLabels: Record<string, string> = {
  ALBUM: "음반",
  MV_DISTRIBUTION: "온라인 뮤비",
  MV_BROADCAST: "방송 뮤비",
};

/** 메일 미확인 고객 on the admin dashboard: the customer's latest mail unseen
 * for days, with the contact to call (owner, 2026-11-25). 연락 완료 records
 * the call (unread-mail-actions). */
export function UnreadMailList({ items }: { items: UnreadCustomerMail[] }) {
  return (
    <>
      <p className="mb-3 break-keep text-xs font-semibold leading-5 text-muted-foreground">
        마지막 안내 메일을 {UNREAD_MAIL_AFTER_DAYS}일 넘게 열거나 누르지 않았고 결과 페이지 방문도 없는 고객입니다. 메일 앱이 이미지를 막으면 읽고도 표시될 수 있습니다. 연락한 뒤 연락 완료를 눌러주세요.
      </p>
      <ul className="grid gap-2 lg:grid-cols-2">
        {items.map((item) => <UnreadMailLine key={item.submissionId} item={item} />)}
      </ul>
    </>
  );
}

function UnreadMailLine({ item }: { item: UnreadCustomerMail }) {
  const tel = item.phone?.replace(/[^0-9+]/g, "");
  const href = `${buildAdminSubmissionDetailPath({ submissionId: item.submissionId, returnTo: "/admin" })}#customer-emails`;
  return (
    <li className="rounded-[8px] border-2 border-border bg-background px-3 py-2 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link href={href} prefetch={false} className="min-w-0 flex-1 hover:underline">
          <span className="block truncate font-black text-foreground">{item.title || "제목 미입력"}</span>
          <span className="block truncate text-xs font-semibold text-muted-foreground">
            {[item.artistName || "아티스트 미입력", typeLabels[item.type] ?? item.type, `${item.isGuest ? "비회원" : "회원"}${item.customerName ? ` · ${item.customerName}` : ""}`].join(" · ")}
          </span>
        </Link>
        <span className={`shrink-0 rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black ${brandStatusTones.warning}`}>
          {item.unreadDays}일째 미확인
        </span>
      </div>
      <p className="mt-1 break-keep text-xs font-semibold text-muted-foreground">
        {item.mailLabel} · 「{item.mailSubject}」 {formatDateTime(item.sentAt)} 발송
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-black text-foreground">
        <span className="text-muted-foreground">연락처</span>
        {item.phone && tel ? (
          <a href={`tel:${tel}`} className="underline underline-offset-4">{item.phone}</a>
        ) : (
          <span className="text-muted-foreground">전화번호 없음</span>
        )}
        <a href={`mailto:${item.email}`} className="break-all underline underline-offset-4">{item.email}</a>
        <form action={markCustomerContactedAction} className="ml-auto">
          <input type="hidden" name="submissionId" value={item.submissionId} />
          <button type="submit" className="rounded-[6px] border-2 border-[#111111] bg-[#f2cf27] px-2.5 py-1 text-[11px] font-black text-[#111111] transition hover:-translate-y-0.5">
            연락 완료
          </button>
        </form>
      </div>
    </li>
  );
}
