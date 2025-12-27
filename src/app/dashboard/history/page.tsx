import Link from "next/link";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { HistoryList } from "@/components/dashboard/history-list";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "나의 심의 내역",
};

const typeLabels: Record<string, string> = {
  ALBUM: "앨범",
  MV_DISTRIBUTION: "MV 유통",
  MV_BROADCAST: "MV 방송",
};

const statusLabels: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "임시저장", tone: "bg-slate-500/10 text-slate-600" },
  SUBMITTED: { label: "접수", tone: "bg-sky-500/10 text-sky-600" },
  PRE_REVIEW: {
    label: "사전검토",
    tone: "bg-violet-500/10 text-violet-600",
  },
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

export default async function HistoryPage() {
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
      "id, title, artist_name, status, payment_status, created_at, type",
    )
    .order("updated_at", { ascending: false })
    .eq("user_id", user.id);

  const items =
    submissions?.map((submission, index) => {
      const statusInfo =
        statusLabels[submission.status] ?? statusLabels.DRAFT;
      const paymentInfo =
        paymentLabels[submission.payment_status] ?? paymentLabels.UNPAID;
      const typeLabel = typeLabels[submission.type] ?? submission.type;
      return {
        id: submission.id,
        order: index + 1,
        title: submission.title || "제목 미입력",
        artistName: submission.artist_name || "아티스트 미입력",
        typeLabel,
        createdAt: submission.created_at,
        status: statusInfo,
        payment: paymentInfo,
        showPaymentChip: !(
          submission.status === "WAITING_PAYMENT" &&
          submission.payment_status === "PAYMENT_PENDING"
        ),
      };
    }) ?? [];

  return (
    <DashboardShell
      title="나의 심의 내역"
      description="심의 기록을 발매 음원 단위로 확인합니다."
      activeTab="history"
      action={
        <Link
          href="/dashboard/new"
          className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
        >
          새 접수
        </Link>
      }
    >
      <HistoryList initialItems={items} />
    </DashboardShell>
  );
}
