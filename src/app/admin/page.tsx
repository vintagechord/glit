export const metadata = {
  title: "관리자",
};

import Link from "next/link";
import {
  ClipboardList,
  CreditCard,
  FileArchive,
  MessageCircle,
  MessageSquareText,
  SendHorizontal,
  type LucideIcon,
} from "lucide-react";

import { MelonReviewDocsDownloadForm } from "@/components/admin/review-docs-download";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type DashboardSummary = {
  received: number;
  paid: number;
  resultNotified: number;
  hasError: boolean;
};

const isMissingResultNotifiedAtError = (
  error: { code?: string; message?: string } | null,
) =>
  error?.code === "42703" ||
  error?.code === "PGRST204" ||
  Boolean(error?.message?.toLowerCase().includes("result_notified_at"));

async function getDashboardSummary(): Promise<DashboardSummary> {
  const admin = createAdminClient();
  const [receivedResult, paidResult, resultNotifiedResult] = await Promise.all([
    admin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("status", "SUBMITTED"),
    admin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("payment_status", "PAID"),
    admin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .not("result_notified_at", "is", null),
  ]);

  let resultNotifiedCount = resultNotifiedResult.count ?? 0;
  let resultNotifiedError = resultNotifiedResult.error ?? null;

  if (isMissingResultNotifiedAtError(resultNotifiedError)) {
    const fallback = await admin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .in("status", ["RESULT_READY", "COMPLETED"]);
    resultNotifiedCount = fallback.count ?? 0;
    resultNotifiedError = fallback.error ?? null;
  }

  return {
    received: receivedResult.count ?? 0,
    paid: paidResult.count ?? 0,
    resultNotified: resultNotifiedCount,
    hasError: Boolean(
      receivedResult.error || paidResult.error || resultNotifiedError,
    ),
  };
}

function SummaryCard({
  title,
  count,
  href,
  icon: Icon,
  tone,
}: {
  title: string;
  count: number;
  href: string;
  icon: LucideIcon;
  tone: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[112px] items-center justify-between gap-4 border-b border-border/70 bg-card/85 p-5 transition last:border-b-0 hover:bg-background md:border-b-0 md:border-r md:last:border-r-0"
    >
      <div className="flex min-w-0 items-center gap-4">
        <span
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border-2 shadow-[3px_3px_0_#111111] ${tone}`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-base font-black text-foreground">
            {title}
          </span>
        </span>
      </div>
      <span className="shrink-0 text-right">
        <span className="text-3xl font-black leading-none text-foreground">
          {count.toLocaleString()}
        </span>
        <span className="ml-1 text-sm font-black text-muted-foreground">건</span>
      </span>
    </Link>
  );
}

export default async function AdminPage() {
  await requireAdminPage();
  const summary = await getDashboardSummary();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <h1 className="font-display text-3xl text-foreground">대시보드</h1>

      <section
        aria-label="관리자 처리 요약"
        className="mt-8 overflow-hidden rounded-[18px] border-2 border-[#111111] bg-card shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]"
      >
        <div className="border-b border-border/70 bg-background/80 px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-foreground">
                처리 현황
              </h2>
            </div>
            {summary.hasError ? (
              <span className="rounded-[6px] border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-bold text-red-600">
                일부 집계 확인 필요
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid md:grid-cols-3">
          <SummaryCard
            title="접수"
            count={summary.received}
            href="/admin/submissions?type=ALL&status=SUBMITTED"
            icon={ClipboardList}
            tone="border-[#111111] bg-[#2f8cff] text-white"
          />
          <SummaryCard
            title="결제 완료"
            count={summary.paid}
            href="/admin/submissions?type=ALL&payment=PAID"
            icon={CreditCard}
            tone="border-[#111111] bg-[#5aa832] text-white"
          />
          <SummaryCard
            title="결과통보 완료"
            count={summary.resultNotified}
            href="/admin/submissions?type=ALL&status=RESULT_READY"
            icon={SendHorizontal}
            tone="border-[#111111] bg-[#f2cf27] text-[#111111]"
          />
        </div>
      </section>

      <section
        aria-labelledby="melon-review-docs-title"
        className="mt-6 rounded-[18px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#1556a4] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]"
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="melon-review-docs-title"
              className="text-base font-black text-foreground"
            >
              멜론/지니 링크 심의자료 생성
            </h2>
            <p className="mt-1 text-xs font-semibold leading-5 text-muted-foreground">
              앨범 링크로 심의자료 ZIP을 생성합니다.
            </p>
            <details className="mt-1 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-semibold text-foreground">
                생성 기준
              </summary>
              <p className="mt-1 max-w-2xl leading-5">
                지니 정보를 우선 사용하고, 멜론 링크가 있으면 누락된 가사와
                크레딧을 보완합니다.
              </p>
            </details>
          </div>
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111]">
            <FileArchive className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>
        <MelonReviewDocsDownloadForm />
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/admin/submissions?type=ALBUM"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <h2 className="text-xl font-semibold text-foreground">접수 관리</h2>
        </Link>
        <Link
          href="/admin/artists"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <h2 className="text-xl font-semibold text-foreground">
            아티스트 관리
          </h2>
        </Link>
        <Link
          href="/admin/config"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <h2 className="text-xl font-semibold text-foreground">
            패키지/방송국 설정
          </h2>
        </Link>
        <Link
          href="/admin/karaoke"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <h2 className="text-xl font-semibold text-foreground">
            노래방 등록 관리
          </h2>
        </Link>
        <Link
          href="/admin/magazine"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <h2 className="text-xl font-semibold text-foreground">
            매거진 발행 요청
          </h2>
        </Link>
        <Link
          href="/admin/credits"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <h2 className="text-xl font-semibold text-foreground">
            크레딧 서비스 관리
          </h2>
        </Link>
        <Link
          href="/admin/chat"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
            실시간 채팅
          </h2>
        </Link>
        <Link
          href="/admin/inquiries"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <MessageSquareText className="h-5 w-5" aria-hidden="true" />
            1:1 문의
          </h2>
        </Link>
        <Link
          href="/admin/banners"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <h2 className="text-xl font-semibold text-foreground">배너 관리</h2>
        </Link>
        <Link
          href="/admin/users"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <h2 className="text-xl font-semibold text-foreground">
            가입 회원 관리
          </h2>
        </Link>
        <Link
          href="/admin/payments"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <h2 className="text-xl font-semibold text-foreground">
            이니시스 승인 내역
          </h2>
        </Link>
        <Link
          href="/admin/files"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <h2 className="text-xl font-semibold text-foreground">
            심의 파일 업로드
          </h2>
        </Link>
      </div>
    </div>
  );
}
