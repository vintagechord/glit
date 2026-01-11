import Link from "next/link";

import { createServerSupabase } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SubscriptionResult({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const orderId = Array.isArray(searchParams.orderId)
    ? searchParams.orderId[0]
    : searchParams.orderId;
  const status = Array.isArray(searchParams.status)
    ? searchParams.status[0]
    : searchParams.status ?? "pending";
  const messageParam = Array.isArray(searchParams.message)
    ? searchParams.message[0]
    : searchParams.message;

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
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Subscription
      </p>
      <h1 className="font-display mt-2 text-2xl text-foreground">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{message}</p>

      <div className="mt-6 rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-foreground">
        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              주문번호
            </span>
            <span className="font-mono">{orderId ?? "-"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              상태
            </span>
            <span className="font-semibold">{history?.status ?? status}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              금액
            </span>
            <span className="font-semibold">
              {amount ? `${formatCurrency(amount)}원` : "-"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              TID
            </span>
            <span className="font-mono text-xs">
              {history?.pg_tid ?? "미수신"}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <Link
          href="/subscription"
          className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
        >
          결제 다시 시도
        </Link>
        <Link
          href="/dashboard"
          className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-amber-200 hover:text-slate-900"
        >
          대시보드로
        </Link>
      </div>
    </div>
  );
}
