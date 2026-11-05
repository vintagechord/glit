"use client";

import * as React from "react";

import { brandStatusTones } from "@/lib/brand-status-tones";
import { APP_CONFIG } from "@/lib/config";

export function EmailMaterialsNotice({
  subject,
  materials,
}: {
  /** Kept for callers; the application ID is no longer part of the subject. */
  submissionId?: string | null;
  subject: string;
  materials: string;
}) {
  const [copyStatus, setCopyStatus] = React.useState("");
  // The subject names the artist, title and purpose only; staff match the
  // mail to the application by those. (The application ID made it too long.)
  const emailSubject = subject;

  return (
    <div className="mt-4 rounded-2xl border-2 border-[var(--bauhaus-ink)] bg-card px-4 py-5 text-sm">
      <p className={`inline-flex rounded-md border-2 px-2 py-1 font-bold ${brandStatusTones.progress}`}>이메일로 파일 제출</p>
      <p className="mt-2 text-muted-foreground">접수 완료 후 아래 주소로 파일을 보내주세요. 자료를 확인한 후 접수를 진행합니다.</p>
      <p className="mt-1 text-muted-foreground">보낼 자료: {materials}</p>
      <a className="mt-3 block break-all font-semibold underline underline-offset-4" href={`mailto:${APP_CONFIG.supportEmail}?subject=${encodeURIComponent(emailSubject)}`}>
        {APP_CONFIG.supportEmail}
      </a>
      <p className="mt-3 text-xs font-semibold">메일 제목</p>
      <p data-no-translate className="mt-1 break-all text-sm">{emailSubject}</p>
      <button type="button" className="mt-3 min-h-11 rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={async () => {
        try {
          await navigator.clipboard.writeText(emailSubject);
          setCopyStatus("메일 제목을 복사했습니다.");
        } catch {
          setCopyStatus("복사하지 못했습니다. 위 메일 제목을 선택해 복사해주세요.");
        }
      }}>메일 제목 복사</button>
      <p className="mt-2 text-xs text-muted-foreground">이 선택만으로 파일 수신이 확인되지는 않습니다. 위 메일 제목 그대로 보내주세요.</p>
      <p role="status" className="mt-2 text-xs">{copyStatus}</p>
    </div>
  );
}
