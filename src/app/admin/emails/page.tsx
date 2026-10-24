import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { retryEmailAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "이메일 발송 관리" };

const labels: Record<string, string> = {
  pending: "발송 대기", sending: "발송 처리 중", retry: "자동 재시도 대기",
  accepted: "메일 서버 접수", uncertain: "접수 여부 확인 필요", failed: "발송 실패", expired: "유효 기간 종료",
};
type MailRow = { id: string; recipient_email: string; subject: string; status: string; attempt_count: number; created_at: string; next_attempt_at: string | null; last_error_reason: string | null };
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
    db.from("email_outbox").select("id,recipient_email,subject,status,attempt_count,created_at,next_attempt_at,last_error_reason", { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * 50, page * 50 - 1),
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
    <h1 className="mt-4 text-3xl font-black">이메일 발송 관리</h1>
    <p className="mt-3 text-sm text-muted-foreground">메일 서버 접수는 수신함 도착과 다릅니다. 실패한 메일은 자동 재시도하며, 접수 여부가 불확실하면 중복 발송 방지를 위해 확인을 기다립니다. 인증 링크가 만료된 메일은 이용자가 새로 요청해야 합니다.</p>
    <div className="my-5 rounded-lg border p-4 text-sm">
      <p>자동 재시도: {workerHealthy ? "사용 중" : "확인 필요"} · 최근 처리 완료: {time(worker.data?.last_finished_at ?? null)}</p>
      <p className="mt-2">대기 {Number(counts.pending ?? 0) + Number(counts.retry ?? 0)}건 · 확인 필요 {Number(counts.uncertain ?? 0)}건 · 실패 {Number(counts.failed ?? 0)}건</p>
      <p className="mt-2">발송 이력은 최근 30일간 보관하며, 발송이 접수되거나 유효 기간이 끝난 메일 본문은 삭제합니다.</p>
    </div>
    {failedRead && <p role="alert" className="my-4 text-red-600">발송 상태를 불러오지 못했습니다. 잠시 후 새로고침해주세요.</p>}
    {params.notice && <p role="status" className="my-4">{params.notice === "queued" ? "재발송 대기열에 등록했습니다. 자동 처리 후 결과를 확인해주세요." : "재발송을 등록하지 못했습니다. 현재 상태와 유효 기간을 확인해주세요."}</p>}
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted"><tr><th className="p-3">요청 시각</th><th className="p-3">수신 주소 / 제목</th><th className="p-3">상태</th><th className="p-3">재발송</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className="border-t align-top">
          <td className="p-3 whitespace-nowrap">{time(row.created_at)}</td>
          <td className="p-3 break-all"><div>{row.recipient_email}</div><div className="mt-1 font-semibold">{row.subject}</div></td>
          <td className="p-3"><div>{labels[row.status] ?? row.status}</div><div className="mt-1 text-xs text-muted-foreground">시도 {row.attempt_count}회</div>{row.status === "retry" && <div className="mt-1 text-xs">예정 {time(row.next_attempt_at)}</div>}</td>
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
