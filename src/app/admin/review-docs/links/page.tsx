import Link from "next/link";
import { FileArchive } from "lucide-react";

import { MelonReviewDocsDownloadForm } from "@/components/admin/review-docs-download";
import { requireAdminPage } from "@/lib/admin/page-auth";

export const metadata = { title: "멜론/지니 링크 심의자료 생성" };
export const dynamic = "force-dynamic";

export default async function MelonGenieReviewDocsPage() {
  await requireAdminPage();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <Link href="/admin" className="text-sm font-semibold text-muted-foreground hover:underline">
        ← 관리자 대시보드
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-black text-foreground">멜론/지니 링크 심의자료 생성</h1>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
            발매된 앨범 링크로 심의자료 ZIP을 만듭니다. 접수건과 연결하지 않는 단독 생성 도구입니다.
          </p>
        </div>
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111]">
          <FileArchive className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>

      <section
        aria-label="링크 입력"
        className="mt-6 rounded-[18px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#1556a4] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]"
      >
        <details className="mb-4 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-foreground">생성 기준</summary>
          <p className="mt-1 max-w-2xl leading-5">
            지니 정보를 우선 사용하고, 멜론 링크가 있으면 누락된 가사와 크레딧을 보완합니다.
          </p>
        </details>
        <MelonReviewDocsDownloadForm />
      </section>

      <p className="mt-6 text-xs font-semibold text-muted-foreground">
        접수건의 신청서로 자료를 만들 때는{" "}
        <Link href="/admin/review-docs" className="text-[#1556a4] underline underline-offset-4 dark:text-sky-300">
          심의자료 생성
        </Link>
        {" "}또는 접수 상세의 심의자료 다운로드를 사용하세요.
      </p>
    </main>
  );
}
