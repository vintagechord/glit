"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { APP_CONFIG } from "@/lib/config";

export function EmailMaterialsNotice({
  submissionId,
  subject,
  materials,
}: {
  submissionId?: string | null;
  subject: string;
  materials: string;
}) {
  const [copyStatus, setCopyStatus] = React.useState("");
  const pathname = usePathname();
  const isEnglish = pathname === "/en" || pathname.startsWith("/en/");
  const emailSubject = isEnglish
    ? `${subject} / Application ID ${submissionId || "pending"}`
    : `${subject} / 접수번호 ${submissionId || "발급 대기"}`;

  return (
    <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-5 text-sm">
      <p className="font-bold">자료 제출 대기</p>
      <p className="mt-2 text-muted-foreground">보낼 자료: {materials}. 자료를 수신하고 확인한 후 접수를 진행합니다.</p>
      <a className="mt-3 block break-all font-semibold underline underline-offset-4" href={`mailto:${APP_CONFIG.supportEmail}?subject=${encodeURIComponent(emailSubject)}`}>
        {APP_CONFIG.supportEmail}
      </a>
      <p className="mt-3 text-xs font-semibold">메일 제목</p>
      <p data-no-translate className="mt-1 break-all text-sm">{emailSubject}</p>
      <button type="button" disabled={!submissionId} className="mt-3 min-h-11 rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={async () => {
        try {
          await navigator.clipboard.writeText(emailSubject);
          setCopyStatus("메일 제목을 복사했습니다.");
        } catch {
          setCopyStatus("복사하지 못했습니다. 위 메일 제목을 선택해 복사해주세요.");
        }
      }}>메일 제목 복사</button>
      <p className="mt-2 text-xs text-muted-foreground">이 선택만으로 파일 수신이 확인되지는 않습니다. 접수번호를 포함해 보내주세요.</p>
      <p role="status" className="mt-2 text-xs">{copyStatus}</p>
    </div>
  );
}
