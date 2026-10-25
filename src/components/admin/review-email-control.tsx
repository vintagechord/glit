"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

type EmailPreview = {
  subject: string; html: string; recipientMasked: string | null; revision: string; updatedAt: string;
  canSend: boolean; missingAssets: string[]; warnings: string[]; attachmentCount: number;
};

export function ReviewEmailControl({ submissionId, lastNotifiedAt }: { submissionId: string; lastNotifiedAt?: string | null }) {
  const router = useRouter();
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
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={loadPreview} disabled={busy !== null} className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background disabled:opacity-50">
          {busy === "preview" ? "미리보기 준비 중…" : "이메일 발송 · 현재 결과 확인"}
        </button>
        <a href="/admin/emails" className="text-sm underline">이메일 발송 내역</a>
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
