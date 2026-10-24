"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { getEmailDeliveryMode } from "@/lib/email-delivery-mode";

type SupplementFile = { id: string; original_name: string; size_bytes: number; status: string };
type Notice = { id: string; state_key: string; attempts: number; last_attempt_at?: string | null; outcome: { email?: string; kakao?: string; emailMessageId?: string; kakaoMessageId?: string } };
type Revision = { id: string; revision_no: number; status: string; note?: string | null; review_note?: string | null; files: SupplementFile[]; notifications?: Notice[] };
type Request = { id: string; note: string; status: string; created_at: string; revisions: Revision[] };

const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50";

/** Supplements remain separate from the paid application and its original files. */
export function SubmissionSupplements({ submissionId, guestToken, admin = false }: {
  submissionId: string;
  guestToken?: string;
  admin?: boolean;
}) {
  const pathname = usePathname();
  const english = pathname === "/en" || pathname.startsWith("/en/");
  const t = (ko: string, en: string) => english ? en : ko;
  const [open, setOpen] = React.useState(false);
  const [requests, setRequests] = React.useState<Request[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [requestNote, setRequestNote] = React.useState("");
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [uploading, setUploading] = React.useState(false);
  const controller = React.useRef<AbortController | null>(null);
  const endpoint = `/api/submissions/${encodeURIComponent(submissionId)}/supplements`;
  const regionId = React.useId();
  const labelId = React.useId();

  React.useEffect(() => () => controller.current?.abort(), []);

  async function api<T>(body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await fetch(endpoint, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(guestToken ? { "x-guest-token": guestToken } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    if (!response.ok) {
      // Do not display infrastructure errors, SQL, object keys, or tokens.
      if (response.status === 401 || response.status === 403) throw new Error(t("조회 권한을 확인해주세요. 로그인 또는 조회 코드로 다시 접속해주세요.", "Check access by signing in or reopening with your tracking code."));
      if (response.status === 503) throw new Error(t("보완 제출 기능을 준비 중입니다. 고객센터로 문의해주세요.", "Supplement submission is not available yet. Contact support."));
      if (response.status === 409) throw new Error(t("보완 상태가 변경되었거나 필요한 파일이 아직 준비되지 않았습니다. 새로 불러오기를 눌러 최신 내역을 확인해주세요.", "The status changed or required files are not ready. Select Reload to check the latest details."));
      throw new Error(t("처리하지 못했습니다. 파일 형식·용량과 요청 상태를 확인하고 다시 시도해주세요.", "Could not complete the request. Check the file format, size, and request status, then retry."));
    }
    return result as T;
  }

  async function load() {
    const result = await api<{ requests: Request[] }>();
    setRequests(result.requests);
    setLoaded(true);
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (cause) {
      const networkFailure = cause instanceof Error && ["TypeError", "AbortError", "TimeoutError"].includes(cause.name);
      setError(networkFailure
        ? t("네트워크 응답을 확인하지 못했습니다. 내역을 다시 불러온 뒤 전송 상태를 확인해주세요.", "Could not confirm the response. Reload and check the upload status.")
        : cause instanceof Error ? cause.message : t("다시 시도해주세요.", "Please try again."));
    }
    finally { setBusy(false); }
  }

  async function upload(requestId: string, selected: FileList | null) {
    if (!selected?.length) return;
    const selectedFiles = Array.from(selected);
    await run(async () => {
      const abort = new AbortController(); controller.current = abort;
      setUploading(true);
      let activeFileId: string | undefined;
      let awaitingVerification = false;
      try {
        for (const file of selectedFiles) {
          if (!file.size) throw new Error(t("빈 파일은 제출할 수 없습니다.", "Empty files cannot be submitted."));
          const init = await api<{ fileId: string; partSize: number; partCount: number }>({ action: "init", requestId, filename: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size }, abort.signal);
          activeFileId = init.fileId;
          const parts: Array<{ partNumber: number; etag: string }> = [];
          let signedParts: Array<{ partNumber: number; url: string }> = [];
          for (let partNumber = 1; partNumber <= init.partCount; partNumber++) {
            setMessage(`${file.name} · ${partNumber}/${init.partCount} ${t("전송 중", "uploading")}`);
            if (!signedParts.some(item => item.partNumber === partNumber)) {
              const partNumbers = Array.from({ length: Math.min(4, init.partCount - partNumber + 1) }, (_, index) => partNumber + index);
              const signed = await api<{ parts: Array<{ partNumber: number; url: string }> }>({ action: "presign", fileId: init.fileId, partNumbers }, abort.signal);
              signedParts = signed.parts;
            }
            const part = signedParts.find(item => item.partNumber === partNumber);
            if (!part) throw new Error(t("업로드 주소를 받지 못했습니다.", "Could not obtain an upload URL."));
            const response = await fetch(part.url, {
              method: "PUT",
              body: file.slice((partNumber - 1) * init.partSize, Math.min(partNumber * init.partSize, file.size)),
              signal: AbortSignal.any([abort.signal, AbortSignal.timeout(120_000)]),
              credentials: "omit",
            });
            const etag = response.headers.get("etag");
            if (!response.ok || !etag) throw new Error(t("전송을 완료하지 못했습니다. 네트워크를 확인한 뒤 파일을 다시 선택해주세요.", "Upload failed. Check your connection and select the file again."));
            parts.push({ partNumber, etag: etag.replaceAll('"', "") });
          }
          awaitingVerification = true;
          await api({ action: "complete", fileId: init.fileId, parts }, abort.signal);
          awaitingVerification = false;
          activeFileId = undefined;
        }
        setMessage(t("파일 전송이 완료되었습니다. 아래 보완 제출 버튼을 눌러 관리자에게 제출해주세요.", "Files uploaded. Use Submit Supplements below to send them for review."));
      } catch (cause) {
        if (activeFileId && !awaitingVerification) {
          try { await api({ action: "abort", fileId: activeFileId }); } catch { /* The server retains an expiring grant for cleanup. */ }
        }
        if (awaitingVerification) setMessage(t("파일이 저장되었을 수 있습니다. 내역의 ‘전송 확인 다시 시도’로 먼저 확인해주세요.", "The file may have been saved. Use Recheck Upload in the history before uploading again."));
        if (abort.signal.aborted && !awaitingVerification) throw new Error(t("전송을 취소했습니다. 다시 제출하려면 파일을 선택해주세요.", "Upload cancelled. Select the file to try again."));
        throw cause;
      } finally {
        setUploading(false); controller.current = null;
        await load();
      }
    });
  }

  const statusLabel = (status: string) => ({
    OPEN: t("보완 요청", "Requested"), REQUESTED: t("보완 요청", "Requested"),
    DRAFT: t("작성 중", "Draft"), SUBMITTED: t("관리자 확인 대기", "Awaiting Staff Review"),
    ACCEPTED: t("관리자 수락", "Accepted"), REJECTED: t("재보완 요청", "Revision Requested"),
    PENDING: t("전송 중 또는 재선택 필요", "Uploading or Reselection Required"),
    UPLOADING: t("전송 중", "Uploading"), VERIFIED: t("파일 전송 완료", "File Uploaded"),
    UPLOADED: t("파일 전송 완료", "File Uploaded"), ABORTED: t("전송 취소", "Cancelled"),
  }[status] ?? t("상태 확인 중", "Checking Status"));
  const delivery = (status?: string, email = false) => status === "API_ACCEPTED" ? t("발송 업체 접수", "Accepted by Provider") : status === "SKIPPED" ? email && getEmailDeliveryMode() === "manual" ? t("자동 이메일 보류·별도 안내 필요", "Automatic Email Deferred; Notify Separately") : t("설정·수신처 확인 필요", "Configuration or Recipient Needed") : status === "FAILED" ? t("실패·재시도 필요", "Failed; Retry Needed") : t("응답 확인 필요", "Response Needs Checking");

  return <section className="my-6 rounded-xl border border-border bg-card p-4 sm:p-6" aria-labelledby={labelId}>
    <h2 id={labelId} className="text-lg font-bold">{t("보완 요청·제출 내역", "Supplement Requests and Submissions")}</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("요청받은 자료만 새 버전으로 제출합니다. 결제한 신청 정보와 기존 파일은 보존됩니다.", "Submit requested materials as a new version. The paid application and original files are preserved.")}</p>
    <button type="button" className={`${buttonClass} mt-3`} aria-expanded={open} aria-controls={regionId} disabled={busy} onClick={() => {
      setOpen(!open);
      if (!open) void run(load);
    }}>{open ? t("내역 접기", "Collapse") : t("보완 내역 확인", "View Supplements")}</button>
    {open && <div id={regionId} className="mt-4 space-y-5" aria-busy={busy}>
      {error && <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">{error}</p>}
      <p role="status" aria-live="polite" className="break-all text-sm">{message || (busy && !uploading ? t("처리 중…", "Working…") : "")}</p>
      {uploading && <button className={buttonClass} type="button" onClick={() => controller.current?.abort()}>{t("전송 취소", "Cancel Upload")}</button>}
      <button className={buttonClass} disabled={busy} type="button" onClick={() => void run(load)}>{t("새로 불러오기", "Reload")}</button>
      {loaded && !requests.length && <p className="text-sm">{t("등록된 보완 요청이 없습니다.", "There are no supplement requests.")}</p>}
      {admin && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void run(async () => { await api({ action: "request", note: requestNote }); setRequestNote(""); await load(); }); }}>
        <label className="block text-sm font-bold" htmlFor={`${regionId}-request`}>{t("요청할 방송사·트랙·파일과 보완 사유", "Broadcaster, Track, Required Files, and Reason")}</label>
        <textarea id={`${regionId}-request`} required minLength={3} maxLength={4000} value={requestNote} onChange={event => setRequestNote(event.target.value)} className="min-h-24 w-full rounded border border-border bg-background p-3 text-base" />
        <button type="submit" disabled={busy} className={buttonClass}>{t("보완 요청 등록", "Create Request")}</button>
      </form>}
      {requests.map(request => {
        const latest = [...request.revisions].sort((a, b) => b.revision_no - a.revision_no)[0];
        const editable = !admin && ["OPEN", "REQUESTED", "REJECTED"].includes(request.status);
        const verified = latest?.status === "DRAFT" && latest.files.some(file => ["VERIFIED", "UPLOADED"].includes(file.status)) && !latest.files.some(file => file.status === "PENDING");
        return <article key={request.id} className="space-y-3 border-t border-border pt-4">
          <h3 className="font-bold">{statusLabel(request.status)}</h3>
          <p className="whitespace-pre-wrap break-words text-sm">{request.note}</p>
          {admin && <button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async () => {
            const result = await api<{ notification: { email: string; kakao: string; alreadyAccepted?: boolean } }>({ action: "notify", requestId: request.id });
            setMessage(`${t("이메일", "Email")}: ${delivery(result.notification.email, true)} · ${t("카카오", "Kakao")}: ${delivery(result.notification.kakao)}. ${t("실제 수신 여부는 수신함에서 확인해주세요.", "Confirm delivery in the recipient’s inbox.")}`);
            await load();
          })}>{t("보완 안내 보내기·실패 재시도", "Send Supplement Notice / Retry Failures")}</button>}
          {request.revisions.map(revision => <div key={revision.id} className="rounded-lg border border-border p-3 text-sm">
            <p className="font-bold">{t("버전", "Version")} {revision.revision_no} · {statusLabel(revision.status)}</p>
            {revision.note && <p className="mt-2 whitespace-pre-wrap break-words">{revision.note}</p>}
            {revision.review_note && <p className="mt-2 whitespace-pre-wrap break-words">{revision.review_note}</p>}
            {admin && !!revision.notifications?.length && <details className="mt-3 rounded border border-border p-3">
              <summary className="cursor-pointer font-semibold">{t("보완 안내 발송 이력", "Supplement Notification History")}</summary>
              <p className="mt-2">{t("업체 접수와 실제 수신은 다릅니다. 응답이 불확실하거나 오래된 실패는 공급자 기록을 대조한 후 재시도해주세요.", "Provider acceptance does not confirm delivery. Reconcile uncertain responses or old failures with provider records before retrying.")}</p>
              <ul className="mt-2 space-y-3">{revision.notifications.map(notice => <li key={notice.id} className="break-words">
                <p>{notice.state_key} · {notice.attempts} {t("회 시도", "attempts")} · {notice.last_attempt_at ? new Date(notice.last_attempt_at).toLocaleString(english ? "en-US" : "ko-KR") : "—"}</p>
                <p>{t("이메일", "Email")}: {delivery(notice.outcome.email, true)} · {t("카카오", "Kakao")}: {delivery(notice.outcome.kakao)}</p>
                {notice.outcome.emailMessageId && <p className="break-all font-mono">Email ID: {notice.outcome.emailMessageId}</p>}
                {notice.outcome.kakaoMessageId && <p className="break-all font-mono">Kakao ID: {notice.outcome.kakaoMessageId}</p>}
              </li>)}</ul>
            </details>}
            <ul className="mt-2 space-y-2">{revision.files.map(file => <li key={file.id} className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="break-all">{file.original_name} · {Math.ceil(file.size_bytes / 1024).toLocaleString()} KB · {statusLabel(file.status)}</span>
              {["VERIFIED", "UPLOADED"].includes(file.status) && <button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async () => {
                const result = await api<{ url: string }>({ action: "download", fileId: file.id });
                const link = document.createElement("a"); link.href = result.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.click();
              })}>{t("파일 열기", "Open File")}</button>}
              {editable && file.status === "PENDING" && <>
                <button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async () => { await api({ action: "recheck", fileId: file.id }); await load(); })}>{t("전송 확인 다시 시도", "Recheck Upload")}</button>
                <button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async () => { await api({ action: "abort", fileId: file.id }); await load(); })}>{t("전송 취소", "Cancel Upload")}</button>
              </>}
            </li>)}</ul>
          </div>)}
          {editable && <>
            <label className="block text-sm font-bold" htmlFor={`${regionId}-${request.id}-files`}>{t("보완 파일 선택", "Select Supplement Files")}</label>
            <input id={`${regionId}-${request.id}-files`} type="file" multiple disabled={busy} className="block min-h-11 w-full text-base file:mr-3 file:min-h-11 file:rounded file:border file:border-border file:px-3" onChange={event => { void upload(request.id, event.target.files); event.target.value = ""; }} />
            <p className="text-sm text-muted-foreground">{t("음원·영상·신청서 파일을 선택하세요. 새로고침하면 전송 중이던 파일은 다시 선택해야 합니다. 파일 전송 후 제출을 눌러주세요.", "Choose audio, video, or application files. After refreshing, reselect any unfinished files. Submit after uploading.")}</p>
            <label className="block text-sm font-bold" htmlFor={`${regionId}-${request.id}-note`}>{t("보완 내용", "Revision Notes")}</label>
            <textarea id={`${regionId}-${request.id}-note`} maxLength={4000} value={notes[request.id] ?? ""} onChange={event => setNotes(value => ({ ...value, [request.id]: event.target.value }))} className="min-h-24 w-full rounded border border-border bg-background p-3 text-base" />
            <button type="button" disabled={busy || !verified} className={`${buttonClass} bg-primary text-primary-foreground`} onClick={() => void run(async () => { await api({ action: "submit", requestId: request.id, note: notes[request.id] ?? "" }); await load(); setMessage(t("보완 자료를 제출했습니다. 관리자 확인을 기다려주세요.", "Supplements submitted. Please wait for staff review.")); })}>{t("보완 제출", "Submit Supplements")}</button>
          </>}
          {admin && request.status === "SUBMITTED" && <>
            <label className="block text-sm font-bold" htmlFor={`${regionId}-${request.id}-review`}>{t("검수 내용·재보완 사유", "Review Notes or Revision Reason")}</label>
            <textarea id={`${regionId}-${request.id}-review`} maxLength={4000} value={notes[request.id] ?? ""} onChange={event => setNotes(value => ({ ...value, [request.id]: event.target.value }))} className="min-h-24 w-full rounded border border-border bg-background p-3 text-base" />
            <div className="flex flex-wrap gap-2">{(["ACCEPTED", "REJECTED"] as const).map(decision => <button key={decision} type="button" disabled={busy || (decision === "REJECTED" && !notes[request.id]?.trim())} className={buttonClass} onClick={() => void run(async () => { await api({ action: "review", requestId: request.id, decision, note: notes[request.id] ?? "" }); await load(); })}>{decision === "ACCEPTED" ? t("보완 자료 수락", "Accept Supplements") : t("재보완 요청", "Request Another Revision")}</button>)}</div>
          </>}
        </article>;
      })}
    </div>}
  </section>;
}
