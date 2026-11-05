"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { retryEmailAction } from "@/app/admin/emails/actions";
import { CUSTOMER_EMAIL_OPERATION_LABELS, EMAIL_STATUS_LABELS, SUBMISSION_CUSTOMER_EMAIL_LIMIT, type SubmissionCustomerEmail } from "@/lib/admin/submission-emails";
import { mailReadState } from "@/lib/admin/customer-activity";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

type EmailPreview = {
  subject: string; html: string; recipientMasked: string | null; revision: string; updatedAt: string;
  canSend: boolean; missingAssets: string[]; warnings: string[]; attachmentCount: number;
};

const customerEmailLabels: Record<string, string> = {
  "review result": "결과 안내", "submission update": "진행·상태 안내", "payment completed": "결제 완료 안내",
};

const seoulTime = (value: string | null) => value
  ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value))
  : "—";
const retryableStatuses = new Set(["failed", "uncertain", "retry"]);

export function ReviewEmailControl({ submissionId, lastNotifiedAt, lastCustomerEmail, customerEmails = [], customerEmailsUnavailable = false, returnTo = "" }: {
  submissionId: string; lastNotifiedAt?: string | null;
  /** Newest accepted customer mail of any kind for this application. */
  lastCustomerEmail?: { operation: string; at: string } | null;
  /** Mail sent to this submission's customer only (never staff notices). */
  customerEmails?: SubmissionCustomerEmail[];
  customerEmailsUnavailable?: boolean;
  /** The admin list filter to keep after a retry redirects back here. */
  returnTo?: string;
}) {
  const router = useRouter();
  const [historyOpen, setHistoryOpen] = React.useState(false);
  React.useEffect(() => {
    // A retry redirects back with #customer-emails, and the supplement history
    // links to it; open the list whenever that anchor is targeted.
    const openFromHash = () => { if (window.location.hash === "#customer-emails") setHistoryOpen(true); };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);
  const [preview, setPreview] = React.useState<EmailPreview | null>(null);
  const [busy, setBusy] = React.useState<"preview" | "send" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const pending = React.useRef(false);
  const requestId = React.useRef<string | null>(null);
  const endpoint = `/api/admin/submissions/${submissionId}/result-email`;

  async function loadPreview() {
    if (pending.current) return;
    pending.current = true;
    setBusy("preview"); setError(null); setNotice(null); setPreview(null);
    try {
      const response = await fetchWithTimeout(endpoint, { cache: "no-store" }, 60_000);
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error || "미리보기를 불러오지 못했습니다.");
      requestId.current = crypto.randomUUID();
      setPreview(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "미리보기를 불러오지 못했습니다."); }
    finally { pending.current = false; setBusy(null); }
  }
  async function sendPreview() {
    if (pending.current || !preview?.canSend || !requestId.current) return;
    pending.current = true;
    setBusy("send"); setError(null); setNotice(null);
    try {
      const response = await fetchWithTimeout(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId.current, expectedRevision: preview.revision, expectedUpdatedAt: preview.updatedAt }),
      }, 300_000);
      const body = await response.json();
      if (!response.ok || body.error) {
        if (response.status === 409) { setPreview(null); requestId.current = null; }
        throw new Error(body.error || "발송 요청을 완료하지 못했습니다.");
      }
      setNotice(body.notification?.deliveredCount > 0 ? "결과 이메일이 발송 업체에 접수되었습니다."
        : body.notification?.queuedCount > 0 ? "결과 이메일이 발송 대기열에 등록되었습니다."
          : body.warning || "이메일 발송 내역에서 처리 상태를 확인해주세요.");
      setPreview(null); requestId.current = null;
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "발송 상태를 확인하지 못했습니다. 발송 내역을 확인해주세요."); }
    finally { pending.current = false; setBusy(null); }
  }
  return (
    <section id="result-email" className="rounded-[28px] border border-border/60 bg-card/80 p-6" aria-label="결과 이메일 안내">
      <h2 className="text-base font-semibold">현재 결과 이메일 발송</h2>
      <p className="mt-2 text-sm text-muted-foreground">방송사별 결과와 필증을 먼저 저장한 뒤, 저장된 현재 결과를 한 통의 이메일로 안내합니다.</p>
      <p className="mt-2 text-xs text-muted-foreground">{lastNotifiedAt ? `마지막 결과 이메일 접수: ${new Date(lastNotifiedAt).toLocaleString("ko-KR")}` : "현재 저장된 결과의 이메일 발송 기록이 없습니다."}</p>
      {lastCustomerEmail ? <p className="mt-1 text-xs text-muted-foreground">최근 고객 안내 메일 접수: {customerEmailLabels[lastCustomerEmail.operation] ?? lastCustomerEmail.operation} · {new Date(lastCustomerEmail.at).toLocaleString("ko-KR")}</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={loadPreview} disabled={busy !== null} className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background disabled:opacity-50">
          {busy === "preview" ? "미리보기 준비 중…" : "이메일 발송 · 현재 결과 확인"}
        </button>
        <button
          type="button"
          onClick={() => setHistoryOpen((value) => !value)}
          aria-expanded={historyOpen}
          aria-controls="customer-emails"
          className="text-sm font-semibold underline underline-offset-4"
        >
          이메일 발송 내역 ({customerEmails.length}{customerEmails.length >= SUBMISSION_CUSTOMER_EMAIL_LIMIT ? "+" : ""}건) {historyOpen ? "▲" : "▼"}
        </button>
      </div>
      <div id="customer-emails" className="scroll-mt-24">
      {historyOpen ? (
        <div className="mt-4 space-y-2 rounded-2xl border border-border/60 bg-background/70 p-3 text-sm">
          <p className="text-xs text-muted-foreground">
            이 접수의 고객에게 보낸 메일만 표시합니다. 관리자 알림 메일은 빠지며, 온사이드 전체 메일은 관리자 홈의 ‘메일 발송 내역’에서 확인합니다. 메일 서버 접수는 수신함 도착과 다릅니다. 열람 확인은 메일 속 이미지가 열릴 때 기록되므로, 이미지를 차단한 메일 앱에서는 열어도 기록되지 않을 수 있습니다. 링크 클릭은 메일 속 온사이드 링크를 누를 때 기록됩니다. 2026-11-05 20:02 이전에 발송한 메일은 열람 여부를 알 수 없습니다.
          </p>
          {customerEmailsUnavailable ? <p role="alert" className="text-xs text-rose-700">발송 내역을 불러오지 못했습니다. 잠시 후 새로고침해주세요.</p> : null}
          {!customerEmailsUnavailable && customerEmails.length === 0 ? <p className="text-xs text-muted-foreground">이 접수로 고객에게 보낸 메일 기록이 없습니다. 발송 기록은 최근 30일간 보관합니다.</p> : null}
          <ul className="divide-y divide-border/50">
            {customerEmails.map((mail) => (
              <li key={mail.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{CUSTOMER_EMAIL_OPERATION_LABELS[mail.operation] ?? mail.operation}</span>
                  <span className={`rounded-[6px] border-2 border-[#111111] px-2 py-0.5 text-[11px] font-black ${mail.status === "accepted" ? "bg-[#1f8a4c] text-white" : ["failed", "expired"].includes(mail.status) ? "bg-[#d9362c] text-white" : mail.status === "uncertain" ? "bg-[#f2cf27] text-[#111111]" : "bg-white text-[#111111]"}`}>
                    {EMAIL_STATUS_LABELS[mail.status] ?? mail.status}
                  </span>
                </div>
                <p className="mt-1 break-all text-xs text-foreground">{mail.subject}</p>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {mail.recipient} · 요청 {seoulTime(mail.createdAt)}{mail.acceptedAt ? ` · 접수 ${seoulTime(mail.acceptedAt)}` : ""} · 시도 {mail.attempts}회{mail.status === "retry" ? ` · 예정 ${seoulTime(mail.nextAttemptAt)}` : ""}
                </p>
                {["accepted", "uncertain"].includes(mail.status) || mail.openCount > 0 || mail.clickCount > 0 ? (
                  <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                    {mail.openedAt ? (
                      <span className="rounded-[6px] border-2 border-[#111111] bg-[#1556a4] px-2 py-0.5 font-black text-white">
                        열람 확인 {seoulTime(mail.openedAt)}{mail.openCount > 1 ? ` · ${mail.openCount}회` : ""}
                      </span>
                    ) : null}
                    {mail.clickedAt ? (
                      <span className="rounded-[6px] border-2 border-[#111111] bg-[#1f7a5a] px-2 py-0.5 font-black text-white">
                        링크 클릭 {seoulTime(mail.clickedAt)}{mail.clickCount > 1 ? ` · ${mail.clickCount}회` : ""}
                      </span>
                    ) : null}
                    {!mail.openedAt && !mail.clickedAt ? (
                      mailReadState(mail) === "untracked" ? (
                        <span className="rounded-[6px] border-2 border-[#111111] bg-white px-2 py-0.5 font-black text-[#111111]">열람 확인 불가 · 기능 도입 전 발송</span>
                      ) : (
                        <span className="rounded-[6px] border-2 border-[#111111] bg-[#f2cf27] px-2 py-0.5 font-black text-[#111111]">열람 기록 없음</span>
                      )
                    ) : null}
                  </p>
                ) : null}
                {retryableStatuses.has(mail.status) ? (
                  <form action={retryEmailAction} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={mail.id} />
                    <input type="hidden" name="submissionId" value={submissionId} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    {mail.status === "uncertain" ? (
                      <label className="flex max-w-md gap-2 text-xs"><input type="checkbox" name="allowUncertain" required />이미 메일이 도착했을 수 있으며, 재발송하면 중복 수신될 수 있음을 확인했습니다.</label>
                    ) : null}
                    <button type="submit" className="rounded-[8px] border-2 border-[#111111] bg-white px-3 py-1 text-xs font-black text-[#111111] transition hover:bg-[#111111] hover:text-white">재발송 예약</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      </div>
      {preview ? (
        <div className="mt-4 space-y-3">
          <dl className="grid gap-1 text-sm"><div><dt className="inline font-semibold">받는 사람: </dt><dd className="inline">{preview.recipientMasked ?? "확인 필요"}</dd></div><div><dt className="inline font-semibold">제목: </dt><dd className="inline">{preview.subject}</dd></div><div><dt className="inline font-semibold">첨부: </dt><dd className="inline">{preview.attachmentCount}개</dd></div></dl>
          {preview.warnings.length > 0 ? <ul className="list-inside list-disc text-sm text-amber-700">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
          {preview.missingAssets.length > 0 ? <p className="text-sm text-rose-700">발송 준비 필요: {preview.missingAssets.join(" · ")}</p> : null}
          <iframe title="고객에게 발송할 결과 이메일 미리보기" sandbox="" srcDoc={preview.html} className="min-h-[480px] w-full rounded-xl border border-border bg-white" />
          <p className="text-xs text-muted-foreground">아래 버튼을 누르면 이 내용으로 이메일을 발송합니다. 미리보기 후 결과가 변경되면 다시 확인해야 합니다.</p>
          <button type="button" onClick={sendPreview} disabled={busy !== null || !preview.canSend} className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background disabled:opacity-50">
            {busy === "send" ? "발송 요청 중…" : "이 내용으로 이메일 발송"}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p> : null}
    </section>
  );
}
