import Link from "next/link";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { formatDateTime } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "마이페이지",
};

const statusLabels: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "임시저장", tone: "bg-slate-500/10 text-slate-600" },
  SUBMITTED: { label: "접수", tone: "bg-sky-500/10 text-sky-600" },
  PRE_REVIEW: { label: "사전검토", tone: "bg-violet-500/10 text-violet-600" },
  WAITING_PAYMENT: {
    label: "결제 확인 중",
    tone: "bg-amber-500/10 text-amber-700",
  },
  IN_PROGRESS: { label: "진행중", tone: "bg-indigo-500/10 text-indigo-600" },
  RESULT_READY: { label: "결과", tone: "bg-emerald-500/10 text-emerald-600" },
  COMPLETED: { label: "완료", tone: "bg-emerald-500/15 text-emerald-700" },
};

const paymentLabels: Record<string, { label: string; tone: string }> = {
  UNPAID: { label: "미결제", tone: "bg-slate-500/10 text-slate-600" },
  PAYMENT_PENDING: {
    label: "결제 확인 중",
    tone: "bg-amber-500/10 text-amber-700",
  },
  PAID: { label: "결제완료", tone: "bg-emerald-500/10 text-emerald-600" },
  REFUNDED: { label: "환불", tone: "bg-rose-500/10 text-rose-600" },
};

const typeLabels: Record<string, string> = {
  ALBUM: "음반 심의",
  MV_DISTRIBUTION: "MV 유통 심의",
  MV_BROADCAST: "MV 방송 심의",
};

const completionStatuses = ["APPROVED", "REJECTED", "NEEDS_FIX"];

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: submissions } = await supabase
    .from("submissions")
    .select(
      "id, title, artist_name, status, payment_status, created_at, updated_at, type, station_reviews ( id, status )",
    )
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  return (
    <DashboardShell
      title="접수 현황"
      description="접수한 심의의 현재 상태를 확인할 수 있습니다."
      activeTab="status"
    >
      <div className="space-y-4">
        {submissions && submissions.length > 0 ? (
          submissions.map((submission) => {
            const statusInfo =
              statusLabels[submission.status] ?? statusLabels.DRAFT;
            const paymentInfo =
              paymentLabels[submission.payment_status] ?? paymentLabels.UNPAID;
            const shouldShowPaymentChip = !(
              submission.status === "WAITING_PAYMENT" &&
              submission.payment_status === "PAYMENT_PENDING"
            );
            const typeLabel = typeLabels[submission.type] ?? submission.type;
            const stationReviews = submission.station_reviews ?? [];
            const totalStations = stationReviews.length;
            const completedStations = stationReviews.filter((review) =>
              completionStatuses.includes(review.status),
            ).length;
            const progressPercent =
              totalStations > 0
                ? Math.round((completedStations / totalStations) * 100)
                : 0;

            return (
              <div
                key={submission.id}
                className="rounded-[28px] border border-border/60 bg-card/80 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                      {typeLabel}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-foreground">
                      {submission.title || "제목 미입력"}
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {submission.artist_name || "아티스트 미입력"}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      접수일 {formatDateTime(submission.created_at)} · 최근
                      업데이트 {formatDateTime(submission.updated_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${statusInfo.tone}`}
                    >
                      {statusInfo.label}
                    </span>
                    {shouldShowPaymentChip && (
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${paymentInfo.tone}`}
                      >
                        {paymentInfo.label}
                      </span>
                    )}
                    <Link
                      href={`/dashboard/submissions/${submission.id}`}
                      className="rounded-full border border-border/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
                    >
                      상세 보기
                    </Link>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      진행률 {progressPercent}% · {completedStations}/
                      {totalStations}
                    </span>
                    <span>심의 진행 중</span>
                  </div>
                  <div className="mt-2 h-2 w-full rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-foreground transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
            아직 접수된 내역이 없습니다.
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
