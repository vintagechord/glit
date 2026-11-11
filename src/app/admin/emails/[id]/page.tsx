import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdminPage } from "@/lib/admin/page-auth";
import {
  formatAttachmentSize,
  missingOriginalReason,
  originalMailAttachments,
  originalMailDocument,
} from "@/lib/admin/email-original";
import { EMAIL_OPERATION_LABELS, EMAIL_STATUS_LABELS } from "@/lib/admin/submission-emails";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "메일 원문" };

type OriginalMailRow = {
  id: string;
  recipient_email: string;
  reply_to: string | null;
  subject: string;
  html: string | null;
  operation: string;
  status: string;
  attempt_count: number;
  created_at: string;
  accepted_at: string | null;
  submission_id: string | null;
  attachment_refs: unknown;
  opened_at: string | null;
  open_count: number | null;
  clicked_at: string | null;
  click_count: number | null;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const seoul = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const time = (value: string | null) => (value ? seoul.format(new Date(value)) : "—");
const linkClass = "inline-flex min-h-10 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-background px-3 text-xs font-black text-foreground shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5";

export default async function EmailOriginalPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const { data, error } = await createAdminClient()
    .from("email_outbox")
    .select("id, recipient_email, reply_to, subject, html, operation, status, attempt_count, created_at, accepted_at, submission_id, attachment_refs, opened_at, open_count, clicked_at, click_count")
    .eq("id", id)
    .maybeSingle();
  if (!error && !data) notFound();
  const mail = data as OriginalMailRow | null;
  const attachments = mail ? originalMailAttachments(mail.attachment_refs) : [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap gap-2">
        <Link href="/admin/emails" className={linkClass}>메일 발송 내역</Link>
        {mail?.submission_id ? (
          <Link href={`/admin/submissions/detail?id=${mail.submission_id}#customer-emails`} prefetch={false} className={linkClass}>접수 상세</Link>
        ) : null}
      </div>
      <div>
        <p className="text-xs font-black tracking-[0.2em] text-muted-foreground">MAIL ORIGINAL</p>
        <h1 className="mt-2 text-2xl font-black text-foreground [overflow-wrap:anywhere]">{mail?.subject ?? "메일 원문"}</h1>
      </div>

      {error || !mail ? (
        <p role="alert" className="rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] p-4 text-sm font-semibold text-white">
          메일을 불러오지 못했습니다. 잠시 후 새로고침해주세요.
        </p>
      ) : (
        <>
          <dl className="grid gap-x-6 gap-y-3 rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-card p-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">받는 사람</dt><dd className="font-semibold [overflow-wrap:anywhere]" data-no-translate>{mail.recipient_email}</dd></div>
            <div><dt className="text-xs text-muted-foreground">메일 종류</dt><dd className="font-semibold">{EMAIL_OPERATION_LABELS[mail.operation] ?? mail.operation}</dd></div>
            <div><dt className="text-xs text-muted-foreground">발송 상태</dt><dd className="font-semibold">{EMAIL_STATUS_LABELS[mail.status] ?? mail.status} · 시도 {mail.attempt_count}회</dd></div>
            <div><dt className="text-xs text-muted-foreground">요청 / 메일 서버 접수</dt><dd className="font-semibold">{time(mail.created_at)} / {time(mail.accepted_at)}</dd></div>
            {mail.reply_to ? <div><dt className="text-xs text-muted-foreground">회신 주소</dt><dd className="font-semibold [overflow-wrap:anywhere]" data-no-translate>{mail.reply_to}</dd></div> : null}
            {mail.opened_at || mail.clicked_at ? (
              <div>
                <dt className="text-xs text-muted-foreground">고객 확인</dt>
                <dd className="font-semibold">
                  {mail.opened_at ? `열람 ${time(mail.opened_at)}${Number(mail.open_count ?? 0) > 1 ? ` · ${mail.open_count}회` : ""}` : ""}
                  {mail.opened_at && mail.clicked_at ? " / " : ""}
                  {mail.clicked_at ? `링크 클릭 ${time(mail.clicked_at)}${Number(mail.click_count ?? 0) > 1 ? ` · ${mail.click_count}회` : ""}` : ""}
                </dd>
              </div>
            ) : null}
            {attachments.length ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">첨부 파일 {attachments.length}개</dt>
                <dd className="font-semibold [overflow-wrap:anywhere]">
                  {attachments.map((file) => `${file.filename}${file.bytes === null ? "" : ` (${formatAttachmentSize(file.bytes)})`}`).join(", ")}
                </dd>
              </div>
            ) : null}
          </dl>

          {mail.html ? (
            <section aria-label="메일 본문" className="space-y-2">
              <iframe
                title={`메일 원문: ${mail.subject}`}
                sandbox=""
                srcDoc={originalMailDocument(mail.html)}
                className="h-[80vh] min-h-[560px] w-full rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-white"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                고객에게 보낸 본문 그대로입니다. 고객 방문 기록이 섞이지 않도록 본문 속 링크는 이 화면에서 열리지 않으며, 원문을 여는 것은 고객 열람으로 기록되지 않습니다.
              </p>
            </section>
          ) : (
            <p className="rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] p-4 text-sm font-semibold text-[#111111]">
              {missingOriginalReason(mail.operation)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
