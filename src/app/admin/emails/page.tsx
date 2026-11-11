import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { EMAIL_STATUS_LABELS as labels } from "@/lib/admin/submission-emails";
import { OPEN_TRACKED_EMAIL_OPERATIONS } from "@/lib/email-tracking-shared";
import { mailTrackingOf } from "@/lib/admin/customer-activity";
import { retryEmailAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "메일 발송 내역" };
type MailRow = { id: string; recipient_email: string; subject: string; status: string; attempt_count: number; created_at: string; next_attempt_at: string | null; last_error_reason: string | null; operation: string; submission_id: string | null; opened_at: string | null; open_count: number | null; clicked_at: string | null; click_count: number | null; tracking: string | null; accepted_at: string | null; last_attempt_at: string | null };
const time = (value: string | null) => value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)) : "—";
async function queueIsDelayed(oldest: string | null | undefined, lastFinished: string | null | undefined) {
  return !lastFinished || !Number.isFinite(Date.parse(lastFinished)) || Date.parse(lastFinished) <= Date.now() - 27 * 60 * 60_000 || Boolean(oldest && Date.parse(oldest) < Date.now() - 15 * 60_000);
}

export default async function EmailAdminPage({ searchParams }: { searchParams: Promise<{ page?: string; notice?: string }> }) {
  await requireAdminPage();
  const params = await searchParams;
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const db = createAdminClient();
  const [mail, worker, stats] = await Promise.all([
    db.from("email_outbox").select("id,recipient_email,subject,status,attempt_count,created_at,next_attempt_at,last_error_reason,operation,submission_id,opened_at,open_count,clicked_at,click_count,tracking,accepted_at,last_attempt_at", { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * 50, page * 50 - 1),
    db.from("email_worker_config").select("enabled,last_started_at,last_finished_at,last_error").eq("singleton", true).maybeSingle(),
    db.rpc("email_outbox_stats"),
  ]);
  const rows = (mail.data ?? []) as MailRow[];
  const failedRead = Boolean(mail.error || worker.error || stats.error);
  const counts = (stats.data ?? {}) as { pending?: number; retry?: number; uncertain?: number; failed?: number; oldestPendingAt?: string | null };
  const delayed = await queueIsDelayed(counts.oldestPendingAt, worker.data?.last_finished_at);
  const workerHealthy = worker.data?.enabled && !worker.data.last_error && !delayed;
  return <div className="mx-auto max-w-6xl px-6 py-12">
    <Link href="/admin" className="text-sm underline">관리자 홈</Link>
    <h1 className="mt-4 text-3xl font-black">메일 발송 내역</h1>
    <p className="mt-3 text-sm text-muted-foreground">온사이드가 보낸 전체 메일입니다. 한 접수의 고객 메일만 보려면 접수 상세의 ‘이메일 발송 내역’을 여세요. 메일 서버 접수는 수신함 도착과 다릅니다. 실패한 메일은 자동 재시도하며, 접수 여부가 불확실하면 중복 발송 방지를 위해 확인을 기다립니다. 인증 링크가 만료된 메일은 이용자가 새로 요청해야 합니다. 열람 확인은 고객 안내 메일 속 이미지가 열릴 때 기록되므로, 이미지를 차단한 메일 앱에서는 열어도 기록되지 않을 수 있습니다(2026-11-05 20:02 이후 발송분부터). 링크 클릭은 메일 속 온사이드 링크를 누를 때 기록됩니다.</p>
    <div className="my-5 rounded-lg border p-4 text-sm">
      <p>자동 재시도: {workerHealthy ? "사용 중" : "확인 필요"} · 최근 처리 완료: {time(worker.data?.last_finished_at ?? null)}</p>
      <p className="mt-2">대기 {Number(counts.pending ?? 0) + Number(counts.retry ?? 0)}건 · 확인 필요 {Number(counts.uncertain ?? 0)}건 · 실패 {Number(counts.failed ?? 0)}건</p>
      <p className="mt-2">발송 이력과 메일 본문은 최근 30일간 보관합니다. 제목을 누르면 고객이 받은 원문을 볼 수 있습니다. 로그인·인증 링크가 담긴 메일은 발송 후 본문을 바로 삭제합니다.</p>
    </div>
    {failedRead && <p role="alert" className="my-4 text-red-600">발송 상태를 불러오지 못했습니다. 잠시 후 새로고침해주세요.</p>}
    {params.notice && <p role="status" className="my-4">{params.notice === "queued" ? "재발송 대기열에 등록했습니다. 자동 처리 후 결과를 확인해주세요." : "재발송을 등록하지 못했습니다. 현재 상태와 유효 기간을 확인해주세요."}</p>}
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted"><tr><th className="p-3">요청 시각</th><th className="p-3">수신 주소 / 제목</th><th className="p-3">상태</th><th className="p-3">열람 확인</th><th className="p-3">재발송</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className="border-t align-top">
          <td className="p-3 whitespace-nowrap">{time(row.created_at)}</td>
          <td className="p-3 break-all"><div>{row.recipient_email}</div><Link href={`/admin/emails/${row.id}`} prefetch={false} className="mt-1 block font-semibold underline underline-offset-4">{row.subject}</Link></td>
          <td className="p-3"><div>{labels[row.status] ?? row.status}</div><div className="mt-1 text-xs text-muted-foreground">시도 {row.attempt_count}회</div>{row.status === "retry" && <div className="mt-1 text-xs">예정 {time(row.next_attempt_at)}</div>}</td>
          <td className="p-3 whitespace-nowrap text-xs">{row.opened_at || row.clicked_at ? <span className="flex flex-col items-start gap-1">
            {row.opened_at ? <span className="rounded-[6px] border-2 border-[#111111] bg-[#1556a4] px-2 py-0.5 font-black text-white">열람 {time(row.opened_at)}{Number(row.open_count ?? 0) > 1 ? ` · ${row.open_count}회` : ""}</span> : null}
            {row.clicked_at ? <span className="rounded-[6px] border-2 border-[#111111] bg-[#1f7a5a] px-2 py-0.5 font-black text-white">링크 클릭 {time(row.clicked_at)}{Number(row.click_count ?? 0) > 1 ? ` · ${row.click_count}회` : ""}</span> : null}
          </span>
            : ["accepted", "uncertain"].includes(row.status) && row.submission_id && OPEN_TRACKED_EMAIL_OPERATIONS.has(row.operation)
              ? mailTrackingOf({ tracking: row.tracking, operation: row.operation, acceptedAt: row.accepted_at, lastAttemptAt: row.last_attempt_at }) ? "기록 없음" : "확인 불가 (도입 전 발송)"
              : "—"}</td>
          <td className="p-3">{["failed", "uncertain", "retry"].includes(row.status) ? <form action={retryEmailAction}>
            <input type="hidden" name="id" value={row.id} />
            {row.status === "uncertain" && <label className="mb-2 flex max-w-xs gap-2 text-xs"><input type="checkbox" name="allowUncertain" required />이미 메일이 도착했을 수 있으며, 재발송하면 중복 수신될 수 있음을 확인했습니다.</label>}
            <button type="submit" className="rounded border px-3 py-2 font-semibold">재발송 예약</button>
          </form> : "—"}</td>
        </tr>)}</tbody>
      </table>
      {!rows.length && !failedRead && <p className="p-6 text-sm">아직 발송 기록이 없습니다.</p>}
    </div>
    <nav className="mt-5 flex gap-4 text-sm" aria-label="발송 이력 페이지">{page > 1 && <Link href={`/admin/emails?page=${page - 1}`}>이전</Link>}<span>{page}페이지</span>{(mail.count ?? 0) > page * 50 && <Link href={`/admin/emails?page=${page + 1}`}>다음</Link>}</nav>
  </div>;
}
