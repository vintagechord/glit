export const metadata = {
  title: "관리자",
};

import Link from "next/link";
import {
  ClipboardList,
  CreditCard,
  SendHorizontal,
  type LucideIcon,
} from "lucide-react";

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
  description,
  count,
  href,
  icon: Icon,
  tone,
}: {
  title: string;
  description: string;
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
          <span className="block text-[11px] font-black uppercase tracking-[0.22em] text-muted-foreground">
            전체 유형 합산
          </span>
          <span className="mt-1 block text-base font-black text-foreground">
            {title}
          </span>
          <span className="mt-1 block text-xs font-semibold text-muted-foreground">
            {description}
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
  const summary = await getDashboardSummary();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        관리자
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        관리자 대시보드
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        접수 리스트, 결제 승인, 방송국 상태 관리를 진행하세요.
      </p>

      <section
        aria-label="관리자 처리 요약"
        className="mt-8 overflow-hidden rounded-[18px] border-2 border-[#111111] bg-card shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]"
      >
        <div className="border-b border-border/70 bg-background/80 px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-muted-foreground">
                처리 현황
              </p>
              <h2 className="mt-1 text-base font-black text-foreground">
                접수 · 결제 · 결과통보 요약
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
            description="접수 완료 상태"
            count={summary.received}
            href="/admin/submissions?type=ALL&status=SUBMITTED"
            icon={ClipboardList}
            tone="border-[#111111] bg-[#2f8cff] text-white"
          />
          <SummaryCard
            title="결제 완료"
            description="결제 승인/완료 건"
            count={summary.paid}
            href="/admin/submissions?type=ALL&payment=PAID"
            icon={CreditCard}
            tone="border-[#111111] bg-[#5aa832] text-white"
          />
          <SummaryCard
            title="결과통보 완료"
            description="결과 안내 발송 완료"
            count={summary.resultNotified}
            href="/admin/submissions?type=ALL&status=RESULT_READY"
            icon={SendHorizontal}
            tone="border-[#111111] bg-[#f2cf27] text-[#111111]"
          />
        </div>
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/admin/submissions?type=ALBUM"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            접수 관리
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            접수 관리
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            접수 리스트와 결제 승인, 상태 변경을 처리합니다.
          </p>
        </Link>
        <Link
          href="/admin/artists"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            아티스트
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            아티스트 관리
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            아티스트 썸네일과 메타 정보를 관리합니다.
          </p>
        </Link>
        <Link
          href="/admin/config"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            설정
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            패키지/방송국 설정
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            패키지 가격과 방송국 매핑을 관리합니다.
          </p>
        </Link>
        <Link
          href="/admin/karaoke"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            노래방
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            노래방 등록 관리
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            노래방 등록 접수와 상태를 관리합니다.
          </p>
        </Link>
        <Link
          href="/admin/magazine"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            매거진
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            매거진 발행 요청
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            음반심의 크레딧으로 접수된 매거진 요청을 관리합니다.
          </p>
        </Link>
        <Link
          href="/admin/credits"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            크레딧
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            크레딧/쿠폰 관리
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            크레딧으로 교환 가능한 서비스 이용권과 발행 쿠폰을 관리합니다.
          </p>
        </Link>
        <Link
          href="/admin/banners"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            배너
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            배너 관리
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            좌측 배너 광고 노출 정보를 관리합니다.
          </p>
        </Link>
        <Link
          href="/admin/users"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            회원 관리
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            가입 회원 관리
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            회원 프로필과 연락처 정보를 조회하고 관리합니다.
          </p>
        </Link>
        <Link
          href="/admin/payments"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            카드 결제
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            이니시스 승인 내역
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            승인 완료된 카드 결제 건을 조회합니다.
          </p>
        </Link>
        <Link
          href="/admin/files"
          className="rounded-[24px] border border-border/60 bg-card/80 p-6 text-sm transition hover:-translate-y-1 hover:border-foreground"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            결과 파일
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            심의 파일 업로드
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            등급분류/결과/표기 가이드 파일을 접수 건에 업로드합니다.
          </p>
        </Link>
      </div>
    </div>
  );
}
