import Link from "next/link";

import { createServerSupabase } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SubscriptionResult({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const orderId = Array.isArray(params.orderId)
    ? params.orderId[0]
    : params.orderId;
  const status = Array.isArray(params.status)
    ? params.status[0]
    : params.status ?? "pending";
  const messageParam = Array.isArray(params.message)
    ? params.message[0]
    : params.message;

  const supabase = await createServerSupabase();
  const { data: history } = orderId
    ? await supabase
        .from("subscription_history")
        .select("*")
        .eq("order_id", orderId)
        .maybeSingle()
    : { data: null };

  const amount = history?.amount_krw ?? 0;
  const title =
    status === "success"
      ? "정기결제가 완료되었습니다."
      : status === "refunded"
        ? "결제가 취소되었습니다."
        : status === "fail"
          ? "결제에 실패했습니다."
          : "결제 진행 중입니다.";

  const message =
    messageParam ??
    history?.result_message ??
    "자세한 내역은 아래에서 확인할 수 있습니다.";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Subscription
      </p>
      <h1 className="font-display mt-2 text-2xl text-foreground">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{message}</p>

      <div className="mt-6 rounded-[10px] border-2 border-[#111111] bg-card p-4 text-sm text-foreground shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:shadow-[4px_4px_0_#f2cf27]">
        <div className="grid gap-3">
          <div className="grid gap-1 sm:grid-cols-[120px_1fr] sm:items-center">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              주문번호
            </span>
            <span className="break-all font-mono sm:text-right">{orderId ?? "-"}</span>
          </div>
          <div className="grid gap-1 sm:grid-cols-[120px_1fr] sm:items-center">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              상태
            </span>
            <span className="font-semibold sm:text-right">{history?.status ?? status}</span>
          </div>
          <div className="grid gap-1 sm:grid-cols-[120px_1fr] sm:items-center">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              금액
            </span>
            <span className="font-semibold sm:text-right">
              {amount ? `${formatCurrency(amount)}원` : "-"}
            </span>
          </div>
          <div className="grid gap-1 sm:grid-cols-[120px_1fr] sm:items-center">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              TID
            </span>
            <span className="break-all font-mono text-xs sm:text-right">
              {history?.pg_tid ?? "미수신"}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:flex">
        <Link
          href="/subscription"
          className="inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white px-4 py-2 text-xs font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[3px_3px_0_#f2cf27]"
        >
          결제 다시 시도
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#1556a4] px-4 py-2 text-xs font-black uppercase tracking-normal text-white shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[3px_3px_0_#f2cf27]"
        >
          대시보드로
        </Link>
      </div>
    </div>
  );
}
