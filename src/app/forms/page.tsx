import Link from "next/link";

import { APP_CONFIG } from "@/lib/config";

export const metadata = {
  title: "신청서 다운로드",
};

export default function FormsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Forms
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        신청서 다운로드 및 이메일 접수
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        비회원 접수는 준비 중입니다. 신청서를 다운로드하여 작성 후 이메일로
        접수해주세요.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            HWP
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            신청서 (한글)
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            한글(hwp) 양식을 다운로드하여 작성하세요.
          </p>
          <Link
            href="/forms/onside-application.hwp"
            className="mt-6 inline-flex rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
          >
            HWP 다운로드
          </Link>
        </div>
        <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Word
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            신청서 (Word)
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Word(docx) 양식을 다운로드하여 작성하세요.
          </p>
          <Link
            href="/forms/onside-application.docx"
            className="mt-6 inline-flex rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
          >
            Word 다운로드
          </Link>
        </div>
      </div>

      <div className="mt-8 rounded-[28px] border border-dashed border-border/60 bg-background/70 p-6 text-sm text-muted-foreground">
        작성 완료된 신청서를 이메일{" "}
        <span className="font-semibold text-foreground">
          {APP_CONFIG.supportEmail}
        </span>
        로 보내주시면 접수 안내를 드립니다.
      </div>
    </div>
  );
}
